# @devswarm/cli

Command-line interface for DevSwarm, an agentic coding orchestrator that uses Claude Code CLI and git worktrees to parallelize software development tasks.

## Installation

```bash
npm install -g @devswarm/cli
```

## Quick Start

```bash
# Set up authentication (first time only)
devswarm auth

# Start working on a repository
devswarm owner/repo
# or
devswarm https://github.com/owner/repo

# Your browser will open to the dashboard automatically
```

## Authentication

DevSwarm requires two credentials:

1. **GitHub Token** - For cloning repositories and managing issues
2. **Claude API Key** - For running Claude Code instances

### Setting Up Authentication

```bash
# Interactive setup (prompts for both credentials)
devswarm auth

# Check authentication status
devswarm auth --status

# Clear stored credentials
devswarm auth --clear
```

#### GitHub Authentication

The CLI will automatically use your `gh` CLI authentication if available. If not authenticated, it will guide you through the `gh auth login` flow.

#### Claude API Key

Get an API key from [https://console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys).

Credentials are stored securely in `~/.config/devswarm/credentials.json` (or `$XDG_CONFIG_HOME/devswarm/credentials.json`) with file permissions set to 0600.

## Commands

### `devswarm <repo>`

Start or attach to a DevSwarm orchestrator for a repository. This is the default command.

```bash
# Start with shorthand notation
devswarm owner/repo

# Start with full GitHub URL
devswarm https://github.com/owner/repo

# Use a specific image tag
devswarm owner/repo --tag latest

# Force pull the latest image
devswarm owner/repo --pull
```

**Options:**
- `--tag <tag>` - Docker image tag to use (default: `dev`)
- `--pull` - Force pull the latest image before starting

The command will:
1. Pull the DevSwarm Docker image (if not cached)
2. Create a container and data volume
3. Start the orchestrator
4. Open the dashboard in your browser

### `devswarm start <repo>`

Explicit command to start or attach to an orchestrator (same as default command).

```bash
devswarm start owner/repo
```

### `devswarm list`

List all DevSwarm containers and their status.

```bash
devswarm list
```

Output shows:
- Repository name
- Container state (running/stopped)
- Port number

### `devswarm stop <repo>`

Gracefully stop an orchestrator, preserving all state for later resumption.

```bash
devswarm stop owner/repo
```

The command sends a shutdown signal to allow Claude instances to save their state before stopping.

### `devswarm rm <repo>`

Remove an orchestrator container.

```bash
# Remove container (keeps data volume)
devswarm rm owner/repo

# Remove container and delete all data
devswarm rm owner/repo --purge
```

**Options:**
- `--purge` - Also remove the data volume (deletes all data including database, git repos, and worktrees)

### `devswarm logs <repo>`

Tail logs from an orchestrator.

```bash
devswarm logs owner/repo
```

Press `Ctrl+C` to stop following logs.

### `devswarm auth`

Manage authentication credentials.

```bash
# Set up or update credentials
devswarm auth

# Show current authentication status
devswarm auth --status

# Clear stored credentials
devswarm auth --clear
```

## Configuration

### Config Directory

DevSwarm stores configuration in:
- `$XDG_CONFIG_HOME/devswarm/` (if `XDG_CONFIG_HOME` is set)
- `~/.config/devswarm/` (default)

### Files

- `credentials.json` - GitHub token and Claude API key (mode 0600)

### Docker Resources

For each repository, DevSwarm creates:
- **Container**: `devswarm-<owner>-<repo>`
- **Volume**: `devswarm-<owner>-<repo>-data`

### Ports

DevSwarm automatically allocates ports starting from 3814. Each orchestrator gets a unique port for its web dashboard.

## Docker Image

The CLI pulls images from `ghcr.io/chad3814/devswarm`. Available tags:
- `dev` - Latest development build from main branch (default)
- `latest` - Latest stable release

Use `--tag` option to specify a different tag:

```bash
devswarm owner/repo --tag latest
```

## Troubleshooting

### "Image pull failed"

If the image fails to pull:
1. Check your internet connection
2. Verify Docker is running: `docker ps`
3. Try pulling manually: `docker pull ghcr.io/chad3814/devswarm:dev`

### "Authentication required"

If you see authentication errors:
1. Run `devswarm auth` to set up credentials
2. Check status with `devswarm auth --status`
3. For GitHub, ensure `gh` CLI is working: `gh auth status`

### "Port already in use"

DevSwarm automatically finds available ports in the range 3814-3863. If all ports are in use, stop some containers:

```bash
devswarm list
devswarm stop owner/repo
```

### "Container already running"

If a container is already running for a repository, the CLI will attach to the existing instance instead of creating a new one.

## Examples

### Basic Workflow

```bash
# Set up auth (first time)
devswarm auth

# Start working on a project
devswarm myorg/myproject

# Check status
devswarm list

# View logs in another terminal
devswarm logs myorg/myproject

# Stop when done
devswarm stop myorg/myproject

# Resume later
devswarm myorg/myproject
```

### Multiple Repositories

```bash
# Start orchestrators for multiple repos
devswarm myorg/frontend
devswarm myorg/backend
devswarm myorg/docs

# List all running orchestrators
devswarm list

# Each gets its own port and dashboard
```

### Cleanup

```bash
# Remove container but keep data (can resume later)
devswarm rm owner/repo

# Complete cleanup including all data
devswarm rm owner/repo --purge
```

## Development

See the main [DevSwarm repository](https://github.com/chad3814/devswarm) for development instructions.

## License

MIT
