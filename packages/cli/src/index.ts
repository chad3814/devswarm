#!/usr/bin/env node

import Docker from 'dockerode';
import getPort from 'get-port';
import open from 'open';
import { program } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { spawnSync, spawn } from 'child_process';
import * as readline from 'readline';
import { fileURLToPath } from 'url';

const docker = new Docker();

/**
 * Read the package version from package.json
 */
function getPackageVersion(): string {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const pkgPath = join(__dirname, '../package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        return pkg.version;
    } catch (error) {
        console.warn('Failed to read package version, defaulting to dev tag');
        return 'unknown';
    }
}

/**
 * Determine the default Docker image tag based on the CLI version
 * - Development versions (containing '-dev.') use 'dev' tag
 * - Release versions use 'latest' tag
 * - Unknown/malformed versions default to 'dev' for safety
 */
function getDefaultTag(version: string): 'dev' | 'latest' {
    // If version detection failed, use dev tag as safe fallback
    if (version === 'unknown') {
        return 'dev';
    }

    if (version.includes('-dev.')) {
        return 'dev';
    }
    return 'latest';
}

const VERSION = getPackageVersion();
const DEFAULT_TAG = getDefaultTag(VERSION);
const IMAGE_REPO = 'ghcr.io/chad3814/devswarm';
const PORT_RANGE_START = 3814;

function getImageName(tag: string = DEFAULT_TAG): string {
    return `${IMAGE_REPO}:${tag}`;
}

// Config directory: XDG_CONFIG_HOME/devswarm or ~/.config/devswarm
function getConfigDir(): string {
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return join(xdgConfig, 'devswarm');
}

function ensureConfigDir(): string {
    const dir = getConfigDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}

async function ensureImage(tag: string = DEFAULT_TAG, forcePull: boolean = false): Promise<void> {
    const image = getImageName(tag);

    // Check if image exists locally
    if (!forcePull) {
        try {
            await docker.getImage(image).inspect();
            console.log(`Using local image: ${image}`);
            return;
        } catch {
            // Image not found, need to pull
        }
    }

    console.log(`Pulling image: ${image}...`);

    try {
        const stream = await docker.pull(image);

        await new Promise<void>((resolve, reject) => {
            docker.modem.followProgress(
                stream,
                (err: Error | null) => {
                    if (err) reject(err);
                    else resolve();
                },
                (event: { status?: string; progress?: string; id?: string }) => {
                    if (event.status) {
                        const id = event.id ? `[${event.id}] ` : '';
                        const progress = event.progress || '';
                        process.stdout.write(`\r${id}${event.status} ${progress}`.padEnd(80));
                    }
                }
            );
        });

        console.log(`\n✓ Image ready: ${image}`);
    } catch (error) {
        console.error(`\n✗ Failed to pull image: ${image}`);
        if (error instanceof Error) {
            console.error(`  Error: ${error.message}`);
        }
        throw new Error('Image pull failed. Check your network connection and image availability.');
    }
}

interface Credentials {
    ghToken?: string;
    claudeToken?: string;
}

function loadCredentials(): Credentials {
    const configDir = getConfigDir();
    const credsFile = join(configDir, 'credentials.json');

    if (existsSync(credsFile)) {
        try {
            return JSON.parse(readFileSync(credsFile, 'utf-8'));
        } catch {
            return {};
        }
    }
    return {};
}

function saveCredentials(creds: Credentials): void {
    const configDir = ensureConfigDir();
    const credsFile = join(configDir, 'credentials.json');
    writeFileSync(credsFile, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

function getGhTokenFromCli(): string | null {
    try {
        const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        return result.status === 0 ? result.stdout.trim() : null;
    } catch {
        return null;
    }
}

function isGhAuthenticated(): boolean {
    try {
        const result = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        return result.status === 0;
    } catch {
        return false;
    }
}

async function promptGhLogin(): Promise<string | null> {
    console.log('\nGitHub authentication required.');
    console.log('Running: gh auth login\n');

    return new Promise((resolve) => {
        const proc = spawn('gh', ['auth', 'login'], { stdio: 'inherit' });
        proc.on('close', (code) => {
            if (code === 0) {
                resolve(getGhTokenFromCli());
            } else {
                resolve(null);
            }
        });
    });
}

async function promptForClaudeKey(): Promise<string | null> {
    console.log('\nClaude authentication required.');
    console.log('For Claude Code subscriptions: Run "claude setup-token" and paste the token');
    console.log('For API access: Get a key from https://console.anthropic.com/settings/keys\n');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question('Enter your Claude token or API key: ', (answer) => {
            rl.close();
            const key = answer.trim();
            if (key && key.startsWith('sk-ant-')) {
                // API key format
                resolve(key);
            } else if (key && key.length > 0) {
                // OAuth token or other format - accept it
                resolve(key);
            } else {
                resolve(null);
            }
        });
    });
}

