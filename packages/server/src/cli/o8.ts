#!/usr/bin/env node
/**
 * o8 - Orchestr8 CLI for Claude instances
 *
 * This CLI allows Claude to interact with the orchestrator database
 * via the local HTTP API.
 */

import { program } from 'commander';

const API_BASE = `http://localhost:${process.env.PORT || 3814}`;

async function api<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error ${res.status}: ${text}`);
    }

    return res.json();
}

program
    .name('o8')
    .description('Orchestr8 CLI for Claude instances')
    .version('0.1.0');

// Roadmap commands
const roadmap = program.command('roadmap').description('Manage roadmap items');

roadmap
    .command('list')
    .description('List all roadmap items')
    .action(async () => {
        const items = await api<Array<{
            id: string;
            title: string;
            status: string;
            description: string;
            has_unresolved_dependencies?: boolean;
            dependency_count?: number;
            blocks_count?: number;
        }>>('/api/roadmap');
        if (items.length === 0) {
            console.log('No roadmap items found.');
            return;
        }
        for (const item of items) {
            // Determine dependency status indicator
            let depIndicator = '';
            if (item.has_unresolved_dependencies) {
                depIndicator = ' [BLOCKED]';
            } else if (item.blocks_count && item.blocks_count > 0) {
                depIndicator = ' [BLOCKER]';
            } else if (!item.has_unresolved_dependencies && (!item.blocks_count || item.blocks_count === 0)) {
                depIndicator = ' [READY]';
            }

            console.log(`\n[${item.status.toUpperCase()}]${depIndicator} ${item.id}`);
            console.log(`  Title: ${item.title}`);
            if (item.description) {
                console.log(`  Description: ${item.description.substring(0, 100)}${item.description.length > 100 ? '...' : ''}`);
            }

            // Show dependency counts if any
            if (item.dependency_count && item.dependency_count > 0) {
                console.log(`  Dependencies: ${item.dependency_count} unresolved`);
            }
            if (item.blocks_count && item.blocks_count > 0) {
                console.log(`  Blocks: ${item.blocks_count} items`);
            }
        }
    });

roadmap
    .command('get <id>')
    .description('Get a specific roadmap item')
    .action(async (id: string) => {
        const items = await api<Array<{
            id: string;
            title: string;
            status: string;
            description: string;
            has_unresolved_dependencies?: boolean;
            dependency_count?: number;
            blocks_count?: number;
        }>>('/api/roadmap');
        const item = items.find(i => i.id === id);
        if (!item) {
            console.error(`Roadmap item ${id} not found`);
            process.exit(1);
        }

        console.log(JSON.stringify(item, null, 2));

        // Also show dependencies
        try {
            const response = await api<{
                dependencies: Array<{
                    id: string;
                    blocker_id: string;
                    blocker_title?: string;
                    blocker_status?: string;
                }>
            }>(`/api/roadmap/${id}/dependencies`);

            if (response.dependencies.length > 0) {
                console.log('\nDependencies:');
                for (const dep of response.dependencies) {
                    const status = dep.blocker_status || 'unknown';
                    const symbol = status === 'done' ? '✓' : '✗';
                    console.log(`  ${symbol} [${status}] ${dep.blocker_title || dep.blocker_id}`);
                }
            }
        } catch {
            // Ignore if dependencies endpoint doesn't exist yet
        }
    });

roadmap
    .command('create')
    .description('Create a new roadmap item')
    .requiredOption('-t, --title <title>', 'Item title')
    .requiredOption('-d, --description <description>', 'Item description')
    .action(async (options) => {
        const item = await api('/api/roadmap', {
            method: 'POST',
            body: JSON.stringify({
                title: options.title,
                description: options.description,
            }),
        });
        console.log('Created roadmap item:');
        console.log(JSON.stringify(item, null, 2));
    });

roadmap
    .command('update <id>')
    .description('Update a roadmap item')
    .option('-t, --title <title>', 'New title')
    .option('-d, --description <description>', 'New description')
    .option('-s, --status <status>', 'New status (pending, in_progress, done)')
    .action(async (id: string, options) => {
        const updates: Record<string, string> = {};
        if (options.title) updates.title = options.title;
        if (options.description) updates.description = options.description;
        if (options.status) updates.status = options.status;

        const item = await api(`/api/roadmap/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(updates),
        });
        console.log('Updated roadmap item:');
        console.log(JSON.stringify(item, null, 2));
    });

