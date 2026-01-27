import { spawnSync } from 'child_process';

export interface GitHubRepoInfo {
    owner: string;
    repo: string;
}

/**
 * Extracts GitHub owner and repository name from the git remote URL.
 * Handles both HTTPS and SSH formats:
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 *
 * @param workingDir - Optional working directory to run git command in
 * @returns GitHub repository info or null if not a GitHub repo
 */
export function getGitHubRepoInfo(workingDir?: string): GitHubRepoInfo | null {
    try {
        const options = workingDir ? { cwd: workingDir, encoding: 'utf-8' as const } : { encoding: 'utf-8' as const };
        const result = spawnSync('git', ['remote', 'get-url', 'origin'], options);
        if (result.status !== 0) {
            return null;
        }
        const remoteUrl = result.stdout.toString().trim();

        // Parse HTTPS format: https://github.com/owner/repo.git
        const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
        if (httpsMatch) {
            return {
                owner: httpsMatch[1],
                repo: httpsMatch[2],
            };
        }

        // Parse SSH format: git@github.com:owner/repo.git
        const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
        if (sshMatch) {
            return {
                owner: sshMatch[1],
                repo: sshMatch[2],
            };
        }

        // Not a GitHub URL
        return null;
    } catch (error) {
        console.error('Error getting GitHub repo info:', error);
        return null;
    }
}
