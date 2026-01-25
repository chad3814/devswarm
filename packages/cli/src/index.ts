#!/usr/bin/env node

import Docker from 'dockerode';
import getPort from 'get-port';
import open from 'open';
import { program } from 'commander';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

function getGhToken(): string | null {
    try {
        return execSync('gh auth token', { encoding: 'utf-8' }).trim();
    } catch {
        return null;
    }
}

const docker = new Docker();
const IMAGE = 'orchestr8:latest';
const PORT_RANGE_START = 3814;

interface RepoInfo {
    owner: string;
    repo: string;
    url: string;
}

function parseRepo(input: string): RepoInfo {
    const patterns = [
        /^([^/]+)\/([^/]+)$/,
        /github\.com[/:]([^/]+)\/([^/.]+)/,
    ];

    for (const pattern of patterns) {
        const match = input.match(pattern);
        if (match) {
            const [, owner, repo] = match;
            const repoName = repo.replace(/\.git$/, '');
            return {
                owner,
                repo: repoName,
                url: `https://github.com/${owner}/${repoName}.git`,
            };
        }
    }

    throw new Error(`Cannot parse repo: ${input}`);
}

function containerName(info: RepoInfo): string {
    return `orchestr8-${info.owner}-${info.repo}`;
}

function volumeName(info: RepoInfo): string {
    return `orchestr8-${info.owner}-${info.repo}-data`;
}

async function findAvailablePort(): Promise<number> {
    return getPort({ port: Array.from({ length: 50 }, (_, i) => PORT_RANGE_START + i) });
}

async function getContainerPort(container: Docker.Container): Promise<number> {
    const info = await container.inspect();
    const portLabel = info.Config.Labels?.['orchestr8.port'];
    if (!portLabel) {
        throw new Error('Container missing orchestr8.port label');
    }
    return parseInt(portLabel, 10);
}

async function startContainer(info: RepoInfo): Promise<{ port: number; containerId: string }> {
    const name = containerName(info);
    const volume = volumeName(info);

    const containers = await docker.listContainers({ all: true, filters: { name: [name] } });

    if (containers.length > 0) {
        const existing = containers[0];

        if (existing.State === 'running') {
            const port = parseInt(existing.Labels['orchestr8.port'], 10);
            console.log(`Container already running on port ${port}`);
            return { port, containerId: existing.Id };
        }

        const container = docker.getContainer(existing.Id);
        await container.start();
        const port = parseInt(existing.Labels['orchestr8.port'], 10);
        console.log(`Resumed container on port ${port}`);
        return { port, containerId: existing.Id };
    }

    const port = await findAvailablePort();

    try {
        await docker.createVolume({ Name: volume });
    } catch {
        // Volume may already exist
    }

    // Build bind mounts
    const binds = [`${volume}:/data`];

    // Mount host Claude credentials if available (to temp location, copied by entrypoint)
    const hostClaudeJson = join(homedir(), '.claude.json');
    if (existsSync(hostClaudeJson)) {
        console.log('Found ~/.claude.json, mounting into container');
        binds.push(`${hostClaudeJson}:/tmp/host-claude.json:ro`);
    }

    // Build environment variables
    const env = [
        `PORT=${port}`,
        `REPO_URL=${info.url}`,
        `REPO_OWNER=${info.owner}`,
        `REPO_NAME=${info.repo}`,
    ];

    // Get GitHub token from gh CLI (stored in system keychain on macOS)
    const ghToken = getGhToken();
    if (ghToken) {
        console.log('Found GitHub token from gh CLI');
        env.push(`GH_TOKEN=${ghToken}`);
    }

    const container = await docker.createContainer({
        Image: IMAGE,
        name,
        Env: env,
        Labels: {
            'orchestr8.port': String(port),
            'orchestr8.repo': `${info.owner}/${info.repo}`,
        },
        HostConfig: {
            Binds: binds,
            PortBindings: {
                [`${port}/tcp`]: [{ HostPort: String(port) }],
                '9418/tcp': [{ HostPort: '9418' }],
            },
        },
        ExposedPorts: {
            [`${port}/tcp`]: {},
            '9418/tcp': {},
        },
    });

    await container.start();
    console.log(`Started container on port ${port}`);

    return { port, containerId: container.id };
}

async function waitForServer(port: number, timeoutMs = 60000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`http://localhost:${port}/health`);
            if (res.ok) return;
        } catch {
            // Not ready yet
        }
        await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error('Server failed to start within timeout');
}

async function followLogs(containerId: string, onReady: () => void): Promise<void> {
    const container = docker.getContainer(containerId);
    const stream = await container.logs({ follow: true, stdout: true, stderr: true, tail: 50 });

    let ready = false;

    stream.on('data', (chunk: Buffer) => {
        const line = chunk.toString();
        process.stdout.write(line);

        if (!ready && line.includes('Server listening on port')) {
            ready = true;
            onReady();
        }
    });
}

