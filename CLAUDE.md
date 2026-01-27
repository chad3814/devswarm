# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevSwarm is an agentic coding orchestrator that uses Claude Code CLI, git worktrees, and tmux to parallelize software development tasks. It's a monorepo with three packages deployed in a Docker container, coordinated through a web dashboard.

## Build Commands

```bash
npm run build      # Build all packages (TypeScript → dist/)
npm run dev        # Watch mode for all packages
npm run lint       # ESLint across all packages
npm run clean      # Remove all dist/ directories
```

Individual package builds from root:
```bash
npm run build -w @devswarm/cli
npm run build -w @devswarm/server
npm run build -w @devswarm/web
```

## Architecture

### Three-Tier Distributed System

```
HOST (Local Machine)
└─ devswarm CLI (Docker orchestration)

CONTAINER (Docker)
├─ Fastify Server + React Frontend (port 3814-3850)
├─ Tmux Session (parallel Claude instances)
├─ Git Daemon (port 9418)
└─ SQLite Database

DATA VOLUME (/data)
├─ db/          # SQLite persistence
├─ bare.git/    # Bare repository clone
├─ worktrees/   # Git worktrees per Claude instance
├─ state/       # Resume IDs, session state
└─ config/      # Symlinked gh + claude configs
```

### Package Structure

- **packages/cli**: Host CLI tool using Commander.js and Dockerode for container management
- **packages/server**: Fastify backend with WebSocket, SQLite (better-sqlite3), tmux management, and git worktree operations
- **packages/web**: React 19 dashboard with Zustand state, xterm.js terminal emulation, Vite build, Tailwind CSS

### Core Server Modules

```
packages/server/src/
├── orchestrator/    # Main orchestration engine (5-second loop)
├── claude/          # Instance wrapper + role prompts
├── tmux/            # Session/pane management + output capture
├── git/             # Worktree operations
├── db/              # SQLite schema & queries
├── github/          # OAuth flow + issue sync
└── routes/          # HTTP + WebSocket endpoints
```

### Data Flow

1. **Initialization**: CLI starts container → Auth via GitHub Device Flow + Claude token → Clone bare repo → Start git daemon → Create main worktree
2. **Claude Lifecycle**: Each role gets a tmux pane → Output captured via polling → Events emitted (output, question, task_complete)
3. **Work Pipeline**: Roadmap items → Specs → Task groups → Workers execute in parallel → Merge back to main

### Authentication

DevSwarm requires two types of authentication:

1. **GitHub**: Uses device flow OAuth for repository access. Token stored in `/data/config/gh/hosts.yml`
2. **Claude**: Supports both authentication methods:
   - **Claude Code subscription**: Token from `claude setup-token` (recommended for subscriptions)
   - **Anthropic API key**: API key from https://console.anthropic.com/settings/keys

The CLI passes authentication to the container via the `CLAUDE_CODE_OAUTH_TOKEN` environment variable, which is automatically used by the Claude Code CLI inside the container.

### Claude Roles

- `main`: Roadmap curator, final reviewer
- `spec_creator`: Detailed specification writer
- `coordinator`: Spec implementation manager
- `worker`: Task executor (multiple can run in parallel)

### Claude Instance Timeouts

- **Main Claude**: No timeout (runs indefinitely)
- **Spec Creator**: No timeout (runs indefinitely)
- **Coordinator**: 1 hour timeout (3600000ms)
- **Worker**: 1 hour timeout (3600000ms)

Long-running tasks should be broken into smaller chunks to complete within the 1-hour coordinator/worker limit.

## Tech Stack

- **Backend**: Node.js 22, TypeScript 5.7, Fastify 5, SQLite (better-sqlite3)
- **Frontend**: React 19, Zustand 5, Vite 6, Tailwind 3.4, xterm.js 5
- **System**: Docker, tmux, git worktrees, GitHub CLI

## Testing

```bash
# Run unit tests (uses console.assert, not a test framework)
npx tsx packages/server/src/utils/slug.test.ts

# Run integration tests
npx tsx packages/server/src/utils/integration-test.ts
```

Tests are standalone TypeScript files that use `console.assert` for assertions.

## Internal CLI (`o8`)

The `o8` CLI (Orchestr8) runs inside the container and allows Claude instances to interact with the orchestrator via HTTP API:

```bash
o8 status                           # Show overall orchestrator status
o8 roadmap list                     # List all roadmap items
o8 spec create -r <id> -c @spec.md  # Create spec from file
o8 spec approve <id>                # Approve spec for implementation
o8 task-group complete <id>         # Mark task group as done
```

## Status Workflows

**Roadmap Items**: `pending` → `in_progress` → `done`

**Specs**: `draft` → `approved` → `in_progress` → `merging` → `done` (or `error`)

**Task Groups/Tasks**: `pending` → `in_progress` → `done`

## Key Patterns

- Event-driven Claude interaction via Node.js EventEmitter
- WebSocket for real-time dashboard updates
- Database columns and TypeScript interfaces both use snake_case (to match SQLite columns directly)
- Resume IDs generated with nanoid for Claude session persistence
- Git worktrees provide clean isolation per spec/task
- Spec IDs are semantic: `iss-{number}-{slug}` for GitHub issues, `live-{slug}-{random}` for dashboard-created items
