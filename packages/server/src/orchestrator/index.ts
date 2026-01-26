import { Db, Spec } from '../db/index.js';
import { GitManager } from '../git/index.js';
import { ClaudeInstance } from '../claude/instance.js';
import { MAIN_CLAUDE_PROMPT, SPEC_CREATOR_PROMPT, COORDINATOR_PROMPT, WORKER_PROMPT } from '../claude/prompts.js';
import { fetchGitHubIssues, closeIssue } from '../github/issues.js';
import { config } from '../config.js';
import { WebSocketHub } from '../routes/ws.js';
import { nanoid } from 'nanoid';
import { getGitHubRepoInfo } from '../git/repo-info.js';

export class Orchestrator {
    private running = false;
    private mainClaude?: ClaudeInstance;
    private instances = new Map<string, ClaudeInstance>();
    private notifiedRoadmapItems = new Set<string>();
    private pushedSpecs = new Set<string>();

    constructor(
        private db: Db,
        private git: GitManager,
        private wsHub: WebSocketHub,
    ) {}

    async start(): Promise<void> {
        // Idempotent - don't start if already running
        if (this.running) {
            console.log('Orchestrator already running, skipping start');
            return;
        }

        this.running = true;

        // Sync GitHub issues to roadmap
        await this.syncGitHubIssues();

        // Check for paused instances to resume
        const paused = this.db.getClaudeInstances({ status: 'paused' });

        if (paused.length > 0) {
            await this.resumeInstances(paused);
        }

        // If main claude wasn't started (either no paused instances or couldn't resume), start fresh
        if (!this.mainClaude) {
            console.log('No main claude running, starting fresh...');
            await this.startMainClaude();
        }

        // Start main loop
        this.runLoop();
    }

    async stop(): Promise<void> {
        this.running = false;

        // Interrupt all instances, save resume IDs
        for (const [id, instance] of this.instances) {
            try {
                const resumeId = await instance.interrupt();
                this.db.updateClaudeInstance(id, {
                    status: 'paused',
                    resume_id: resumeId,
                });
            } catch (e) {
                console.error(`Error stopping instance ${id}:`, e);
            }
        }
    }

    private async syncGitHubIssues(): Promise<void> {
        try {
            const issues = await fetchGitHubIssues(config.repoOwner, config.repoName);

            for (const issue of issues) {
                const existing = this.db.getRoadmapItemByGitHubIssue(issue.number);

                if (!existing) {
                    this.db.createRoadmapItem({
                        github_issue_id: issue.number,
                        github_issue_url: issue.html_url,
                        github_issue_closed: 0,
                        title: issue.title,
                        description: issue.body || '',
                        status: 'pending',
                        spec_id: null,
                    });
                }
            }

            this.wsHub.broadcastState(this.db);
        } catch (e) {
            console.error('Error syncing GitHub issues:', e);
        }
    }

    private async startMainClaude(): Promise<void> {
        const mainWt = await this.git.getWorktreePath('main');

        this.mainClaude = new ClaudeInstance({
            id: 'main',
            role: 'main',
            db: this.db,
            worktreePath: mainWt,
            systemPrompt: MAIN_CLAUDE_PROMPT,
        });

        await this.mainClaude.start();
        this.instances.set('main', this.mainClaude);

        // Set up event handlers
        this.mainClaude.on('output', (data) => {
            console.log(`[Orchestrator] Main claude output (${data.length} chars)`);
            this.wsHub.broadcastClaudeOutput('main', data);
        });

        this.mainClaude.on('question', (question) => {
            const q = this.db.createUserQuestion({
                claude_instance_id: 'main',
                question,
                response: null,
                status: 'pending',
            });
            this.wsHub.broadcastQuestion(q);
        });

        // Send initial context
        const roadmapItems = this.db.getRoadmapItems();
        await this.mainClaude.sendMessage(`
${MAIN_CLAUDE_PROMPT}

Current roadmap items:
${roadmapItems.map((item) => `- [${item.status}] ${item.title}`).join('\n')}

Please review and decide what to work on first.
        `);
    }

    private async resumeInstances(paused: { id: string; resume_id: string | null; role: string; worktree_name: string | null }[]): Promise<void> {
        for (const record of paused) {
            if (!record.resume_id || !record.worktree_name) {
                // Can't resume without resume_id or worktree, mark as stopped
                console.log(`Cannot resume instance ${record.id} (no resume_id or worktree), marking as stopped`);
                this.db.updateClaudeInstance(record.id, { status: 'stopped' });
                continue;
            }

            const wtPath = await this.git.getWorktreePath(record.worktree_name);

            const instance = new ClaudeInstance({
                id: record.id,
                role: record.role as 'main' | 'spec_creator' | 'coordinator' | 'worker',
                db: this.db,
                worktreePath: wtPath,
                resumeId: record.resume_id,
            });

            await instance.start();
            this.instances.set(record.id, instance);

            if (record.role === 'main') {
                this.mainClaude = instance;
            }

            // Set up handlers
            instance.on('output', (data) => {
                this.wsHub.broadcastClaudeOutput(record.id, data);
            });

            instance.on('question', (question) => {
                const q = this.db.createUserQuestion({
                    claude_instance_id: record.id,
                    question,
                    response: null,
                    status: 'pending',
                });
                this.wsHub.broadcastQuestion(q);
            });
        }
    }

