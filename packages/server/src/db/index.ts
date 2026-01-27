import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { generateSpecId } from '../utils/slug.js';

export interface RoadmapItem {
    id: string;
    github_issue_id: number | null;
    github_issue_url: string | null;
    github_issue_closed: number;
    title: string;
    description: string;
    status: string;
    spec_id: string | null;
    resolution_method: 'merge_and_push' | 'create_pr' | 'push_branch' | 'manual';
    created_at: number;
    updated_at: number;
}

export interface Spec {
    id: string;
    roadmap_item_id: string;
    content: string | null;
    status: string;
    worktree_name: string | null;
    branch_name: string | null;
    error_message: string | null;
    created_at: number;
    updated_at: number;
}

export interface TaskGroup {
    id: string;
    spec_id: string;
    name: string;
    description: string | null;
    status: string;
    worktree_name: string | null;
    branch_name: string | null;
    sequence_order: number;
    created_at: number;
    updated_at: number;
}

export interface Task {
    id: string;
    task_group_id: string;
    description: string;
    status: string;
    commit_sha: string | null;
    sequence_order: number;
    created_at: number;
    updated_at: number;
}

export interface ClaudeInstance {
    id: string;
    role: 'main' | 'spec_creator' | 'coordinator' | 'worker';
    tmux_pane: string | null;
    tmux_window: string | null;
    resume_id: string | null;
    status: string;
    context_type: string | null;
    context_id: string | null;
    worktree_name: string | null;
    created_at: number;
    updated_at: number;
}

export interface UserQuestion {
    id: string;
    claude_instance_id: string;
    question: string;
    response: string | null;
    status: string;
    created_at: number;
    answered_at: number | null;
}

