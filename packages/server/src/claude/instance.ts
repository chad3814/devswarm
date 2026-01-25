import { spawn, ChildProcess } from 'child_process';
import { Db, ClaudeInstance as ClaudeInstanceRecord } from '../db/index.js';
import { EventEmitter } from 'events';

export type ClaudeRole = 'main' | 'spec_creator' | 'overseer' | 'worker';

export interface ClaudeInstanceOptions {
    id: string;
    role: ClaudeRole;
    db: Db;
    worktreePath: string;
    systemPrompt?: string;
    resumeId?: string;
    contextType?: string;
    contextId?: string;
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
    }

    async sendMessage(message: string): Promise<void> {
        const args = [
            '-p',
            '--verbose',
            '--output-format=stream-json',
            '--dangerously-skip-permissions',
        ];

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
            for (const block of msg.message.content) {
                if (block.type === 'text' && block.text) {
                    this.emit('output', block.text);
                    this.checkForPatterns(block.text);
                }
            }
        }

        // Emit final result
        if (msg.type === 'result' && msg.result) {
            this.emit('output', msg.result);
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
}
