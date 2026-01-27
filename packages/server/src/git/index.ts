import { exec as execCb, spawn } from 'child_process';
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
        const branchName = name === 'main' ? 'main' : `devswarm/${name}`;

        // Check if worktree already exists
        const existingWorktrees = await this.listWorktrees();
        if (existingWorktrees.includes(name)) {
            // Verify it's in good state
            if (await this.worktreeIsValid(wtPath)) {
                console.log(`[GitManager] Worktree ${name} already exists, reusing`);
                return wtPath;
            } else {
                console.log(`[GitManager] Worktree ${name} exists but is invalid, removing`);
                await this.removeWorktree(name);
            }
        }

        // Check if branch exists without worktree (stale branch)
        if (name !== 'main' && await this.branchExists(branchName)) {
            console.log(`[GitManager] Branch ${branchName} exists without worktree, removing branch`);
            await this.git(`branch -D ${branchName}`);
        }

        // Create new worktree
        if (name === 'main') {
            await this.git(`worktree add ${wtPath} ${baseBranch}`);
        } else {
            await this.git(`worktree add -b ${branchName} ${wtPath} ${baseBranch}`);
        }

        console.log(`[GitManager] Created new worktree ${name}`);
        return wtPath;
    }

    async forkWorktree(sourceName: string, newName: string): Promise<string> {
        const sourceWt = path.join(this.worktreesPath, sourceName);
        const sourceCommit = await this.git('rev-parse HEAD', sourceWt);

        const wtPath = path.join(this.worktreesPath, newName);
        const branchName = `devswarm/${newName}`;

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
            await this.git(`merge ${sourceBranch} --no-edit --no-ff --no-squash`, targetWt);
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

    async hasUnpushedCommits(worktreeName: string): Promise<boolean> {
        const wtPath = path.join(this.worktreesPath, worktreeName);
        const branch = await this.getCurrentBranch(worktreeName);

        try {
            // Check if there are commits on local branch not on remote
            const output = await this.git(`rev-list origin/${branch}..${branch} --count`, wtPath);
            const count = parseInt(output.trim(), 10);
            return count > 0;
        } catch (error: unknown) {
            // If remote branch doesn't exist, we have unpushed commits
            const err = error as Error;
            if (err.message.includes('unknown revision') || err.message.includes('does not have any commits yet')) {
                return true;
            }
            // On other errors, assume we need to push (safe default)
            console.warn(`[GitManager] Could not check unpushed commits for ${worktreeName}: ${err.message}`);
            return true;
        }
    }

    async push(worktreeName: string): Promise<void> {
        const wtPath = path.join(this.worktreesPath, worktreeName);
        const branch = await this.getCurrentBranch(worktreeName);

        try {
            await this.git(`push origin ${branch}`, wtPath);
            console.log(`[GitManager] Successfully pushed ${branch} to origin from worktree ${worktreeName}`);
        } catch (error: unknown) {
            const err = error as Error & { stderr?: string };
            const errorMessage = err.stderr || err.message || String(error);

            // Log meaningful error messages for common failure scenarios
            if (errorMessage.includes('Authentication failed') || errorMessage.includes('could not read Username')) {
                console.error(`[GitManager] Push failed: GitHub authentication required. Ensure gh auth is configured.`);
                throw new Error('Push failed: GitHub authentication required');
            } else if (errorMessage.includes('rejected') && errorMessage.includes('non-fast-forward')) {
                console.error(`[GitManager] Push failed: Remote has changes not present locally. Pull and merge first.`);
                throw new Error('Push failed: Remote branch has diverged');
            } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('Could not resolve host')) {
                console.error(`[GitManager] Push failed: Network connectivity issue. Check internet connection.`);
                throw new Error('Push failed: Network error');
            } else if (errorMessage.includes('Permission denied') || errorMessage.includes('403')) {
                console.error(`[GitManager] Push failed: Permission denied. Check repository access rights.`);
                throw new Error('Push failed: Permission denied');
            } else {
                console.error(`[GitManager] Push failed with unexpected error: ${errorMessage}`);
                throw new Error(`Push failed: ${errorMessage}`);
            }
        }
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

    private async worktreeIsValid(wtPath: string): Promise<boolean> {
        try {
            // Check if directory exists
            if (!fs.existsSync(wtPath)) {
                return false;
            }
            // Check if it's a valid git worktree
            await this.git('rev-parse --is-inside-work-tree', wtPath);
            return true;
        } catch {
            return false;
        }
    }

    private async branchExists(branchName: string): Promise<boolean> {
        try {
            await this.git(`rev-parse --verify ${branchName}`);
            return true;
        } catch {
            return false;
        }
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
        // Note: The merge method (squash, merge commit, or rebase) is controlled by
        // GitHub repository settings when the PR is merged. This command only creates
        // the PR. To preserve full commit history, repository administrators should
        // configure the repo to allow/default to "merge commits" rather than "squash and merge".
        const { stdout } = await exec(
            `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --json url,number`,
            { cwd: wtPath }
        );

        return JSON.parse(stdout);
    }
}