export interface Dependency {
    id: string;
    blocker_type: string;
    blocker_id: string;
    blocked_type: string;
    blocked_id: string;
    resolved: number;
    created_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roadmap_items (
    id TEXT PRIMARY KEY,
    github_issue_id INTEGER,
    github_issue_url TEXT,
    github_issue_closed INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    spec_id TEXT REFERENCES specs(id),
    resolution_method TEXT NOT NULL DEFAULT 'merge_and_push',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS specs (
    id TEXT PRIMARY KEY,
    roadmap_item_id TEXT NOT NULL REFERENCES roadmap_items(id),
    content TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    worktree_name TEXT,
    branch_name TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS task_groups (
    id TEXT PRIMARY KEY,
    spec_id TEXT NOT NULL REFERENCES specs(id),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    worktree_name TEXT,
    branch_name TEXT,
    sequence_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    task_group_id TEXT NOT NULL REFERENCES task_groups(id),
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    commit_sha TEXT,
    sequence_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS dependencies (
    id TEXT PRIMARY KEY,
    blocker_type TEXT NOT NULL,
    blocker_id TEXT NOT NULL,
    blocked_type TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS claude_instances (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    tmux_pane TEXT,
    tmux_window TEXT,
    resume_id TEXT,
    status TEXT NOT NULL DEFAULT 'created',
    context_type TEXT,
    context_id TEXT,
    worktree_name TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS user_questions (
    id TEXT PRIMARY KEY,
    claude_instance_id TEXT NOT NULL REFERENCES claude_instances(id),
    question TEXT NOT NULL,
    response TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    answered_at INTEGER
);

CREATE TABLE IF NOT EXISTS auth_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_roadmap_status ON roadmap_items(status);
CREATE INDEX IF NOT EXISTS idx_specs_status ON specs(status);
CREATE INDEX IF NOT EXISTS idx_task_groups_spec ON task_groups(spec_id);
CREATE INDEX IF NOT EXISTS idx_task_groups_spec_status ON task_groups(spec_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_group ON tasks(task_group_id);
CREATE INDEX IF NOT EXISTS idx_deps_blocker ON dependencies(blocker_type, blocker_id);
CREATE INDEX IF NOT EXISTS idx_deps_blocked ON dependencies(blocked_type, blocked_id);
CREATE INDEX IF NOT EXISTS idx_claude_status ON claude_instances(status);
CREATE INDEX IF NOT EXISTS idx_questions_status ON user_questions(status);
`;

export class Db {
    private db: Database.Database;

    constructor(dbPath: string) {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(SCHEMA);
        this.migrateOverseerToCoordinator();
        this.migrateAddResolutionMethod();
    }

    private migrateOverseerToCoordinator(): void {
        const result = this.db.prepare("UPDATE claude_instances SET role = 'coordinator' WHERE role = 'overseer'").run();
        if (result.changes > 0) {
            console.log(`[DB Migration] Updated ${result.changes} overseer instances to coordinator`);
        }
    }

    private migrateAddResolutionMethod(): void {
        try {
            // Check if column already exists
            const columns = this.db.prepare("PRAGMA table_info(roadmap_items)").all() as Array<{ name: string }>;
            const hasColumn = columns.some(col => col.name === 'resolution_method');

            if (!hasColumn) {
                console.log('[DB Migration] Adding resolution_method column to roadmap_items');
                this.db.exec("ALTER TABLE roadmap_items ADD COLUMN resolution_method TEXT NOT NULL DEFAULT 'merge_and_push'");
                console.log('[DB Migration] Successfully added resolution_method column');
            }
        } catch (error) {
            console.error('[DB Migration] Failed to add resolution_method column:', error);
        }
    }

    close(): void {
        this.db.close();
    }

    // Roadmap Items
    createRoadmapItem(item: Omit<RoadmapItem, 'id' | 'created_at' | 'updated_at'>): RoadmapItem {
        const id = nanoid();
        const stmt = this.db.prepare(`
            INSERT INTO roadmap_items (id, github_issue_id, github_issue_url, github_issue_closed, title, description, status, spec_id, resolution_method)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, item.github_issue_id, item.github_issue_url, item.github_issue_closed, item.title, item.description, item.status, item.spec_id, item.resolution_method);
        return this.getRoadmapItem(id)!;
    }

    getRoadmapItem(id: string): RoadmapItem | undefined {
        return this.db.prepare('SELECT * FROM roadmap_items WHERE id = ?').get(id) as RoadmapItem | undefined;
    }

    getRoadmapItemByGitHubIssue(issueId: number): RoadmapItem | undefined {
        return this.db.prepare('SELECT * FROM roadmap_items WHERE github_issue_id = ?').get(issueId) as RoadmapItem | undefined;
    }

    getRoadmapItems(filter?: { status?: string }): RoadmapItem[] {
        if (filter?.status) {
            return this.db.prepare('SELECT * FROM roadmap_items WHERE status = ? ORDER BY created_at').all(filter.status) as RoadmapItem[];
        }
        return this.db.prepare('SELECT * FROM roadmap_items ORDER BY created_at').all() as RoadmapItem[];
    }

    updateRoadmapItem(id: string, updates: Partial<RoadmapItem>): void {
        const fields = Object.keys(updates).filter((k) => k !== 'id');
        const setClause = fields.map((f) => `${f} = ?`).join(', ');
        const values = fields.map((f) => (updates as Record<string, unknown>)[f]);
        this.db.prepare(`UPDATE roadmap_items SET ${setClause}, updated_at = unixepoch() WHERE id = ?`).run(...values, id);

        // Auto-resolve dependencies when roadmap item is marked as done
        if (updates.status === 'done') {
            this.resolveDependenciesForRoadmapItem(id);
        }
    }

    // Specs
    createSpec(spec: Omit<Spec, 'id' | 'created_at' | 'updated_at'>): Spec {
        // Get roadmap item to generate semantic ID
        const roadmapItem = this.getRoadmapItem(spec.roadmap_item_id);
        if (!roadmapItem) {
            throw new Error(`Roadmap item ${spec.roadmap_item_id} not found`);
        }

        const id = generateSpecId({
            github_issue_id: roadmapItem.github_issue_id,
            title: roadmapItem.title,
        });

        const stmt = this.db.prepare(`
            INSERT INTO specs (id, roadmap_item_id, content, status, worktree_name, branch_name, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, spec.roadmap_item_id, spec.content, spec.status, spec.worktree_name, spec.branch_name, spec.error_message);
        return this.getSpec(id)!;
    }

    getSpec(id: string): Spec | undefined {
        return this.db.prepare('SELECT * FROM specs WHERE id = ?').get(id) as Spec | undefined;
    }

    getSpecs(filter?: { status?: string }): Spec[] {
        if (filter?.status) {
            return this.db.prepare('SELECT * FROM specs WHERE status = ? ORDER BY created_at').all(filter.status) as Spec[];
        }
        return this.db.prepare('SELECT * FROM specs ORDER BY created_at').all() as Spec[];
    }

    updateSpec(id: string, updates: Partial<Spec>): void {
        const fields = Object.keys(updates).filter((k) => k !== 'id');
        const setClause = fields.map((f) => `${f} = ?`).join(', ');
        const values = fields.map((f) => (updates as Record<string, unknown>)[f]);
        this.db.prepare(`UPDATE specs SET ${setClause}, updated_at = unixepoch() WHERE id = ?`).run(...values, id);
    }

    // Task Groups
    createTaskGroup(taskGroup: Omit<TaskGroup, 'id' | 'created_at' | 'updated_at'>): TaskGroup {
        const id = nanoid();
        const stmt = this.db.prepare(`
            INSERT INTO task_groups (id, spec_id, name, description, status, worktree_name, branch_name, sequence_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, taskGroup.spec_id, taskGroup.name, taskGroup.description, taskGroup.status, taskGroup.worktree_name, taskGroup.branch_name, taskGroup.sequence_order);
        return this.getTaskGroup(id)!;
    }

    getTaskGroup(id: string): TaskGroup | undefined {
        return this.db.prepare('SELECT * FROM task_groups WHERE id = ?').get(id) as TaskGroup | undefined;
    }

    getTaskGroupsForSpec(specId: string): TaskGroup[] {
        return this.db.prepare('SELECT * FROM task_groups WHERE spec_id = ? ORDER BY sequence_order').all(specId) as TaskGroup[];
    }

    updateTaskGroup(id: string, updates: Partial<TaskGroup>): void {
        const fields = Object.keys(updates).filter((k) => k !== 'id');
        const setClause = fields.map((f) => `${f} = ?`).join(', ');
        const values = fields.map((f) => (updates as Record<string, unknown>)[f]);
        this.db.prepare(`UPDATE task_groups SET ${setClause}, updated_at = unixepoch() WHERE id = ?`).run(...values, id);
    }

    // Tasks
    createTask(task: Omit<Task, 'id' | 'created_at' | 'updated_at'>): Task {
        const id = nanoid();
        const stmt = this.db.prepare(`
            INSERT INTO tasks (id, task_group_id, description, status, commit_sha, sequence_order)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, task.task_group_id, task.description, task.status, task.commit_sha, task.sequence_order);
        return this.getTask(id)!;
    }

    getTask(id: string): Task | undefined {
        return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
    }

    getTasksForGroup(groupId: string): Task[] {
        return this.db.prepare('SELECT * FROM tasks WHERE task_group_id = ? ORDER BY sequence_order').all(groupId) as Task[];
    }

    updateTask(id: string, updates: Partial<Task>): void {
        const fields = Object.keys(updates).filter((k) => k !== 'id');
        const setClause = fields.map((f) => `${f} = ?`).join(', ');
        const values = fields.map((f) => (updates as Record<string, unknown>)[f]);
        this.db.prepare(`UPDATE tasks SET ${setClause}, updated_at = unixepoch() WHERE id = ?`).run(...values, id);
    }

    // Claude Instances
    createClaudeInstance(instance: Omit<ClaudeInstance, 'created_at' | 'updated_at'>): ClaudeInstance {
        // Use INSERT OR REPLACE to handle cases where an instance with the same ID already exists (e.g., restarting main)
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO claude_instances (id, role, tmux_pane, tmux_window, resume_id, status, context_type, context_id, worktree_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
        `);
        stmt.run(instance.id, instance.role, instance.tmux_pane, instance.tmux_window, instance.resume_id, instance.status, instance.context_type, instance.context_id, instance.worktree_name);
        return this.getClaudeInstance(instance.id)!;
    }

    getClaudeInstance(id: string): ClaudeInstance | undefined {
        return this.db.prepare('SELECT * FROM claude_instances WHERE id = ?').get(id) as ClaudeInstance | undefined;
    }

    getClaudeInstances(filter?: { status?: string; role?: string }): ClaudeInstance[] {
        let query = 'SELECT * FROM claude_instances WHERE 1=1';
        const params: (string | number)[] = [];

        if (filter?.status) {
            query += ' AND status = ?';
            params.push(filter.status);
        }
        if (filter?.role) {
            query += ' AND role = ?';
            params.push(filter.role);
        }

        return this.db.prepare(query).all(...params) as ClaudeInstance[];
    }

    updateClaudeInstance(id: string, updates: Partial<ClaudeInstance>): void {
        const fields = Object.keys(updates).filter((k) => k !== 'id');
        const setClause = fields.map((f) => `${f} = ?`).join(', ');
        const values = fields.map((f) => (updates as Record<string, unknown>)[f]);
        this.db.prepare(`UPDATE claude_instances SET ${setClause}, updated_at = unixepoch() WHERE id = ?`).run(...values, id);
    }

    // User Questions
    createUserQuestion(question: Omit<UserQuestion, 'id' | 'created_at' | 'answered_at'>): UserQuestion {
        const id = nanoid();
        const stmt = this.db.prepare(`
            INSERT INTO user_questions (id, claude_instance_id, question, response, status)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(id, question.claude_instance_id, question.question, question.response, question.status);
        return this.getUserQuestion(id)!;
    }

    getUserQuestion(id: string): UserQuestion | undefined {
        return this.db.prepare('SELECT * FROM user_questions WHERE id = ?').get(id) as UserQuestion | undefined;
    }

    getPendingQuestions(): UserQuestion[] {
        return this.db.prepare('SELECT * FROM user_questions WHERE status = ? ORDER BY created_at').all('pending') as UserQuestion[];
    }

    answerQuestion(id: string, response: string): void {
        this.db.prepare(`UPDATE user_questions SET response = ?, status = 'answered', answered_at = unixepoch() WHERE id = ?`).run(response, id);
    }

    // Dependencies
    createDependency(dep: Omit<Dependency, 'id' | 'created_at'>): Dependency {
        const id = nanoid();
        const stmt = this.db.prepare(`
            INSERT INTO dependencies (id, blocker_type, blocker_id, blocked_type, blocked_id, resolved)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, dep.blocker_type, dep.blocker_id, dep.blocked_type, dep.blocked_id, dep.resolved);
        return this.db.prepare('SELECT * FROM dependencies WHERE id = ?').get(id) as Dependency;
    }

    getBlockersFor(blockedType: string, blockedId: string): Dependency[] {
        return this.db.prepare('SELECT * FROM dependencies WHERE blocked_type = ? AND blocked_id = ? AND resolved = 0').all(blockedType, blockedId) as Dependency[];
    }

    resolveDependency(blockerId: string, blockerType: string): void {
        this.db.prepare('UPDATE dependencies SET resolved = 1 WHERE blocker_id = ? AND blocker_type = ?').run(blockerId, blockerType);
    }

    hasUnresolvedDependencies(blockedType: string, blockedId: string): boolean {
        const count = this.db.prepare('SELECT COUNT(*) as count FROM dependencies WHERE blocked_type = ? AND blocked_id = ? AND resolved = 0').get(blockedType, blockedId) as { count: number };
        return count.count > 0;
    }

    getDependenciesWithDetails(blockedType: string, blockedId: string): Array<Dependency & { blocker_title?: string; blocker_status?: string; blocker_spec_id?: string | null }> {
        const stmt = this.db.prepare(`
            SELECT
                d.*,
                r.title as blocker_title,
                r.status as blocker_status,
                r.spec_id as blocker_spec_id
            FROM dependencies d
            LEFT JOIN roadmap_items r ON d.blocker_type = 'roadmap_item' AND d.blocker_id = r.id
            WHERE d.blocked_type = ? AND d.blocked_id = ? AND d.resolved = 0
        `);
        return stmt.all(blockedType, blockedId) as Array<Dependency & { blocker_title?: string; blocker_status?: string; blocker_spec_id?: string | null }>;
    }

    resolveDependenciesForRoadmapItem(roadmapItemId: string): void {
        this.resolveDependency(roadmapItemId, 'roadmap_item');
    }

    // Auth State
    setAuthState(key: string, value: string): void {
        this.db.prepare(`
            INSERT INTO auth_state (key, value, updated_at) VALUES (?, ?, unixepoch())
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = unixepoch()
        `).run(key, value, value);
    }

    getAuthState(key: string): string | undefined {
        const row = this.db.prepare('SELECT value FROM auth_state WHERE key = ?').get(key) as { value: string } | undefined;
        return row?.value;
    }

    // GitHub Issue Closure
    markGitHubIssueClosed(roadmapItemId: string): void {
        this.db.prepare('UPDATE roadmap_items SET github_issue_closed = 1, updated_at = unixepoch() WHERE id = ?').run(roadmapItemId);
    }

    getCompletedRoadmapItemsWithUnclosedIssues(): RoadmapItem[] {
        return this.db.prepare(`
            SELECT * FROM roadmap_items
            WHERE status = 'done'
            AND github_issue_id IS NOT NULL
            AND github_issue_closed = 0
            ORDER BY updated_at
        `).all() as RoadmapItem[];
    }
}

export function initDb(dbPath: string): Db {
    return new Db(dbPath);
}
