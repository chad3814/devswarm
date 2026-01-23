import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const exec = promisify(execCb);

export interface MergeResult {
    success: boolean;
    conflicts: string[];
}

export class GitManager {
    constructor(
        private bareRepoPath: string,
        private worktreesPath: string,
    ) {}

    isInitialized(): boolean {
        return fs.existsSync(path.join(this.bareRepoPath, 'HEAD'));
    }

    async init(repoUrl: string): Promise<void> {
        // Clone as bare repo
        await exec(`git clone --bare ${repoUrl} ${this.bareRepoPath}`);

        // Create worktrees directory
        fs.mkdirSync(this.worktreesPath, { recursive: true });

        // Create main worktree for the main claude instance
        await this.createWorktree('main', 'main');

        // Start git daemon now that we have a repo
        this.startGitDaemon();
    }

    private startGitDaemon(): void {
        const { spawn } = require('child_process');
        spawn('git', [
            'daemon',
            '--reuseaddr',
            '--base-path=/data',
            '--export-all',
            '--enable=receive-pack',
            '--port=9418',
        ], {
            detached: true,
            stdio: 'ignore',
        }).unref();
    }

    private async git(args: string, cwd?: string): Promise<string> {
        const { stdout } = await exec(`git ${args}`, { cwd: cwd || this.bareRepoPath });
        return stdout.trim();
    }

    async createWorktree(name: string, baseBranch = 'main'): Promise<string> {
        const wtPath = path.join(this.worktreesPath, name);
        const branchName = name === 'main' ? 'main' : `orchestr8/${name}`;

        if (name === 'main') {
            await this.git(`worktree add ${wtPath} ${baseBranch}`);
        } else {
            await this.git(`worktree add -b ${branchName} ${wtPath} ${baseBranch}`);
        }

        return wtPath;
    }

    async forkWorktree(sourceName: string, newName: string): Promise<string> {
        const sourceWt = path.join(this.worktreesPath, sourceName);
        const sourceCommit = await this.git('rev-parse HEAD', sourceWt);

        const wtPath = path.join(this.worktreesPath, newName);
        const branchName = `orchestr8/${newName}`;

        await this.git(`worktree add -b ${branchName} ${wtPath} ${sourceCommit}`);

        return wtPath;
    }

    async getWorktreePath(name: string): Promise<string> {
        return path.join(this.worktreesPath, name);
    }

    async getCurrentBranch(worktreeName: string): Promise<string> {
        const wtPath = path.join(this.worktreesPath, worktreeName);
        return this.git('rev-parse --abbrev-ref HEAD', wtPath);
    }

    async commit(worktreeName: string, message: string): Promise<string> {
        const wtPath = path.join(this.worktreesPath, worktreeName);
        await this.git('add -A', wtPath);

        try {
            await this.git(`commit -m "${message.replace(/"/g, '\\"')}"`, wtPath);
        } catch (e: unknown) {
            const err = e as Error;
            if (err.message.includes('nothing to commit')) {
                return await this.git('rev-parse HEAD', wtPath);
            }
            throw e;
        }

        return this.git('rev-parse HEAD', wtPath);
    }

    async merge(sourceWorktreeName: string, targetWorktreeName: string): Promise<MergeResult> {
        const targetWt = path.join(this.worktreesPath, targetWorktreeName);
        const sourceBranch = await this.getCurrentBranch(sourceWorktreeName);

        try {
            await this.git(`merge ${sourceBranch} --no-edit`, targetWt);
            return { success: true, conflicts: [] };
        } catch (e: unknown) {
            const err = e as Error;
            if (err.message.includes('CONFLICT')) {
                const conflicts = await this.getConflictFiles(targetWorktreeName);
                return { success: false, conflicts };
            }
            throw e;
        }
    }

    async getConflictFiles(worktreeName: string): Promise<string[]> {
        const wtPath = path.join(this.worktreesPath, worktreeName);
        const output = await this.git('diff --name-only --diff-filter=U', wtPath);
        return output.split('\n').filter(Boolean);
    }

    async abortMerge(worktreeName: string): Promise<void> {
        const wtPath = path.join(this.worktreesPath, worktreeName);
        await this.git('merge --abort', wtPath);
    }

    async removeWorktree(name: string): Promise<void> {
        const wtPath = path.join(this.worktreesPath, name);
        await this.git(`worktree remove ${wtPath} --force`);
    }

    async push(worktreeName: string): Promise<void> {
        const wtPath = path.join(this.worktreesPath, worktreeName);
        const branch = await this.getCurrentBranch(worktreeName);
        await this.git(`push origin ${branch}`, wtPath);
    }

    async listWorktrees(): Promise<string[]> {
        const output = await this.git('worktree list --porcelain');
        const worktrees: string[] = [];

        for (const line of output.split('\n')) {
            if (line.startsWith('worktree ')) {
                const wtPath = line.replace('worktree ', '');
                if (wtPath.startsWith(this.worktreesPath)) {
                    worktrees.push(path.basename(wtPath));
                }
            }
        }

        return worktrees;
    }

    async createPullRequest(
        worktreeName: string,
        title: string,
        body: string,
    ): Promise<{ url: string; number: number }> {
        const wtPath = path.join(this.worktreesPath, worktreeName);
        const branch = await this.getCurrentBranch(worktreeName);

        // Push branch
        await this.git(`push -u origin ${branch}`, wtPath);

        // Create PR using gh CLI
        const { stdout } = await exec(
            `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --json url,number`,
            { cwd: wtPath }
        );

        return JSON.parse(stdout);
    }
}