async function listContainers(): Promise<void> {
    const containers = await docker.listContainers({
        all: true,
        filters: { label: ['orchestr8.repo'] },
    });

    if (containers.length === 0) {
        console.log('No orchestr8 containers found');
        return;
    }

    console.log('\nOrchestrator containers:\n');
    for (const c of containers) {
        const repo = c.Labels['orchestr8.repo'];
        const port = c.Labels['orchestr8.port'];
        const state = c.State;
        console.log(`  ${repo.padEnd(40)} ${state.padEnd(10)} port ${port}`);
    }
    console.log('');
}

async function stopContainer(repoArg: string): Promise<void> {
    const info = parseRepo(repoArg);
    const name = containerName(info);

    const containers = await docker.listContainers({ all: true, filters: { name: [name] } });
    if (containers.length === 0) {
        console.log(`No container found for ${info.owner}/${info.repo}`);
        return;
    }

    const container = docker.getContainer(containers[0].Id);
    const port = await getContainerPort(container);

    console.log('Initiating graceful shutdown...');
    try {
        await fetch(`http://localhost:${port}/shutdown`, { method: 'POST' });
        console.log('Shutdown signal sent. Waiting for container to stop...');

        // Wait for container to stop
        let attempts = 0;
        while (attempts < 60) {
            const info = await container.inspect();
            if (!info.State.Running) {
                console.log('Container stopped successfully');
                return;
            }
            await new Promise((r) => setTimeout(r, 1000));
            attempts++;
        }

        console.log('Container did not stop gracefully, forcing...');
        await container.stop();
    } catch {
        console.log('Could not reach server, stopping container directly...');
        await container.stop();
    }

    console.log('Container stopped');
}

async function removeContainer(repoArg: string, options: { purge?: boolean } = {}): Promise<void> {
    const info = parseRepo(repoArg);
    const name = containerName(info);
    const volume = volumeName(info);

    const containers = await docker.listContainers({ all: true, filters: { name: [name] } });
    if (containers.length === 0) {
        console.log(`No container found for ${info.owner}/${info.repo}`);
        return;
    }

    const container = docker.getContainer(containers[0].Id);

    try {
        await container.stop();
    } catch {
        // May already be stopped
    }

    await container.remove();
    console.log('Container removed');

    if (options.purge) {
        try {
            await docker.getVolume(volume).remove();
            console.log('Volume removed');
        } catch {
            console.log('Volume not found or could not be removed');
        }
    } else {
        console.log('Volume preserved (use --purge to remove data)');
    }
}

async function tailLogs(repoArg: string): Promise<void> {
    const info = parseRepo(repoArg);
    const name = containerName(info);

    const containers = await docker.listContainers({ all: true, filters: { name: [name] } });
    if (containers.length === 0) {
        console.log(`No container found for ${info.owner}/${info.repo}`);
        return;
    }

    const container = docker.getContainer(containers[0].Id);
    const stream = await container.logs({ follow: true, stdout: true, stderr: true, tail: 100 });

    stream.on('data', (chunk: Buffer) => {
        process.stdout.write(chunk.toString());
    });

    process.on('SIGINT', () => {
        process.exit(0);
    });
}

async function startOrAttach(repoArg: string): Promise<void> {
    const info = parseRepo(repoArg);
    console.log(`Starting orchestr8 for ${info.owner}/${info.repo}...`);

    const { port, containerId } = await startContainer(info);

    followLogs(containerId, () => {
        console.log(`\nOpening http://localhost:${port}`);
        open(`http://localhost:${port}`);
    });

    process.on('SIGINT', async () => {
        console.log('\nInitiating graceful shutdown...');
        try {
            await fetch(`http://localhost:${port}/shutdown`, { method: 'POST' });
        } catch {
            // Server may already be down
        }
        process.exit(0);
    });
}

program
    .name('orchestr8')
    .description('Agentic coding orchestrator')
    .version('0.1.0');

program
    .command('start <repo>')
    .description('Start or attach to an orchestrator for a repository')
    .action(startOrAttach);

program
    .command('list')
    .description('List all orchestr8 containers')
    .action(listContainers);

program
    .command('stop <repo>')
    .description('Gracefully stop an orchestrator')
    .action(stopContainer);

program
    .command('rm <repo>')
    .description('Remove an orchestrator container (preserves data volume)')
    .option('--purge', 'Also remove the data volume (deletes all data including auth)')
    .action((repo, options) => removeContainer(repo, options));

program
    .command('logs <repo>')
    .description('Tail logs from an orchestrator')
    .action(tailLogs);

// Default command - if just a repo is provided
program
    .argument('[repo]', 'Repository to orchestrate (owner/repo or full URL)')
    .action(async (repo) => {
        if (repo) {
            await startOrAttach(repo);
        } else {
            program.help();
        }
    });

program.parse();
