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

/**
 * ClaudeInstance manages a Claude CLI session using print mode.
 *
 * Instead of running Claude interactively (which triggers onboarding prompts),
 * we keep a shell in a tmux pane and invoke Claude with -p (print mode) for each message.
 * The --continue flag maintains conversation context within the same directory.
 *
 * This approach:
 * - Avoids interactive onboarding prompts
 * - Maintains conversation context via --continue
 * - Allows reliable output capture
 * - Works in automated/headless environments
 */
export class ClaudeInstance extends EventEmitter {
    private paneInfo?: PaneInfo;
    private poller?: PanePoller;
    private outputBuffer = '';
    private isProcessing = false;
    private sessionId?: string;

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

        // Create tmux window with a shell (not Claude directly)
        const windowName = `${role}-${id.slice(0, 8)}`;
        console.log(`[Claude ${id}] Creating tmux window: ${windowName}`);
        this.paneInfo = await tmux.createWindow(windowName);
        console.log(`[Claude ${id}] Created pane: ${this.paneInfo.paneId}, window: ${this.paneInfo.windowId}`);

        // Change to worktree directory
        const cdCmd = `cd ${worktreePath}`;
        console.log(`[Claude ${id}] Changing to worktree: ${cdCmd}`);
        await tmux.sendCommand(this.paneInfo.paneId, cdCmd);

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

        console.log(`[Claude ${id}] Ready for messages (print mode)`);
    }

    private startCapture(): void {
        if (!this.paneInfo) return;

        this.poller = new PanePoller(this.options.tmux, this.paneInfo.paneId);

        this.poller.on('data', (data: string) => {
            this.outputBuffer += data;
            this.emit('output', data);

            // Check for patterns we care about
            this.checkForPatterns(data);
        });

        this.poller.start();
    }

    private checkForPatterns(data: string): void {
        // Check for user question prompt (this would depend on how we implement the tool)
        if (data.includes('[QUESTION_FOR_USER]')) {
            const match = this.outputBuffer.match(/\[QUESTION_FOR_USER\](.*?)\[\/QUESTION_FOR_USER\]/s);
            if (match) {
                this.emit('question', match[1].trim());
            }
        }

        // Check for completion signals
        if (data.includes('[TASK_COMPLETE]')) {
            this.emit('task_complete');
        }

        // Check for resume ID in output
        const resumeMatch = data.match(/Resume ID: ([a-zA-Z0-9_-]+)/);
        if (resumeMatch) {
            this.sessionId = resumeMatch[1];
            this.emit('resume_id', resumeMatch[1]);
        }

        // Check for session ID in Claude's output (format varies)
        const sessionMatch = data.match(/session[:\s]+([a-f0-9-]{36})/i);
        if (sessionMatch && !this.sessionId) {
            this.sessionId = sessionMatch[1];
        }
    }

    /**
     * Send a message to Claude using print mode.
     * Uses --continue to maintain conversation context.
     */
    async sendMessage(message: string): Promise<void> {
        if (!this.paneInfo) {
            throw new Error('Claude instance not started');
        }

        if (this.isProcessing) {
            console.log(`[Claude ${this.id}] Already processing, queueing message`);
            // Could implement a queue here if needed
            return;
        }

        this.isProcessing = true;

        // Escape the message for shell - use base64 to handle any special characters
        const base64Message = Buffer.from(message).toString('base64');

        // Build the claude command
        // Use -p for print mode, --continue to maintain context, --dangerously-skip-permissions
        let cmd = `echo "${base64Message}" | base64 -d | claude -p --dangerously-skip-permissions`;

        // Use --continue to maintain conversation in this directory
        // Or --resume if we have a session ID
        if (this.sessionId) {
            cmd += ` --resume ${this.sessionId}`;
        } else {
            cmd += ` --continue`;
        }

        console.log(`[Claude ${this.id}] Sending message (${message.length} chars)`);

        // Clear output buffer before new message
        this.outputBuffer = '';

        await this.options.tmux.sendCommand(this.paneInfo.paneId, cmd);

        // Note: isProcessing will be cleared when we detect the command completes
        // For now, just set a reasonable timeout
        setTimeout(() => {
            this.isProcessing = false;
        }, 5000);
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

        // Send Ctrl+C to interrupt any running claude command
        await this.options.tmux.sendKeys(this.paneInfo.paneId, 'C-c');

        // Return current session ID if we have one
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
