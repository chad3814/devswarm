import { GitHubAuth } from './auth.js';

export interface GitHubIssue {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: string;
    labels: { name: string }[];
    pull_request?: unknown;
}

export async function fetchGitHubIssues(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'open',
): Promise<GitHubIssue[]> {
    const auth = new GitHubAuth();
    const token = await auth.getToken();

    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const issues: GitHubIssue[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}&page=${page}`;
        const res = await fetch(url, { headers });

        if (!res.ok) {
            throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
        }

        const data = await res.json() as GitHubIssue[];

        // Filter out pull requests (they come back in the issues endpoint)
        const realIssues = data.filter((item) => !item.pull_request);
        issues.push(...realIssues);

        if (data.length < perPage) {
            break;
        }

        page++;
    }

    return issues;
}

export async function getIssue(owner: string, repo: string, issueNumber: number): Promise<GitHubIssue> {
    const auth = new GitHubAuth();
    const token = await auth.getToken();

    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    return res.json();
}

export async function closeIssue(owner: string, repo: string, issueNumber: number): Promise<void> {
    const auth = new GitHubAuth();
    const token = await auth.getToken();

    if (!token) {
        throw new Error('Not authenticated with GitHub');
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state: 'closed' }),
    });

    if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }
}
