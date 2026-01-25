import { TmuxManager, PaneInfo } from '../tmux/manager.js';
import { PanePoller } from '../tmux/capture.js';
import { Db, ClaudeInstance as ClaudeInstanceRecord } from '../db/index.js';
import { EventEmitter } from 'events';

export type ClaudeRole = 'main' | 'spec_creator' | 'overseer' | 'worker';

export interface ClaudeInstanceOptions {
    id: string;
    role: ClaudeRole;
    db: Db;
    tmux: TmuxManager;
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
 * ClaudeInstance manages a Claude CLI session using print mode with streaming JSON.
 *
 * Uses `claude -p --output-format=stream-json` for each message, which:
 * - Avoids interactive onboarding prompts (OAuth, theme selection)
 * - Provides structured JSON output for clean parsing
 * - Maintains conversation context via --continue flag
 *
 * The tmux pane shows the raw commands but we parse the JSON and emit
 * only the meaningful assistant responses.
 */
export class ClaudeInstance extends EventEmitter {
    private paneInfo?: PaneInfo;
    private poller?: PanePoller;
    private rawBuffer = '';
    private sessionId?: string;
    private isProcessing = false;

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

    get paneId(): string | undefined {
        return this.paneInfo?.paneId;
    }

    async start(): Promise<void> {
        const { id, role, db, tmux, worktreePath, resumeId } = this.options;

        // Create tmux window with a shell
        const windowName = `${role}-${id.slice(0, 8)}`;
        console.log(`[Claude ${id}] Creating tmux window: ${windowName}`);
        this.paneInfo = await tmux.createWindow(windowName);
        console.log(`[Claude ${id}] Created pane: ${this.paneInfo.paneId}, window: ${this.paneInfo.windowId}`);

        // Change to worktree directory
        await tmux.sendCommand(this.paneInfo.paneId, `cd ${worktreePath}`);
        console.log(`[Claude ${id}] Changed to worktree: ${worktreePath}`);

        // Update db
        db.createClaudeInstance({
            id,
            role,
            tmux_pane: this.paneInfo.paneId,
            tmux_window: this.paneInfo.windowId,
            resume_id: resumeId || null,
            status: 'running',
            context_type: this.options.contextType || null,
            context_id: this.options.contextId || null,
            worktree_name: worktreePath.split('/').pop() || null,
        });

        // Start output capture
        this.startCapture();

        console.log(`[Claude ${id}] Ready for messages (streaming JSON mode)`);
    }

    private startCapture(): void {
        if (!this.paneInfo) return;

        this.poller = new PanePoller(this.options.tmux, this.paneInfo.paneId);

        this.poller.on('data', (data: string) => {
            this.rawBuffer += data;
            this.parseAndEmitOutput();
        });

        this.poller.start();
    }

    private processedPositions = new Set<number>();

    /**
     * Parse JSON objects from raw output and emit clean messages.
     * Uses brace balancing to find complete JSON objects.
     */
    private parseAndEmitOutput(): void {
        const buffer = this.rawBuffer;

        // Find JSON objects by looking for balanced braces
        let i = 0;
        while (i < buffer.length) {
            // Look for start of JSON object
            const start = buffer.indexOf('{', i);
            if (start === -1) break;

            // Skip if we've processed this position
            if (this.processedPositions.has(start)) {
                i = start + 1;
                continue;
            }

            // Find matching closing brace using balance counting
            let depth = 0;
            let end = -1;
            let inString = false;
            let escape = false;

            for (let j = start; j < buffer.length; j++) {
                const char = buffer[j];

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

            if (end === -1) {
                // Incomplete JSON, wait for more data
                break;
            }

            const jsonStr = buffer.substring(start, end);
            this.processedPositions.add(start);

            try {
                const msg: ClaudeStreamMessage = JSON.parse(jsonStr);

                // Extract session ID
                if (msg.session_id && !this.sessionId) {
                    this.sessionId = msg.session_id;
                    console.log(`[Claude ${this.id}] Got session ID: ${this.sessionId}`);
                }

                // Emit assistant messages
                if (msg.type === 'assistant' && msg.message?.content) {
                    for (const block of msg.message.content) {
                        if (block.type === 'text' && block.text) {
                            console.log(`[Claude ${this.id}] Emitting text (${block.text.length} chars)`);
                            this.emit('output', block.text);
                            this.checkForPatterns(block.text);
                        }
                    }
                }

                // Emit final result
                if (msg.type === 'result') {
                    console.log(`[Claude ${this.id}] Got result, processing complete`);
                    this.isProcessing = false;
                    this.emit('message_complete');

                    // Emit the final result text
                    if (msg.result) {
                        this.emit('output', msg.result);
                    }
                }
            } catch (e) {
                // Invalid JSON, skip
                console.log(`[Claude ${this.id}] Failed to parse JSON at position ${start}`);
            }

            i = end;
        }

        // Clean up old positions periodically
        if (this.processedPositions.size > 100) {
            const minToKeep = Math.max(0, buffer.length - 10000);
            for (const pos of this.processedPositions) {
                if (pos < minToKeep) {
                    this.processedPositions.delete(pos);
                }
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

        // Check for completion signals
        if (data.includes('[TASK_COMPLETE]')) {
            this.emit('task_complete');
        }

        // Check for resume ID
        const resumeMatch = data.match(/Resume ID: ([a-zA-Z0-9_-]+)/);
        if (resumeMatch) {
            this.sessionId = resumeMatch[1];
            this.emit('resume_id', resumeMatch[1]);
        }
    }

    /**
     * Send a message to Claude using print mode with streaming JSON.
     */
    async sendMessage(message: string): Promise<void> {
        if (!this.paneInfo) {
            throw new Error('Claude instance not started');
        }

        if (this.isProcessing) {
            console.log(`[Claude ${this.id}] Already processing, waiting...`);
            return;
        }

        this.isProcessing = true;
        this.rawBuffer = '';

        // Escape message for shell using heredoc to handle special chars
        const cmd = this.buildClaudeCommand(message);
        console.log(`[Claude ${this.id}] Sending message (${message.length} chars)`);

        await this.options.tmux.sendCommand(this.paneInfo.paneId, cmd);
    }

    private buildClaudeCommand(message: string): string {
        // Use heredoc for safe message passing
        const escapedMessage = message.replace(/'/g, "'\\''");
        let cmd = `echo '${escapedMessage}' | claude -p --dangerously-skip-permissions --output-format=stream-json --verbose`;

        if (this.sessionId) {
            cmd += ` --resume ${this.sessionId}`;
        } else {
            cmd += ` --continue`;
        }

        return cmd;
    }

    async sendKeys(keys: string): Promise<void> {
        if (!this.paneInfo) {
            throw new Error('Claude instance not started');
        }

        await this.options.tmux.sendKeys(this.paneInfo.paneId, keys);
    }

    async interrupt(): Promise<string | null> {
        if (!this.paneInfo) {
            return null;
        }

        await this.options.tmux.sendKeys(this.paneInfo.paneId, 'C-c');
        this.isProcessing = false;

        return this.sessionId || null;
    }

    async stop(): Promise<void> {
        if (this.poller) {
            this.poller.stop();
        }

        if (this.paneInfo) {
            await this.options.tmux.killWindow(this.paneInfo.windowId);
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