roadmap
    .command('deps <id>')
    .description('List dependencies for a roadmap item')
    .action(async (id: string) => {
        try {
            const response = await api<{
                dependencies: Array<{
                    id: string;
                    blocker_id: string;
                    blocker_title?: string;
                    blocker_status?: string;
                    blocker_spec_id?: string | null;
                    resolved: boolean;
                    created_at: number;
                }>
            }>(`/api/roadmap/${id}/dependencies`);

            // Get roadmap item details
            const items = await api<Array<{ id: string; title: string; status: string }>>('/api/roadmap');
            const item = items.find(i => i.id === id);
            if (!item) {
                console.error(`Roadmap item ${id} not found`);
                process.exit(1);
            }

            console.log(`\nRoadmap Item: ${item.title} (${item.id})`);
            console.log(`Status: ${item.status}\n`);

            if (response.dependencies.length === 0) {
                console.log('No dependencies (ready to approve)');
                return;
            }

            console.log(`Dependencies (${response.dependencies.length}):`);
            for (const dep of response.dependencies) {
                const status = dep.blocker_status || 'unknown';
                const isDone = status === 'done';
                const symbol = isDone ? '✓' : '✗';
                console.log(`${symbol} [${status}] ${dep.blocker_id}`);
                if (dep.blocker_title) {
                    console.log(`   ${dep.blocker_title}`);
                }
            }

            const hasUnresolved = response.dependencies.some(d => (d.blocker_status || 'unknown') !== 'done');
            if (hasUnresolved) {
                console.log('\n⚠ Cannot approve spec until all dependencies are resolved.');
            }
        } catch (error: any) {
            console.error(`Error fetching dependencies: ${error.message}`);
            process.exit(1);
        }
    });

roadmap
    .command('add-dep')
    .description('Add a dependency between roadmap items')
    .requiredOption('--blocker <id>', 'Blocker roadmap item ID')
    .requiredOption('--blocked <id>', 'Blocked roadmap item ID')
    .action(async (options) => {
        try {
            await api(`/api/roadmap/${options.blocked}/dependencies`, {
                method: 'POST',
                body: JSON.stringify({ blocker_id: options.blocker }),
            });
            console.log(`✓ Dependency created: ${options.blocker} blocks ${options.blocked}`);
        } catch (error: any) {
            console.error(`Error creating dependency: ${error.message}`);
            process.exit(1);
        }
    });

roadmap
    .command('remove-dep')
    .description('Remove a dependency between roadmap items')
    .requiredOption('--blocker <id>', 'Blocker roadmap item ID')
    .requiredOption('--blocked <id>', 'Blocked roadmap item ID')
    .action(async (options) => {
        try {
            // Get dependencies to find the ID
            const response = await api<{
                dependencies: Array<{
                    id: string;
                    blocker_id: string;
                }>
            }>(`/api/roadmap/${options.blocked}/dependencies`);

            const dep = response.dependencies.find(d => d.blocker_id === options.blocker);
            if (!dep) {
                console.error('Dependency not found');
                process.exit(1);
            }

            await api(`/api/roadmap/${options.blocked}/dependencies/${dep.id}`, {
                method: 'DELETE',
            });
            console.log('✓ Dependency removed');
        } catch (error: any) {
            console.error(`Error removing dependency: ${error.message}`);
            process.exit(1);
        }
    });

// Spec commands
const spec = program.command('spec').description('Manage specifications');

spec
    .command('list')
    .description('List all specs')
    .action(async () => {
        const specs = await api<Array<{ id: string; roadmap_item_id: string; status: string; content: string | null }>>('/api/specs');
        if (specs.length === 0) {
            console.log('No specs found.');
            return;
        }
        for (const s of specs) {
            console.log(`\n[${s.status.toUpperCase()}] ${s.id}`);
            console.log(`  Roadmap Item: ${s.roadmap_item_id}`);
            if (s.content) {
                console.log(`  Content preview: ${s.content.substring(0, 100)}...`);
            }
        }
    });

spec
    .command('get <id>')
    .description('Get a specific spec with full details')
    .action(async (id: string) => {
        const spec = await api(`/api/specs/${id}`);
        console.log(JSON.stringify(spec, null, 2));
    });

spec
    .command('create')
    .description('Create a new spec')
    .requiredOption('-r, --roadmap-id <id>', 'Roadmap item ID')
    .requiredOption('-c, --content <content>', 'Spec content (can be a file path starting with @)')
    .action(async (options) => {
        let content = options.content;
        if (content.startsWith('@')) {
            const fs = await import('fs/promises');
            content = await fs.readFile(content.slice(1), 'utf-8');
        }

        const spec = await api('/api/specs', {
            method: 'POST',
            body: JSON.stringify({
                roadmap_item_id: options.roadmapId,
                content,
            }),
        });
        console.log('Created spec:');
        console.log(JSON.stringify(spec, null, 2));
    });

