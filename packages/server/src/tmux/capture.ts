import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { TmuxManager } from './manager.js';

const exec = promisify(execCb);

export class PaneStreamer extends EventEmitter {
    private fifoPath: string;
    private fd?: number;
    private polling = false;

    constructor(
        private tmux: TmuxManager,
        private paneId: string,
        private instanceId: string,
    ) {
        super();
        this.fifoPath = path.join('/tmp', `orchestr8-${instanceId}.pipe`);
    }

    async start(): Promise<void> {
        // Create named pipe
        try {
            fs.unlinkSync(this.fifoPath);
        } catch {
            // File may not exist
        }

        await exec(`mkfifo ${this.fifoPath}`);

        // Start piping tmux output
        await this.tmux.pipePane(this.paneId, this.fifoPath);

        // Open fifo for reading (non-blocking)
        this.fd = fs.openSync(this.fifoPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);

        this.polling = true;
        this.poll();
    }

    private poll(): void {
        if (!this.polling || this.fd === undefined) return;

        const buf = Buffer.alloc(4096);
        try {
            const bytesRead = fs.readSync(this.fd, buf, 0, buf.length, null);
            if (bytesRead > 0) {
                const data = buf.toString('utf8', 0, bytesRead);
                this.emit('data', data);
            }
        } catch (e: unknown) {
            const err = e as NodeJS.ErrnoException;
            if (err.code !== 'EAGAIN') {
                this.emit('error', e);
                return;
            }
        }

        setTimeout(() => this.poll(), 50);
    }

    async stop(): Promise<void> {
        this.polling = false;

        await this.tmux.unpipePane(this.paneId);

        if (this.fd !== undefined) {
            fs.closeSync(this.fd);
            this.fd = undefined;
        }

        try {
            fs.unlinkSync(this.fifoPath);
        } catch {
            // File may already be removed
        }
    }
}

// Alternative: polling-based capture (simpler, no fifo)
export class PanePoller extends EventEmitter {
    private lastContent = '';
    private polling = false;
    private intervalId?: ReturnType<typeof setInterval>;

    constructor(
        private tmux: TmuxManager,
        private paneId: string,
    ) {
        super();
    }

    start(): void {
        this.polling = true;
        this.intervalId = setInterval(() => this.poll(), 100);
    }

    private async poll(): Promise<void> {
        if (!this.polling) return;

        try {
            const content = await this.tmux.capturePane(this.paneId, 100);

            if (content !== this.lastContent) {
                // Find new content
                const newContent = this.findNewContent(this.lastContent, content);
                if (newContent) {
                    console.log(`[PanePoller ${this.paneId}] New content (${newContent.length} chars)`);
                    this.emit('data', newContent);
                }
                this.lastContent = content;
            }
        } catch (e) {
            console.error(`[PanePoller ${this.paneId}] Error capturing pane:`, e);
        }
    }

    private findNewContent(oldContent: string, newContent: string): string {
        // Simple diff: find where old content ends in new content
        if (!oldContent) return newContent;

        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');

        // Find overlap
        for (let i = 0; i < oldLines.length; i++) {
            const remainder = oldLines.slice(i).join('\n');
            if (newContent.startsWith(remainder)) {
                return newContent.slice(remainder.length);
            }
        }

        // No overlap found, return all new content
        return newContent;
    }

    stop(): void {
        this.polling = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
    }
}
