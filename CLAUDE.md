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
- `roadmap_migrator`: Automated ROADMAP.md file migration agent
- `dependency_checker`: Analyzes draft specs to identify and create dependencies between roadmap items

### Claude Instance Timeouts

- **Main Claude**: No timeout (runs indefinitely)
- **Spec Creator**: No timeout (runs indefinitely)
- **Coordinator**: 1 hour timeout (3600000ms)
- **Worker**: 1 hour timeout (3600000ms)
- **Roadmap Migrator**: 1 hour timeout (3600000ms)
- **Dependency Checker**: 1 hour timeout (3600000ms)

Long-running tasks should be broken into smaller chunks to complete within the 1-hour coordinator/worker/migrator limit.

### Claude Model Selection

By default, DevSwarm uses Claude's default model. You can specify a different model using the `--model` argument:

```bash
devswarm start owner/repo --model haiku   # Faster, lower cost
devswarm start owner/repo --model sonnet  # Balanced (default)
devswarm start owner/repo --model opus    # Maximum capability
```

The model applies to all Claude instances (main, spec creators, coordinators, and workers) in the session.

## Tech Stack

- **Backend**: Node.js 22, TypeScript 5.7, Fastify 5, SQLite (better-sqlite3)
- **Frontend**: React 19, Zustand 5, Vite 6, Tailwind 3.4, xterm.js 5
- **System**: Docker, tmux, git worktrees, GitHub CLI

## Migrating ROADMAP.md Files

DevSwarm can automatically migrate existing ROADMAP.md files into individual roadmap items with draft specifications.

### Usage

From inside the container or via the main Claude agent:

```bash
o8 migrate                    # Migrate ROADMAP.md from repository root
o8 migrate -f custom-path.md  # Migrate a custom file
```

From the web dashboard, you can also trigger migration via the HTTP API:

```bash
curl -X POST http://localhost:3814/api/roadmap/migrate \
  -H "Content-Type: application/json" \
  -d '{"roadmapFile": "ROADMAP.md"}'
```

### Supported ROADMAP.md Formats

The migrator agent supports multiple formats:

**Markdown List Format:**
```markdown
# Roadmap

## Planned Features

- **Feature Name**: Description of the feature
- **Another Feature**: Another description
```

**Numbered List Format:**
```markdown
# Roadmap

1. **Feature Name**: Description
2. **Another Feature**: Description
```

**Heading-Based Format:**
```markdown
# Roadmap

## Feature Name

Description of the feature across multiple paragraphs.

Acceptance criteria:
- Criterion 1
- Criterion 2
```

### Migration Process

1. The `roadmap_migrator` agent reads the ROADMAP.md file
2. Parses entries into individual roadmap items
3. Creates a roadmap item for each entry via `o8 roadmap create`
4. Generates a comprehensive draft spec for each item via `o8 spec create`
5. Specs are left in 'draft' status for manual review before implementation
6. The agent completes with a summary of items created