    private async runLoop(): Promise<void> {
        while (this.running) {
            try {
                // 1. Check for roadmap items needing specs
                await this.checkForPendingSpecs();

                // 2. Check for specs ready to implement
                await this.checkForReadySpecs();

                // 3. Check for completed implementations
                await this.checkCompletions();

                // 4. Update roadmap items when specs complete
                await this.checkRoadmapProgression();

                // 5. Check for completed roadmap items and close GitHub issues
                await this.checkRoadmapCompletion();

                // 6. Broadcast current state
                this.wsHub.broadcastState(this.db);
            } catch (e) {
                console.error('Error in orchestrator loop:', e);
            }

            await sleep(5000);
        }
    }

    private async checkForPendingSpecs(): Promise<void> {
        const pending = this.db.getRoadmapItems({ status: 'pending' });

        for (const item of pending) {
            // Skip if already has a spec (even if status is still 'pending')
            if (item.spec_id) {
                continue;
            }

            // Skip if already notified
            if (this.notifiedRoadmapItems.has(item.id)) {
                continue;
            }

            // Check if has unresolved dependencies
            if (!this.db.hasUnresolvedDependencies('roadmap_item', item.id)) {
                console.log(`[Orchestrator] Notifying main Claude about roadmap item: ${item.title}`);

                // Mark as notified
                this.notifiedRoadmapItems.add(item.id);

                // Notify main Claude to create spec
                if (this.mainClaude) {
                    await this.mainClaude.sendMessage(`
New roadmap item ready for specification:

ID: ${item.id}
Title: ${item.title}
Description: ${item.description}

Please create a detailed spec for this roadmap item:
1. Research the codebase to understand current implementation
2. Create spec content in a markdown file
3. Use: o8 spec create -r ${item.id} -c @spec.md
4. Approve the spec: o8 spec approve <spec-id>

The system will automatically start implementation once the spec is approved.
                    `);
                }
            }
        }
    }

    private async checkForReadySpecs(): Promise<void> {
        const approved = this.db.getSpecs({ status: 'approved' });

        for (const spec of approved) {
            if (!this.db.hasUnresolvedDependencies('spec', spec.id)) {
                // This spec is ready for implementation
                await this.startSpecImplementation(spec);
            }
        }
    }

    private async startSpecImplementation(spec: Spec): Promise<void> {
        console.log(`[Orchestrator] Starting implementation for spec ${spec.id}`);

        const worktreeName = `spec-${spec.id}`;
        const wtPath = await this.git.createWorktree(worktreeName, 'main');

        const coordinator = new ClaudeInstance({
            id: nanoid(),
            role: 'coordinator',
            db: this.db,
            worktreePath: wtPath,
            systemPrompt: COORDINATOR_PROMPT,
            contextType: 'spec',
            contextId: spec.id,
        });

        await coordinator.start();
        this.instances.set(coordinator.id, coordinator);

        // Update spec status
        this.db.updateSpec(spec.id, {
            status: 'in_progress',
            worktree_name: worktreeName,
        });

        console.log(`[Orchestrator] Spec ${spec.id} status: approved → in_progress`);

        // Set up handlers
        coordinator.on('output', (data) => {
            this.wsHub.broadcastClaudeOutput(coordinator.id, data);
        });

        coordinator.on('question', (question) => {
            const q = this.db.createUserQuestion({
                claude_instance_id: coordinator.id,
                question,
                response: null,
                status: 'pending',
            });
            this.wsHub.broadcastQuestion(q);
        });

        coordinator.on('idle', () => {
            console.log(`[Orchestrator] Coordinator ${coordinator.id} is idle, checking completion for spec ${spec.id}`);
            this.checkSpecCompletion(spec.id);
        });

        // Send spec to coordinator
        await coordinator.sendMessage(`
${COORDINATOR_PROMPT}

Please implement this spec:

${spec.content}
        `);
    }

    private async checkCompletions(): Promise<void> {
        // Check for completed spec implementations
        const inProgress = this.db.getSpecs({ status: 'in_progress' });

        for (const spec of inProgress) {
            await this.checkSpecCompletion(spec.id);
        }
    }

    private async handleSpecMergeComplete(specId: string): Promise<void> {
        // After spec is marked done, push main to origin
        try {
            console.log(`[Orchestrator] Spec ${specId} marked done, checking for unpushed commits on main`);

            const hasUnpushed = await this.git.hasUnpushedCommits('main');
            if (hasUnpushed) {
                console.log(`[Orchestrator] Pushing main to origin after spec ${specId} merge`);
                await this.git.push('main');
                console.log(`[Orchestrator] Successfully pushed main to origin after spec ${specId} merge`);
            } else {
                console.log(`[Orchestrator] No unpushed commits on main, skipping push`);
            }
        } catch (error) {
            console.error(`[Orchestrator] Failed to push main to origin after spec ${specId}:`, error);
            // Don't throw - log error but don't block workflow
        }
    }