spec
    .command('update <id>')
    .description('Update a spec')
    .option('-c, --content <content>', 'New content')
    .option('-s, --status <status>', 'New status (draft, pending_review, approved, in_progress, done)')
    .action(async (id: string, options) => {
        const updates: Record<string, string> = {};
        if (options.content) {
            let content = options.content;
            if (content.startsWith('@')) {
                const fs = await import('fs/promises');
                content = await fs.readFile(content.slice(1), 'utf-8');
            }
            updates.content = content;
        }
        if (options.status) updates.status = options.status;

        const spec = await api(`/api/specs/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(updates),
        });
        console.log('Updated spec:');
        console.log(JSON.stringify(spec, null, 2));
    });

spec
    .command('approve <id>')
    .description('Approve a spec for implementation')
    .action(async (id: string) => {
        try {
            const spec = await api(`/api/specs/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'approved' }),
            });
            console.log('Spec approved:');
            console.log(JSON.stringify(spec, null, 2));
        } catch (error: any) {
            // Parse error to check if it's a dependency validation error
            const errorMessage = error.message || String(error);
            if (errorMessage.includes('unresolved dependencies')) {
                try {
                    // Try to extract the error details from the response
                    const match = errorMessage.match(/API error 400: (.*)/);
                    if (match) {
                        const errorData = JSON.parse(match[1]);
                        console.error('\n❌ Cannot approve spec - unresolved dependencies:\n');
                        if (errorData.blockers && Array.isArray(errorData.blockers)) {
                            for (const blocker of errorData.blockers) {
                                console.error(`  - [${blocker.status || 'unknown'}] ${blocker.id}`);
                                if (blocker.title) {
                                    console.error(`    ${blocker.title}`);
                                }
                            }
                        }
                        console.error('\n📋 Please complete the blocking roadmap items before approving this spec.\n');
                    } else {
                        console.error(errorMessage);
                    }
                } catch {
                    console.error(errorMessage);
                }
                process.exit(1);
            } else {
                throw error;
            }
        }
    });

// Task group commands
const taskGroup = program.command('task-group').description('Manage task groups');

taskGroup
    .command('create')
    .description('Create a task group for a spec')
    .requiredOption('-s, --spec-id <id>', 'Spec ID')
    .requiredOption('-n, --name <name>', 'Task group name')
    .option('-d, --description <description>', 'Task group description')
    .option('-o, --order <order>', 'Sequence order', '0')
    .action(async (options) => {
        const group = await api('/api/task-groups', {
            method: 'POST',
            body: JSON.stringify({
                spec_id: options.specId,
                name: options.name,
                description: options.description || '',
                sequence_order: parseInt(options.order, 10),
            }),
        });
        console.log('Created task group:');
        console.log(JSON.stringify(group, null, 2));
    });

taskGroup
    .command('complete <id>')
    .description('Mark a task group as complete')
    .action(async (id: string) => {
        const group = await api(`/api/task-groups/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'done' }),
        });
        console.log('Task group completed:');
        console.log(JSON.stringify(group, null, 2));
    });

// Task commands
const task = program.command('task').description('Manage individual tasks');

task
    .command('create')
    .description('Create a task in a task group')
    .requiredOption('-g, --group-id <id>', 'Task group ID')
    .requiredOption('-d, --description <description>', 'Task description')
    .option('-o, --order <order>', 'Sequence order', '0')
    .action(async (options) => {
        const t = await api('/api/tasks', {
            method: 'POST',
            body: JSON.stringify({
                task_group_id: options.groupId,
                description: options.description,
                sequence_order: parseInt(options.order, 10),
            }),
        });
        console.log('Created task:');
        console.log(JSON.stringify(t, null, 2));
    });

task
    .command('complete <id>')
    .description('Mark a task as complete')
    .action(async (id: string) => {
        const t = await api(`/api/tasks/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'done' }),
        });
        console.log('Task completed:');
        console.log(JSON.stringify(t, null, 2));
    });

// Status command
program
    .command('status')
    .description('Show overall orchestrator status')
    .action(async () => {
        const [roadmapItems, specs, claudes] = await Promise.all([
            api<Array<{
                id: string;
                status: string;
                has_unresolved_dependencies?: boolean;
                dependency_count?: number;
                blocks_count?: number;
            }>>('/api/roadmap'),
            api<Array<{ status: string }>>('/api/specs'),
            api<Array<{ id: string; role: string; status: string }>>('/api/claudes'),
        ]);

        console.log('\n=== Orchestr8 Status ===\n');

        console.log('Roadmap Items:');
        const roadmapByStatus = roadmapItems.reduce((acc, item) => {
            acc[item.status] = (acc[item.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        for (const [status, count] of Object.entries(roadmapByStatus)) {
            console.log(`  ${status}: ${count}`);
        }

        // Count blocked items
        const blockedCount = roadmapItems.filter(item => item.has_unresolved_dependencies).length;
        if (blockedCount > 0) {
            console.log(`  🔒 blocked by dependencies: ${blockedCount}`);
        }

        console.log('\nSpecs:');
        const specsByStatus = specs.reduce((acc, s) => {
            acc[s.status] = (acc[s.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        for (const [status, count] of Object.entries(specsByStatus)) {
            console.log(`  ${status}: ${count}`);
        }

        console.log('\nClaude Instances:');
        for (const c of claudes) {
            console.log(`  ${c.role} (${c.id.slice(0, 8)}): ${c.status}`);
        }
    });

program.parse();