The migrator has a 1-hour timeout and runs in the main worktree (read-only operation).

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
o8 check-dependencies               # Analyze draft specs and create dependencies
o8 roadmap add-dep --blocker <id> --blocked <id>  # Manually add dependency
o8 roadmap deps <id>                # List dependencies for a roadmap item
```

## Status Workflows

**Roadmap Items**: `pending` → `in_progress` → `done`

**Specs**: `draft` → `approved` → `in_progress` → `merging` → `done` (or `error`)

**Task Groups/Tasks**: `pending` → `in_progress` → `done`

## Dependency Management

DevSwarm includes automated dependency detection between roadmap items:

### Dependency Checker Agent

The `dependency_checker` agent analyzes draft specs to identify logical dependencies and automatically creates dependency relationships:

**Features**:
- Detects explicit references ("Requires roadmap item X", "Depends on #123")
- Identifies implicit dependencies ("Modify the X feature to add...")
- Recognizes common dependency keywords ("requires", "depends", "blocked", "prerequisite")
- Avoids false positives (external libraries, completed work, example code)
- Prevents circular dependencies
- Works autonomously without user confirmation

**Usage**:
```bash
o8 check-dependencies  # Start dependency analysis of all draft specs
```

The agent will:
1. List all draft specs
2. Read each spec's content and associated roadmap item
3. Analyze for dependency patterns
4. Create roadmap_item dependencies (not spec dependencies)
5. Report completion with summary

**How it works**:
- Spawned by main Claude or via API endpoint
- Runs in main worktree (read-only)
- 1-hour timeout
- Emits [TASK_COMPLETE] when finished
- Creates dependencies using existing database infrastructure

### Manual Dependency Management

```bash
o8 roadmap add-dep --blocker <id> --blocked <id>  # Create dependency
o8 roadmap deps <id>                              # List dependencies
```

**Dependency Direction**:
- **Blocker**: The item that must complete FIRST
- **Blocked**: The item that must wait

### Batch Roadmap Processing

**MANDATORY WORKFLOW**: Main Claude ALWAYS checks for additional items and draft specs before approving any spec.

**Decision Tree After Creating a Spec**:

1. **Check for additional ready items**: Run `o8 roadmap list`
   - If other `[READY]` items without specs exist → Create all specs as drafts, wait ~30s, run dependency checker
   - If no other ready items → Continue to step 2

2. **Check for existing draft specs**: Run `o8 spec list`
   - If OTHER draft specs exist → Run dependency checker
   - If this is the only draft spec → Approve immediately

3. **Run Dependency Checker** (when multiple draft specs exist):
   ```bash
   o8 check-dependencies
   ```
   - Analyzes ALL draft specs for dependency relationships
   - Creates roadmap item dependencies automatically

4. **Strategic Approval** (after dependency analysis):
   - Review: `o8 roadmap list` to identify blockers vs. blocked items
   - Approve in priority order:
     - **First**: Blocker items (items other items depend on)
     - **Next**: Independent items with satisfied dependencies
     - **Last**: Blocked items remain in draft until blockers complete

5. **Progressive Approval**: As blocker specs complete, approve newly-unblocked specs

**Orchestrator Hints**:
- When >3 pending items or >2 draft specs detected: "CRITICAL: Batch processing required!"
- This enforces the mandatory batch processing workflow

**Key Principles**:
- **Never skip dependency checking**: When multiple draft specs exist, dependency analysis is REQUIRED
- **Always check before approving**: The decision tree is mandatory, not optional
- **Trust the dependency checker**: Automated analysis is more reliable than manual guessing
- **Prioritize blockers**: Unblock downstream work by approving blockers first

**Benefits**:
- Prevents out-of-order implementation that could cause blocking issues
- Optimizes parallelization by identifying and prioritizing blocker items
- Ensures all dependencies are analyzed before work begins
- Reduces rework from discovering dependencies mid-implementation

**Troubleshooting Common Issues**:

| Issue | Symptom | Solution |
|-------|---------|----------|
| **Specs approved too early** | Items start implementation before dependencies are analyzed | Main Claude must follow the decision tree - check for other ready items and draft specs before approving |
| **Dependency checker not running** | Multiple draft specs exist but no dependency analysis performed | Main Claude should run `o8 check-dependencies` whenever multiple draft specs exist |
| **Circular dependencies** | Dependency checker reports circular dependency | Do not approve items involved in the circular chain - manually review and break the cycle |
| **Dependency checker fails** | Error during dependency analysis | Proceed with manual dependency review using `o8 roadmap deps <id>` before approving specs |
| **Items approved out of order** | Blocked items approved before their blockers | Always check `o8 roadmap list` after dependency analysis - approve blockers first |

## Key Patterns

- Event-driven Claude interaction via Node.js EventEmitter
- WebSocket for real-time dashboard updates
- Database columns and TypeScript interfaces both use snake_case (to match SQLite columns directly)
- Resume IDs generated with nanoid for Claude session persistence
- Git worktrees provide clean isolation per spec/task
- Spec IDs are semantic: `iss-{number}-{slug}` for GitHub issues, `live-{slug}-{random}` for dashboard-created items
- Dependency tracking uses existing database infrastructure (no migration needed)
