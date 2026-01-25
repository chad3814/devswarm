import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

export interface PaneInfo {
    paneId: string;
    windowId: string;
    windowName: string;
}

export class TmuxManager {
    constructor(private sessionName: string) {}

    private async run(cmd: string): Promise<string> {
        console.log(`[Tmux] Running: ${cmd}`);
        try {
            const { stdout, stderr } = await exec(cmd);
            if (stderr) {
                console.log(`[Tmux] stderr: ${stderr}`);
            }
            return stdout.trim();
        } catch (e) {
            console.error(`[Tmux] Error running command:`, e);
            throw e;
        }
    }

    async createWindow(name: string): Promise<PaneInfo> {
        const output = await this.run(
            `tmux new-window -t ${this.sessionName} -n ${name} -P -F '#{pane_id}:#{window_id}:#{window_name}'`
        );

        const [paneId, windowId, windowName] = output.split(':');
        return { paneId, windowId, windowName };
    }

    async sendCommand(paneId: string, command: string): Promise<void> {
        const escaped = command.replace(/'/g, "'\\''");
        await this.run(`tmux send-keys -t '${paneId}' '${escaped}' Enter`);
    }

    async sendKeys(paneId: string, keys: string): Promise<void> {
        await this.run(`tmux send-keys -t '${paneId}' ${keys}`);
    }

    async sendText(paneId: string, text: string): Promise<void> {
        const escaped = text.replace(/'/g, "'\\''");
        await this.run(`tmux send-keys -t '${paneId}' -l '${escaped}'`);
    }

    async capturePane(paneId: string, lines = 500): Promise<string> {
        // Use -J to join wrapped lines (important for JSON output)
        return this.run(`tmux capture-pane -t '${paneId}' -p -J -S -${lines}`);
    }

    async killWindow(windowId: string): Promise<void> {
        try {
            await this.run(`tmux kill-window -t '${windowId}'`);
        } catch {
            // Window may already be dead
        }
    }

    async listPanes(): Promise<PaneInfo[]> {
        try {
            const output = await this.run(
                `tmux list-panes -s -t ${this.sessionName} -F '#{pane_id}:#{window_id}:#{window_name}'`
            );

            return output.split('\n').filter(Boolean).map((line) => {
                const [paneId, windowId, windowName] = line.split(':');
                return { paneId, windowId, windowName };
            });
        } catch {
            return [];
        }
    }

    async pipePane(paneId: string, pipePath: string): Promise<void> {
        await this.run(`tmux pipe-pane -t '${paneId}' -o 'cat >> ${pipePath}'`);
    }

    async unpipePane(paneId: string): Promise<void> {
        await this.run(`tmux pipe-pane -t '${paneId}'`);
    }
}
