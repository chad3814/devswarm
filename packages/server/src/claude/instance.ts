import { spawn, ChildProcess } from 'child_process';
import { Db, ClaudeInstance as ClaudeInstanceRecord } from '../db/index.js';
import { EventEmitter } from 'events';

export type ClaudeRole = 'main' | 'spec_creator' | 'coordinator' | 'worker' | 'roadmap_migrator';

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
}

interface ClaudeStreamMessage {
    type: 'system' | 'assistant' | 'result' | 'user';
    subtype?: string;
    message?: {
        content?: Array<{ type: string; text?: string }>;
    };
    result?: string;
    session_id?: string;
}

/**
 * ClaudeInstance manages a Claude CLI session using streaming JSON output.
 *
 * Spawns `claude -p --output-format=stream-json` for each message, which:
 * - Provides structured JSON output for clean parsing
 * - Maintains conversation context via --resume flag
 * - Runs in the specified worktree directory
 */
export class ClaudeInstance extends EventEmitter {
    private process?: ChildProcess;
    private sessionId?: string;
    private buffer = '';
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
        const args = [
            '-p',
            '--verbose',
            '--output-format=stream-json',
            '--dangerously-skip-permissions',
        ];

        // Add model flag if CLAUDE_MODEL environment variable is set
        const modelEnv = process.env.CLAUDE_MODEL;
        if (modelEnv) {
            args.push('--model', modelEnv);
        }

        if (this.sessionId) {
            args.push('--resume', this.sessionId);
        } else {
            args.push('--continue');
        }

        console.log(`[Claude ${this.id}] Sending message (${message.length} chars)`);

        this.process = spawn('claude', args, {
            cwd: this.options.worktreePath,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.buffer = '';
        // Reset message ID for new conversation turn
        this.currentMessageId = undefined;

        this.process.stdout?.on('data', (chunk: Buffer) => {
            this.buffer += chunk.toString();
            this.parseOutput();
        });

        this.process.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            if (text.trim()) {
                console.error(`[Claude ${this.id}] stderr:`, text);
            }
        });

        this.process.on('close', (code) => {
            console.log(`[Claude ${this.id}] Process exited (code ${code})`);
            this.emit('message_complete');
            this.emit('idle'); // Signal that this instance is now idle
        });

        this.process.on('error', (err) => {
            console.error(`[Claude ${this.id}] Process error:`, err);
            this.emit('error', err);
        });

        // Write message to stdin and close
        this.process.stdin?.write(message);
        this.process.stdin?.end();
    }

    private parseOutput(): void {
        // Find complete JSON objects using brace balancing
        while (true) {
            const start = this.buffer.indexOf('{');
            if (start === -1) break;

            let depth = 0;
            let end = -1;
            let inString = false;
            let escape = false;

            for (let j = start; j < this.buffer.length; j++) {
                const char = this.buffer[j];

                if (escape) {
                    escape = false;
                    continue;
                }

                if (char === '\\' && inString) {
                    escape = true;
                    continue;
                }

                if (char === '"' && !escape) {
                    inString = !inString;
                    continue;
                }

                if (!inString) {
                    if (char === '{') depth++;
                    if (char === '}') {
                        depth--;
                        if (depth === 0) {
                            end = j + 1;
                            break;
                        }
                    }
                }
            }

            if (end === -1) break; // Incomplete JSON, wait for more data

            const jsonStr = this.buffer.substring(start, end);
            this.buffer = this.buffer.substring(end);

            try {
                const msg: ClaudeStreamMessage = JSON.parse(jsonStr);
                this.handleMessage(msg);
            } catch {
                console.error(`[Claude ${this.id}] Failed to parse JSON:`, jsonStr.substring(0, 100));
            }
        }
    }

    private handleMessage(msg: ClaudeStreamMessage): void {
        // Extract session ID for resumption
        if (msg.session_id && !this.sessionId) {
            this.sessionId = msg.session_id;
            console.log(`[Claude ${this.id}] Session ID: ${this.sessionId}`);

            // Update db with session ID
            this.options.db.updateClaudeInstance(this.id, {
                resume_id: this.sessionId,
            });
        }

        // Emit assistant text blocks
        if (msg.type === 'assistant' && msg.message?.content) {
            // Generate message ID for new assistant message if not already set
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

        // Emit final result
        if (msg.type === 'result' && msg.result) {
            // Reset message ID for new result message
            this.currentMessageId = undefined;
            this.emit('output', {
                text: msg.result,
                messageType: 'new',
                messageId: `result-${Date.now()}`,
            });
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
        if (this.process && !this.process.killed) {
            this.process.kill('SIGINT');
        }
        return this.sessionId || null;
    }

    async stop(): Promise<void> {
        this.clearTimers();

        if (this.process && !this.process.killed) {
            this.process.kill();
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
            await this.sendMessage('All task groups are complete. Your work on this spec is done. The system will now exit this instance.');
        } catch (e) {
            console.error(`[Claude ${this.id}] Error sending final message:`, e);
        }

        // Wait a moment for the message to complete
        setTimeout(() => {
            // Kill the process if it's still running
            if (this.process && !this.process.killed) {
                console.log(`[Claude ${this.id}] Killing process`);
                this.process.kill('SIGTERM');

                // Force kill after 10 seconds if still running
                setTimeout(() => {
                    if (this.process && !this.process.killed) {
                        console.log(`[Claude ${this.id}] Force killing process`);
                        this.process.kill('SIGKILL');
                    }
                }, 10000);
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

        // Kill the process
        if (this.process && !this.process.killed) {
            console.log(`[Claude ${this.id}] Killing process due to timeout`);
            this.process.kill('SIGKILL');
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