    private async checkRoadmapProgression(): Promise<void> {
        // Check for specs that are done and update their roadmap items
        const doneSpecs = this.db.getSpecs({ status: 'done' });

        for (const spec of doneSpecs) {
            // Push to origin if not already pushed
            if (!this.pushedSpecs.has(spec.id)) {
                await this.handleSpecMergeComplete(spec.id);
                this.pushedSpecs.add(spec.id);
            }

            if (spec.roadmap_item_id) {
                const roadmapItem = this.db.getRoadmapItem(spec.roadmap_item_id);
                if (roadmapItem && roadmapItem.status !== 'done') {
                    console.log(`[Orchestrator] Marking roadmap item ${roadmapItem.title} as done (spec completed)`);
                    this.db.updateRoadmapItem(spec.roadmap_item_id, { status: 'done' });

                    // Clear from notified set
                    this.notifiedRoadmapItems.delete(spec.roadmap_item_id);
                }
            }
        }
    }

    private async checkSpecCompletion(specId: string): Promise<void> {
        const spec = this.db.getSpec(specId);
        if (!spec || spec.status !== 'in_progress') {
            console.log(`[Orchestrator] checkSpecCompletion: Spec ${specId} not eligible (status: ${spec?.status || 'not found'})`);
            return;
        }

        const taskGroups = this.db.getTaskGroupsForSpec(specId);
        console.log(`[Orchestrator] checkSpecCompletion: Spec ${specId} has ${taskGroups.length} task groups`);

        // Check if all task groups are done
        // Require at least one task group to prevent premature completion before coordinator creates tasks
        const allTaskGroupsDone = taskGroups.length > 0 && taskGroups.every((tg) => tg.status === 'done');

        if (!allTaskGroupsDone) {
            const pendingGroups = taskGroups.filter((tg) => tg.status !== 'done');
            console.log(`[Orchestrator] checkSpecCompletion: Spec ${specId} still has ${pendingGroups.length} pending task groups`);
            return;
        }

        console.log(`[Orchestrator] Spec ${specId} all task groups complete, transitioning to merging`);

        // Mark spec as ready for review
        this.db.updateSpec(specId, { status: 'merging' });
        console.log(`[Orchestrator] Spec ${specId} status: in_progress → merging`);

        // Notify main claude to review and merge
        if (this.mainClaude) {
            console.log(`[Orchestrator] Notifying main Claude about completed spec ${specId}`);
            await this.mainClaude.sendMessage(`
Spec implementation complete: ${specId}

The coordinator has finished implementing this spec. Please review the changes in worktree "${spec.worktree_name}" and either:
1. Merge directly to main if everything looks good
2. Create a PR for review
3. Request changes if something needs to be fixed

Use \`o8 spec update ${specId} -s done\` after merging, or \`o8 spec update ${specId} -s in_progress\` if changes are needed.
            `);
        } else {
            console.warn(`[Orchestrator] Main Claude not available to notify about spec ${specId} completion`);
        }

        // Broadcast state update
        this.wsHub.broadcastState(this.db);
    }

    async answerQuestion(questionId: string, response: string): Promise<void> {
        const question = this.db.getUserQuestion(questionId);
        if (!question) return;

        this.db.answerQuestion(questionId, response);

        // Send response to the claude instance
        const instance = this.instances.get(question.claude_instance_id);
        if (instance) {
            await instance.sendMessage(`User response to your question: ${response}`);
        }
    }

    async sendToMain(message: string): Promise<void> {
        if (this.mainClaude) {
            await this.mainClaude.sendMessage(message);
        }
    }

    getInstances(): ClaudeInstance[] {
        return Array.from(this.instances.values());
    }

    subscribeToInstance(instanceId: string, callback: (data: string) => void): () => void {
        const instance = this.instances.get(instanceId);
        if (!instance) {
            return () => {};
        }

        instance.on('output', callback);
        return () => {
            instance.off('output', callback);
        };
    }

    private async checkRoadmapCompletion(): Promise<void> {
        const completedItems = this.db.getCompletedRoadmapItemsWithUnclosedIssues();

        if (completedItems.length === 0) {
            return;
        }

        // Get repository info from git remote
        const repoInfo = getGitHubRepoInfo();
        if (!repoInfo) {
            console.error('Cannot close GitHub issues: unable to determine GitHub repository from git remote');
            return;
        }

        for (const item of completedItems) {
            if (!item.github_issue_id) {
                continue;
            }

            try {
                console.log(`Closing GitHub issue #${item.github_issue_id} for completed roadmap item: ${item.title}`);
                await closeIssue(repoInfo.owner, repoInfo.repo, item.github_issue_id);
                this.db.markGitHubIssueClosed(item.id);
                console.log(`Successfully closed GitHub issue #${item.github_issue_id}`);
            } catch (error) {
                console.error(`Failed to close GitHub issue #${item.github_issue_id}:`, error);
                // Continue processing other issues - don't let one failure stop the rest
            }
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
