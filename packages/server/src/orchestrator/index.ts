import { Db, Spec } from '../db/index.js';
import { GitManager } from '../git/index.js';
import { ClaudeInstance } from '../claude/instance.js';
import { MAIN_CLAUDE_PROMPT, SPEC_CREATOR_PROMPT, OVERSEER_PROMPT, WORKER_PROMPT } from '../claude/prompts.js';
import { fetchGitHubIssues } from '../github/issues.js';
import { config } from '../config.js';
import { WebSocketHub } from '../routes/ws.js';
import { nanoid } from 'nanoid';

export class Orchestrator {
    private running = false;
    private mainClaude?: ClaudeInstance;
    private instances = new Map<string, ClaudeInstance>();

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
                role: record.role as 'main' | 'spec_creator' | 'overseer' | 'worker',
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

                // 4. Broadcast current state
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
            if (!this.db.hasUnresolvedDependencies('roadmap_item', item.id)) {
                // This item is ready for spec creation
                // For now, just log - in full implementation, would spawn spec_creator
                console.log(`Roadmap item ready for spec: ${item.title}`);
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

        const overseer = new ClaudeInstance({
            id: nanoid(),
            role: 'overseer',
            db: this.db,
            worktreePath: wtPath,
            systemPrompt: OVERSEER_PROMPT,
            contextType: 'spec',
            contextId: spec.id,
        });

        await overseer.start();
        this.instances.set(overseer.id, overseer);

        // Update spec status
        this.db.updateSpec(spec.id, {
            status: 'in_progress',
            worktree_name: worktreeName,
        });

        console.log(`[Orchestrator] Spec ${spec.id} status: approved → in_progress`);

        // Set up handlers
        overseer.on('output', (data) => {
            this.wsHub.broadcastClaudeOutput(overseer.id, data);
        });

        overseer.on('question', (question) => {
            const q = this.db.createUserQuestion({
                claude_instance_id: overseer.id,
                question,
                response: null,
                status: 'pending',
            });
            this.wsHub.broadcastQuestion(q);
        });

        overseer.on('idle', () => {
            console.log(`[Orchestrator] Overseer ${overseer.id} is idle, checking completion for spec ${spec.id}`);
            this.checkSpecCompletion(spec.id);
        });

        // Send spec to overseer
        await overseer.sendMessage(`
${OVERSEER_PROMPT}

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

    private async checkSpecCompletion(specId: string): Promise<void> {
        const spec = this.db.getSpec(specId);
        if (!spec || spec.status !== 'in_progress') {
            console.log(`[Orchestrator] checkSpecCompletion: Spec ${specId} not eligible (status: ${spec?.status || 'not found'})`);
            return;
        }

        const taskGroups = this.db.getTaskGroupsForSpec(specId);
        console.log(`[Orchestrator] checkSpecCompletion: Spec ${specId} has ${taskGroups.length} task groups`);

        // Check if all task groups are done (if any exist)
        const allTaskGroupsDone = taskGroups.length === 0 || taskGroups.every((tg) => tg.status === 'done');

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

The overseer has finished implementing this spec. Please review the changes in worktree "${spec.worktree_name}" and either:
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
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
