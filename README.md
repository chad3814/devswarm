# /dev/swarm

An agentic coding orchestrator that uses Claude Code CLI and git worktrees to parallelize software development tasks.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Host Machine                                                       │
│                                                                     │
│  ┌──────────┐         ┌──────────────────────────────────────────┐  │
│  │ devswarm │ docker  │  Container: devswarm-owner-repo          │  │
│  │ CLI      │────────▶│                                          │  │
│  └──────────┘         │  ┌─────────────────────────────────────┐ │  │
│       │               │  │ Claude Instances                    │ │  │
│       │ opens         │  │ ┌─────────┬─────────┬─────────┐     │ │  │
│       │ browser       │  │ │ main    │ spec-1  │ worker-1│ ... │ │  │
│       ▼               │  │ │ claude  │ claude  │ claude  │     │ │  │
│  ┌──────────┐         │  │ └─────────┴─────────┴─────────┘     │ │  │
│  │ Browser  │◀───ws───│  └─────────────────────────────────────┘ │  │
│  │ Dashboard│         │                                          │  │
│  └──────────┘         │  ┌──────────┐  ┌──────────────────────┐  │  │
│                       │  │ Fastify  │  │ /data (volume)       │  │  │
│                       │  │ Server   │──│ ├── db/              │  │  │
│                       │  │ + React  │  │ ├── bare.git/        │  │  │
│                       │  └──────────┘  │ ├── worktrees/       │  │  │
│                       │                │ ├── state/           │  │  │
│                       │  ┌──────────┐  │ └── config/          │  │  │
│                       │  │git daemon│  └──────────────────────┘  │  │
│                       │  │ :9418    │                            │  │
│                       │  └──────────┘                            │  │
│                       └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Features

- **One container per repository** - Clean isolation between projects
- **Git worktrees for parallel work** - Multiple Claude instances can work on different features simultaneously
- **Automatic GitHub issue sync** - Imports open issues as roadmap items
- **Spec-driven development** - Claude creates detailed specs before implementation
- **Parallel task execution** - Independent task groups are parallelized across multiple Claude instances
- **Web dashboard** - Real-time view of all Claude instances, roadmap status, and system state
- **Graceful shutdown/resume** - All Claude instances can be paused and resumed with their context intact
- **Local git server** - Clone the work-in-progress repo locally

## Prerequisites

- Docker
- Node.js 22+
- A GitHub account

## Installation

```bash
# Clone this repo
git clone https://github.com/your-username/devswarm.git
cd devswarm

# Install dependencies
npm install

# Build all packages
npm run build

# Build Docker image
docker build -t devswarm:latest .

# Install CLI globally
npm install -g ./packages/cli
```

## Usage

```bash
# Start devswarm for a repository
devswarm owner/repo
devswarm https://github.com/owner/repo

# List running orchestrators
devswarm list

# Graceful shutdown
devswarm stop owner/repo

# Remove container and data
devswarm rm owner/repo

# View logs
devswarm logs owner/repo
```

## How It Works

1. **Initialization**: When you run `devswarm owner/repo`, it:
   - Creates a Docker container with all dependencies
   - Clones the repository as a bare repo
   - Creates a main worktree
   - Starts the web server and main Claude instance

2. **Roadmap Creation**: The main Claude:
   - Syncs open GitHub issues as roadmap items
   - Helps you create additional roadmap items via the web UI
   - Creates detailed specs for each roadmap item

3. **Spec Implementation**: For each approved spec:
   - Creates a new git worktree
   - Spawns a coordinator Claude to manage implementation
   - Coordinator may spawn worker Claudes for parallel tasks
   - Each task group results in a commit
   - Workers merge back to spec branch when done

4. **Completion**: When a spec is fully implemented:
   - Main Claude reviews the changes
   - Either merges directly or creates a PR
   - Marks the roadmap item as complete

## Project Structure

```
devswarm/
├── packages/
│   ├── cli/          # Host CLI for managing containers
│   ├── server/       # Fastify server with WebSocket
│   └── web/          # React dashboard
├── Dockerfile
├── entrypoint.sh
└── package.json
```

## Configuration

### Environment Variables

- `PORT` - Server port (default: 3814)
- `REPO_URL` - Repository URL
- `REPO_OWNER` - Repository owner
- `REPO_NAME` - Repository name
- `GITHUB_CLIENT_ID` - GitHub OAuth App client ID (for device flow auth)

### Volume Structure

```
/data/
├── db/                 # SQLite database
├── bare.git/          # Bare clone of repository
├── worktrees/         # All git worktrees
├── state/             # Resume IDs, session state
└── config/            # gh and claude auth config
```

## Development

```bash
# Start in development mode (from repo root)
npm run dev

# Run only the server
cd packages/server && npm run dev

# Run only the web UI
cd packages/web && npm run dev
```

## License

MIT