async function setupAuth(): Promise<Credentials> {
    const creds = loadCredentials();
    let updated = false;

    // GitHub
    console.log('Checking GitHub authentication...');
    if (creds.ghToken) {
        console.log('✓ GitHub token found in config');
    } else {
        const token = getGhTokenFromCli();
        if (token) {
            console.log('✓ GitHub token retrieved from gh CLI');
            creds.ghToken = token;
            updated = true;
        } else if (isGhAuthenticated()) {
            // gh is authenticated but we couldn't get token (shouldn't happen)
            console.log('⚠ GitHub authenticated but could not retrieve token');
        } else {
            const newToken = await promptGhLogin();
            if (newToken) {
                console.log('✓ GitHub authentication successful');
                creds.ghToken = newToken;
                updated = true;
            } else {
                console.log('✗ GitHub authentication failed');
            }
        }
    }

    // Claude
    console.log('\nChecking Claude authentication...');
    if (creds.claudeToken) {
        console.log('✓ Claude API key found in config');
    } else {
        const apiKey = await promptForClaudeKey();
        if (apiKey) {
            creds.claudeToken = apiKey;
            updated = true;
            console.log('✓ API key saved');
        } else {
            console.log('✗ Claude authentication failed');
        }
    }

    if (updated) {
        saveCredentials(creds);
        console.log(`\nCredentials saved to ${join(getConfigDir(), 'credentials.json')}`);
    }

    return creds;
}

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
    return `devswarm-${info.owner}-${info.repo}`;
}

function volumeName(info: RepoInfo): string {
    return `devswarm-${info.owner}-${info.repo}-data`;
}

async function findAvailablePort(): Promise<number> {
    return getPort({ port: Array.from({ length: 50 }, (_, i) => PORT_RANGE_START + i) });
}

async function getContainerPort(container: Docker.Container): Promise<number> {
    const info = await container.inspect();
    const portLabel = info.Config.Labels?.['devswarm.port'];
    if (!portLabel) {
        throw new Error('Container missing devswarm.port label');
    }
    return parseInt(portLabel, 10);
}

