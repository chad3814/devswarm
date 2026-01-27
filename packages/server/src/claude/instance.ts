import {
    unstable_v2_createSession,
    unstable_v2_resumeSession,
    type SDKSession,
    type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { Db, ClaudeInstance as ClaudeInstanceRecord } from '../db/index.js';
import { EventEmitter } from 'events';

export type ClaudeRole = 'main' | 'spec_creator' | 'coordinator' | 'worker';

export interface ClaudeInstanceOptions {
    id: string;
    role: ClaudeRole;
    db: Db;
    worktreePath: string;
    systemPrompt?: string;
    resumeId?: string;
    contextType?: string;
    contextId?: string;
    completionPollingInterval?: number; // milliseconds, default 30000
    maxRuntime?: number; // milliseconds, default 2 hours
    model?: string; // Model to use, defaults to claude-sonnet-4-5-20250929
}

// Removed ClaudeStreamMessage interface - now using SDK's SDKMessage type

/**
 * ClaudeInstance manages a Claude SDK session for multi-turn conversations.
 *
 * Uses the Claude Agent SDK v2 to:
 * - Provide programmatic control over Claude sessions
 * - Maintain conversation context via session IDs
 * - Stream messages and events in real-time
 * - Work in the specified worktree directory
 */
export class ClaudeInstance extends EventEmitter {
    private session?: SDKSession;
    private sessionId?: string;
    private completionPollingTimer?: NodeJS.Timeout;
    private maxRuntimeTimer?: NodeJS.Timeout;
    private currentMessageId?: string;

    constructor(private options: ClaudeInstanceOptions) {
        super();
        this.sessionId = options.resumeId;
    }

    get id(): string {
        return this.options.id;
    }

    get role(): ClaudeRole {
        return this.options.role;
    }

    async start(): Promise<void> {
        const { id, role, db, worktreePath, resumeId } = this.options;

        db.createClaudeInstance({
            id,
            role,
            tmux_pane: null,
            tmux_window: null,
            resume_id: resumeId || null,
            status: 'running',
            context_type: this.options.contextType || null,
            context_id: this.options.contextId || null,
            worktree_name: worktreePath.split('/').pop() || null,
        });

        console.log(`[Claude ${id}] Ready (${role}) in ${worktreePath}`);

        // Start completion polling for coordinator role
        if (role === 'coordinator' && this.options.contextId) {
            this.startCompletionPolling();
        }

        // Start max runtime timer
        this.startMaxRuntimeTimer();
    }

    async sendMessage(message: string): Promise<void> {
        console.log(`[Claude ${this.id}] Sending message (${message.length} chars)`);

        try {
            const model = this.options.model || 'claude-sonnet-4-5-20250929';

            // Change to worktree directory
            const originalCwd = process.cwd();
            try {
                process.chdir(this.options.worktreePath);

                // Create or resume session
                if (this.sessionId) {
                    this.session = unstable_v2_resumeSession(this.sessionId, {
                        model,
                        permissionMode: 'dontAsk',
                        allowedTools: [
                            'Bash',
                            'Read',
                            'Write',
                            'Edit',
                            'Glob',
                            'Grep',
                            'AskUserQuestion',
                            'TodoWrite',
                        ],
                    });
                } else {
                    this.session = unstable_v2_createSession({
                        model,
                        permissionMode: 'dontAsk',
                        allowedTools: [
                            'Bash',
                            'Read',
                            'Write',
                            'Edit',
                            'Glob',
                            'Grep',
                            'AskUserQuestion',
                            'TodoWrite',
                        ],
                    });
                }

                // Reset current message ID for new turn
                this.currentMessageId = undefined;

                // Send the message
                await this.session.send(message);

                // Stream the response
                for await (const msg of this.session.stream()) {
                    this.handleSDKMessage(msg);
                }

                // Emit message complete
                this.emit('message_complete');
                this.emit('idle');
            } finally {
                // Restore original directory
                process.chdir(originalCwd);
            }
        } catch (error) {
            console.error(`[Claude ${this.id}] Error:`, error);
            this.emit('error', error);
        }
    }

    private handleSDKMessage(msg: SDKMessage): void {
        // Extract session ID from message
        if (msg.session_id && !this.sessionId) {
            this.sessionId = msg.session_id;
            console.log(`[Claude ${this.id}] Session ID: ${this.sessionId}`);

            // Update db with session ID
            this.options.db.updateClaudeInstance(this.id, {
                resume_id: this.sessionId,
            });
        }

        // Handle assistant messages (streaming text)
        if (msg.type === 'assistant' && msg.message?.content) {
            // Generate message ID for new assistant message if not set
            if (!this.currentMessageId) {
                this.currentMessageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            }

            for (const block of msg.message.content) {
                if (block.type === 'text' && block.text) {
                    this.emit('output', {
                        text: block.text,
                        messageType: 'continue',
                        messageId: this.currentMessageId,
                    });
                    this.checkForPatterns(block.text);
                }
            }
        }

        // Handle result messages (final output)
        if (msg.type === 'result' && msg.subtype === 'success') {
            // Reset message ID for new result message
            this.currentMessageId = undefined;
            this.emit('output', {
                text: msg.result,
                messageType: 'new',
                messageId: `result-${Date.now()}`,
            });
        }

        // Handle error results
        if (msg.type === 'result' && msg.subtype !== 'success') {
            console.error(`[Claude ${this.id}] Result error: ${msg.subtype}`);
            if (msg.errors && msg.errors.length > 0) {
                console.error(`[Claude ${this.id}] Errors:`, msg.errors);
            }
        }
    }

    private checkForPatterns(data: string): void {
        // Check for user question prompt
        if (data.includes('[QUESTION_FOR_USER]')) {
            const match = data.match(/\[QUESTION_FOR_USER\](.*?)\[\/QUESTION_FOR_USER\]/s);
            if (match) {
                this.emit('question', match[1].trim());
            }
        }

        // Check for completion signal
        if (data.includes('[TASK_COMPLETE]')) {
            this.emit('task_complete');
        }
    }

    async interrupt(): Promise<string | null> {
        if (this.session) {
            this.session.close();
            this.session = undefined;
        }
        return this.sessionId || null;
    }

    async stop(): Promise<void> {
        this.clearTimers();

        if (this.session) {
            this.session.close();
            this.session = undefined;
        }

        this.options.db.updateClaudeInstance(this.id, {
            status: 'stopped',
            resume_id: this.sessionId || null,
        });
    }

    getRecord(): ClaudeInstanceRecord | undefined {
        return this.options.db.getClaudeInstance(this.id);
    }

    private startCompletionPolling(): void {
        const interval = this.options.completionPollingInterval || 30000; // Default 30 seconds

        this.completionPollingTimer = setInterval(() => {
            this.checkOwnCompletion();
        }, interval);

        console.log(`[Claude ${this.id}] Started completion polling (interval: ${interval}ms)`);
    }

    private checkOwnCompletion(): void {
        if (this.role !== 'coordinator' || !this.options.contextId) {
            return;
        }

        const specId = this.options.contextId;
        const taskGroups = this.options.db.getTaskGroupsForSpec(specId);

        // If no task groups exist yet, not complete
        if (taskGroups.length === 0) {
            return;
        }

        // Check if all task groups are done
        const allDone = taskGroups.every((tg) => tg.status === 'done');

        if (allDone) {
            console.log(`[Claude ${this.id}] All task groups complete for spec ${specId}, exiting...`);
            this.exitGracefully();
        }
    }

    private async exitGracefully(): Promise<void> {
        console.log(`[Claude ${this.id}] Exiting gracefully`);

        // Clear timers first
        this.clearTimers();

        // Send a final message to let Claude know it's done
        try {
            await this.sendMessage('All task groups are complete. Your work on this spec is done.');
        } catch (e) {
            console.error(`[Claude ${this.id}] Error sending final message:`, e);
        }

        // Wait a moment for the message to complete, then close session
        setTimeout(() => {
            if (this.session) {
                this.session.close();
                this.session = undefined;
            }

            // Update status in db
            this.options.db.updateClaudeInstance(this.id, {
                status: 'completed',
                resume_id: this.sessionId || null,
            });

            // Emit idle event to trigger spec completion check
            this.emit('idle');
        }, 2000);
    }

    private startMaxRuntimeTimer(): void {
        const maxRuntime = this.options.maxRuntime !== undefined
            ? this.options.maxRuntime
            : 2 * 60 * 60 * 1000; // Default 2 hours (backward compatibility)

        // If maxRuntime is explicitly undefined or 0, don't set a timer (infinite runtime)
        if (maxRuntime === undefined || maxRuntime === 0) {
            console.log(`[Claude ${this.id}] No max runtime limit set (infinite)`);
            return;
        }

        this.maxRuntimeTimer = setTimeout(() => {
            console.error(`[Claude ${this.id}] Maximum runtime exceeded (${maxRuntime}ms), forcing exit`);
            this.handleTimeout();
        }, maxRuntime);

        console.log(`[Claude ${this.id}] Started max runtime timer (${maxRuntime}ms = ${Math.floor(maxRuntime / 60000)} minutes)`);
    }

    private handleTimeout(): void {
        // Clear polling timer
        if (this.completionPollingTimer) {
            clearInterval(this.completionPollingTimer);
            this.completionPollingTimer = undefined;
        }

        // Close the session
        if (this.session) {
            console.log(`[Claude ${this.id}] Closing session due to timeout`);
            this.session.close();
            this.session = undefined;
        }

        // Update status and record error
        this.options.db.updateClaudeInstance(this.id, {
            status: 'timeout',
            resume_id: this.sessionId || null,
        });

        // If this is a coordinator, mark the spec with an error
        if (this.role === 'coordinator' && this.options.contextId) {
            const spec = this.options.db.getSpec(this.options.contextId);
            if (spec) {
                console.error(`[Claude ${this.id}] Spec ${this.options.contextId} timed out`);
                this.options.db.updateSpec(this.options.contextId, {
                    error_message: `Coordinator instance exceeded maximum runtime (${this.options.maxRuntime || 2 * 60 * 60 * 1000}ms)`,
                    status: 'error',
                });
            }
        }

        // Emit error event
        this.emit('error', new Error('Maximum runtime exceeded'));
        this.emit('idle');
    }

    private clearTimers(): void {
        if (this.completionPollingTimer) {
            clearInterval(this.completionPollingTimer);
            this.completionPollingTimer = undefined;
        }

        if (this.maxRuntimeTimer) {
            clearTimeout(this.maxRuntimeTimer);
            this.maxRuntimeTimer = undefined;
        }
    }
}
