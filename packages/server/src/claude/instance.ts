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

export class ClaudeInstance extends EventEmitter {
    private paneInfo?: PaneInfo;
    private poller?: PanePoller;
    private outputBuffer = '';

    constructor(private options: ClaudeInstanceOptions) {
        super();
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

        // Create tmux window
        const windowName = `${role}-${id.slice(0, 8)}`;
        this.paneInfo = await tmux.createWindow(windowName);

        // Build claude command
        let cmd = `cd ${worktreePath} && claude`;
        if (resumeId) {
            cmd += ` --resume ${resumeId}`;
        }

        // Start claude
        await tmux.sendCommand(this.paneInfo.paneId, cmd);

        // Update db
        db.createClaudeInstance({
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

        // Check for resume ID on exit
        const resumeMatch = data.match(/Resume ID: ([a-zA-Z0-9_-]+)/);
        if (resumeMatch) {
            this.emit('resume_id', resumeMatch[1]);
        }
    }

    async sendMessage(message: string): Promise<void> {
        if (!this.paneInfo) {
            throw new Error('Claude instance not started');
        }

        await this.options.tmux.sendText(this.paneInfo.paneId, message);
        await this.options.tmux.sendKeys(this.paneInfo.paneId, 'Enter');
    }

    async interrupt(): Promise<string | null> {
        if (!this.paneInfo) {
            return null;
        }

        // Send Ctrl+C
        await this.options.tmux.sendKeys(this.paneInfo.paneId, 'C-c');

        // Wait for resume ID
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(null);
            }, 10000);

            this.once('resume_id', (resumeId: string) => {
                clearTimeout(timeout);
                resolve(resumeId);
            });
        });
    }

    async stop(): Promise<void> {
        if (this.poller) {
            this.poller.stop();
        }

        if (this.paneInfo) {
            await this.options.tmux.killWindow(this.paneInfo.windowId);
        }

        this.options.db.updateClaudeInstance(this.id, { status: 'stopped' });
    }

    getRecord(): ClaudeInstanceRecord | undefined {
        return this.options.db.getClaudeInstance(this.id);
    }
}
