export const config = {
    port: parseInt(process.env.PORT || '3814', 10),
    repoUrl: process.env.REPO_URL!,
    repoOwner: process.env.REPO_OWNER!,
    repoName: process.env.REPO_NAME!,

    // Paths
    dataDir: '/data',
    dbPath: '/data/db/orchestr8.sqlite',
    bareRepoPath: '/data/bare.git',
    worktreesPath: '/data/worktrees',
    statePath: '/data/state',
    configPath: '/data/config',
};