async function startContainer(info: RepoInfo, tag: string = DEFAULT_TAG, forcePull: boolean = false): Promise<{ port: number; containerId: string; isNew: boolean }> {
    const name = containerName(info);
    const volume = volumeName(info);

    const containers = await docker.listContainers({ all: true, filters: { name: [name] } });

    if (containers.length > 0) {
        const existing = containers[0];

        if (existing.State === 'running') {
            const port = parseInt(existing.Labels['devswarm.port'], 10);
            console.log(`Container already running on port ${port}`);
            return { port, containerId: existing.Id, isNew: false };
        }

        const container = docker.getContainer(existing.Id);
        await container.start();
        const port = parseInt(existing.Labels['devswarm.port'], 10);
        console.log(`Resumed container on port ${port}`);
        return { port, containerId: existing.Id, isNew: false };
    }

    // Ensure image is available
    await ensureImage(tag, forcePull);

    // Load credentials
    const creds = loadCredentials();
    if (!creds.ghToken || !creds.claudeToken) {
        console.log('Missing credentials. Running setup...\n');
        const newCreds = await setupAuth();
        if (!newCreds.ghToken) {
            throw new Error('GitHub authentication required. Run: devswarm auth');
        }
        if (!newCreds.claudeToken) {
            throw new Error('Claude authentication required. Run: devswarm auth');
        }
        Object.assign(creds, newCreds);
    }

    const port = await findAvailablePort();

    try {
        await docker.createVolume({ Name: volume });
    } catch {
        // Volume may already exist
    }

    // Build bind mounts
    const binds = [`${volume}:/data`];

    // Build environment variables
    const env = [
        `PORT=${port}`,
        `REPO_URL=${info.url}`,
        `REPO_OWNER=${info.owner}`,
        `REPO_NAME=${info.repo}`,
        `GH_TOKEN=${creds.ghToken}`,
    ];

    // Claude authentication token - set both env vars for SDK compatibility
    // SDK will auto-detect whether it's an API key or OAuth token
    env.push(`ANTHROPIC_API_KEY=${creds.claudeToken}`);
    env.push(`CLAUDE_CODE_OAUTH_TOKEN=${creds.claudeToken}`);

    console.log('Starting container with stored credentials...');

    const container = await docker.createContainer({
        Image: getImageName(tag),
        name,
        Env: env,
        Labels: {
            'devswarm.port': String(port),
            'devswarm.repo': `${info.owner}/${info.repo}`,
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

    return { port, containerId: container.id, isNew: true };
}

async function followLogs(containerId: string, onReady: () => void): Promise<void> {
    const container = docker.getContainer(containerId);
    const stream = await container.logs({ follow: true, stdout: true, stderr: true, tail: 50 });

    let ready = false;

    // Create writable streams that can detect the ready signal
    const stdoutProxy = new (await import('stream')).Writable({
        write(chunk: Buffer, encoding: string, callback: () => void) {
            process.stdout.write(chunk);

            // Check for ready signal in stdout
            if (!ready) {
                const line = chunk.toString();
                if (line.includes('Server listening on port')) {
                    ready = true;
                    onReady();
                }
            }
            callback();
        }
    });

    const stderrProxy = new (await import('stream')).Writable({
        write(chunk: Buffer, encoding: string, callback: () => void) {
            process.stderr.write(chunk);
            callback();
        }
    });

    // Demultiplex the Docker log stream into stdout and stderr
    docker.modem.demuxStream(stream, stdoutProxy, stderrProxy);
}

async function listContainers(): Promise<void> {
    const containers = await docker.listContainers({
        all: true,
        filters: { label: ['devswarm.repo'] },
    });

    if (containers.length === 0) {
        console.log('No devswarm containers found');
        return;
    }

    console.log('\nDevSwarm containers:\n');
    for (const c of containers) {
        const repo = c.Labels['devswarm.repo'];
        const port = c.Labels['devswarm.port'];
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

    // Demultiplex the Docker log stream into stdout and stderr
    docker.modem.demuxStream(stream, process.stdout, process.stderr);

    process.on('SIGINT', () => {
        process.exit(0);
    });
}

/**
 * Stream container logs and return cleanup function
 */
async function streamContainerLogs(
    containerId: string,
    onReady?: () => void
): Promise<{ cleanup: () => void }> {
    const container = docker.getContainer(containerId);
    const stream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: 50
    });

    let readyTriggered = false;

    // Create writable streams that can detect the ready signal
    const stdoutProxy = new (await import('stream')).Writable({
        write(chunk: Buffer, encoding: string, callback: () => void) {
            process.stdout.write(chunk);

            // Check for ready signal in stdout
            if (!readyTriggered && onReady) {
                const line = chunk.toString();
                if (line.includes('Server listening on port')) {
                    readyTriggered = true;
                    onReady();
                }
            }
            callback();
        }
    });

    const stderrProxy = new (await import('stream')).Writable({
        write(chunk: Buffer, encoding: string, callback: () => void) {
            process.stderr.write(chunk);
            callback();
        }
    });

    // Demultiplex the Docker log stream into stdout and stderr
    docker.modem.demuxStream(stream, stdoutProxy, stderrProxy);

    const cleanup = () => {
        // The stream is a Node.js readable stream that supports destroy
        (stream as any).destroy();
        stdoutProxy.end();
        stderrProxy.end();
    };

    return { cleanup };
}

async function startOrAttach(repoArg: string, options: { tag?: string; pull?: boolean; skipPull?: boolean; attach?: boolean } = {}): Promise<void> {
    const info = parseRepo(repoArg);
    console.log(`Starting devswarm for ${info.owner}/${info.repo}...`);

    const tag = options.tag || DEFAULT_TAG;
    // Default to pulling unless --skip-pull is provided
    const forcePull = !options.skipPull;

    const { port, containerId, isNew } = await startContainer(info, tag, forcePull);

    if (options.attach) {
        console.log('Attaching to container logs...');

        // Set up resolvable promise for blocking
        let detachResolve: (() => void) | null = null;
        const blockUntilDetach = new Promise<void>((resolve) => {
            detachResolve = resolve;
        });

        // Stream logs with proper cleanup
        const { cleanup } = await streamContainerLogs(
            containerId,
            isNew ? () => {
                // For new containers, open browser when ready
                console.log(`\nOpening http://localhost:${port}`);
                open(`http://localhost:${port}`);
            } : undefined
        );

        // For existing containers, open browser immediately
        if (!isNew) {
            console.log(`\nOpening http://localhost:${port}`);
            open(`http://localhost:${port}`);
        }

        // Handle Ctrl+C gracefully
        const sigintHandler = async () => {
            console.log('\nDetaching from logs (container will continue running)');
            console.log(`To stop the container: devswarm stop ${info.owner}/${info.repo}`);

            // Clean up stream
            cleanup();

            // Resolve the blocking promise
            if (detachResolve) {
                detachResolve();
            }

            // Remove this handler to prevent accumulation
            process.off('SIGINT', sigintHandler);
        };

        process.on('SIGINT', sigintHandler);

        // Block until SIGINT
        await blockUntilDetach;
    } else {
        // Detached mode: print info and return
        console.log(`\n✓ Container started successfully`);
        console.log(`  Dashboard: http://localhost:${port}`);
        console.log(`  Container ID: ${containerId.substring(0, 12)}`);
        console.log(`\nTo view logs: devswarm logs ${info.owner}/${info.repo}`);
        console.log(`To stop: devswarm stop ${info.owner}/${info.repo}`);

        // Open browser (non-blocking, errors are ignored)
        try {
            await open(`http://localhost:${port}`);
        } catch (error) {
            // Silently ignore browser opening errors - not critical to operation
        }
    }
}

async function showAuthStatus(): Promise<void> {
    const creds = loadCredentials();
    const configDir = getConfigDir();

    console.log(`\nConfig directory: ${configDir}\n`);

    if (creds.ghToken) {
        console.log(`GitHub:  ✓ Token stored (${creds.ghToken.substring(0, 10)}...)`);
    } else {
        console.log('GitHub:  ✗ Not authenticated');
    }

    if (creds.claudeToken) {
        console.log(`Claude:  ✓ API key stored (${creds.claudeToken.substring(0, 12)}...)`);
    } else {
        console.log('Claude:  ✗ Not authenticated');
    }

    console.log('\nRun `devswarm auth` to set up or update credentials.');
}

async function clearAuth(): Promise<void> {
    const configDir = getConfigDir();
    const credsFile = join(configDir, 'credentials.json');

    if (existsSync(credsFile)) {
        writeFileSync(credsFile, '{}', { mode: 0o600 });
        console.log('Credentials cleared.');
    } else {
        console.log('No credentials to clear.');
    }
}

// Custom version display
const originalVersion = program.version.bind(program);
program.version(VERSION, '-v, --version', 'Display version information');

// Override the version action to show additional info
program.commands.forEach((cmd) => {
    if (cmd.name() === 'version') {
        cmd.action(() => {
            console.log(`devswarm CLI version: ${VERSION}`);
            console.log(`Default image: ${getImageName()}`);
            console.log(`Image repository: ${IMAGE_REPO}`);
            console.log(`Default tag: ${DEFAULT_TAG}`);
        });
    }
});

// Parse version flag before commander processes it
if (process.argv.includes('--version') || process.argv.includes('-v')) {
    const versionIndex = process.argv.findIndex(arg => arg === '--version' || arg === '-v');
    if (versionIndex === 2 || (versionIndex > 2 && !process.argv[2].startsWith('-'))) {
        console.log(`devswarm CLI version: ${VERSION}`);
        console.log(`Default image: ${getImageName()}`);
        console.log(`Image repository: ${IMAGE_REPO}`);
        console.log(`Default tag: ${DEFAULT_TAG}`);
        process.exit(0);
    }
}

program
    .command('start <repo>', { isDefault: true })
    .description('Start or attach to an orchestrator for a repository (pulls latest image by default)')
    .option('--tag <tag>', `Docker image tag to use (default: ${DEFAULT_TAG})`)
    .option('--pull', 'Force pull latest image before starting (default behavior, kept for backwards compatibility)')
    .option('--skip-pull', 'Skip pulling and use cached image (opt-out of default pull behavior)')
    .option('--attach', 'Follow logs and open browser (stays in foreground)')
    .action(startOrAttach);

program
    .command('auth')
    .description('Set up GitHub and Claude authentication')
    .option('--status', 'Show current authentication status')
    .option('--clear', 'Clear stored credentials')
    .action(async (options) => {
        if (options.status) {
            await showAuthStatus();
        } else if (options.clear) {
            await clearAuth();
        } else {
            await setupAuth();
        }
    });

program
    .command('list')
    .description('List all devswarm containers')
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

program.parse();
