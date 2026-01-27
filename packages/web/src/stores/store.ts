import { create } from 'zustand';
import { api } from '../api/client';

export interface RoadmapItem {
    id: string;
    title: string;
    description: string;
    status: string;
    github_issue_url?: string;
    spec_id?: string;
    resolution_method?: 'merge_and_push' | 'create_pr' | 'push_branch' | 'manual';
}

export interface Spec {
    id: string;
    roadmap_item_id: string;
    content: string;
    status: string;
    taskGroups?: TaskGroup[];
}

export interface TaskGroup {
    id: string;
    name: string;
    description: string;
    status: string;
    tasks: Task[];
}

export interface Task {
    id: string;
    description: string;
    status: string;
}

export interface ClaudeInstance {
    id: string;
    role: 'main' | 'spec_creator' | 'coordinator' | 'worker';
    status: string;
    context_type?: string;
    context_id?: string;
}

export interface Question {
    id: string;
    claude_instance_id: string;
    question: string;
    status: 'pending' | 'answered';
}

export interface ClaudeMessage {
    instanceId: string;
    role: string;
    worktree: string | null;
    data: string;
    messageType: string;
    messageId: string;
    timestamp: number;
}

export interface InstanceMessages {
    [instanceId: string]: ClaudeMessage[];
}

interface AuthStatus {
    github: boolean;
    claude: boolean;
    ready: boolean;
}

interface RepositoryInfo {
    owner: string;
    name: string;
}

interface OrchestratorState {
    // Auth
    authStatus: AuthStatus | null;
    repositoryInfo: RepositoryInfo | null;

    // Data
    roadmapItems: RoadmapItem[];
    specs: Spec[];
    claudeInstances: ClaudeInstance[];
    pendingQuestions: Question[];
    instanceMessages: InstanceMessages;

    // UI
    selectedClaudeId: string | null;
    showShutdownConfirm: boolean;

    // Actions
    setAuthStatus: (status: AuthStatus | null) => void;
    setRepositoryInfo: (info: RepositoryInfo | null) => void;
    setRoadmapItems: (items: RoadmapItem[]) => void;
    updateRoadmapItem: (item: RoadmapItem) => void;
    addRoadmapItem: (item: RoadmapItem) => void;
    setSpecs: (specs: Spec[]) => void;
    updateSpec: (spec: Spec) => void;
    fetchSpec: (specId: string) => Promise<Spec>;
    setClaudeInstances: (instances: ClaudeInstance[]) => void;
    updateClaudeInstance: (instance: ClaudeInstance) => void;
    addQuestion: (question: Question) => void;
    removeQuestion: (id: string) => void;
    selectClaude: (id: string | null) => void;
    setShowShutdownConfirm: (show: boolean) => void;
    addClaudeMessage: (message: ClaudeMessage) => void;
    getInstanceMessages: (instanceId: string) => ClaudeMessage[];
    updateTaskGroup: (taskGroup: TaskGroup) => void;
    updateTask: (task: Task) => void;
}

const MAX_MESSAGES_NON_MAIN = 10;

export const useStore = create<OrchestratorState>((set, get) => ({
    authStatus: null,
    repositoryInfo: null,
    roadmapItems: [],
    specs: [],
    claudeInstances: [],
    pendingQuestions: [],
    instanceMessages: {},
    selectedClaudeId: null,
    showShutdownConfirm: false,

    setAuthStatus: (authStatus) => set({ authStatus }),

    setRepositoryInfo: (repositoryInfo) => set({ repositoryInfo }),

    setRoadmapItems: (roadmapItems) => set({ roadmapItems }),

    updateRoadmapItem: (item) =>
        set((state) => ({
            roadmapItems: state.roadmapItems.map((r) => (r.id === item.id ? item : r)),
        })),

    addRoadmapItem: (item) =>
        set((state) => ({
            roadmapItems: [...state.roadmapItems, item],
        })),

    setSpecs: (specs) => set({ specs }),

    updateSpec: (spec) =>
        set((state) => ({
            specs: state.specs.map((s) => (s.id === spec.id ? spec : s)),
        })),

    fetchSpec: async (specId) => {
        const { specs } = get();

        // Check if already cached with full data
        const cached = specs.find((s) => s.id === specId);
        if (cached && cached.taskGroups) {
            return cached; // Already have full spec with task groups
        }

        try {
            const spec = (await api.getSpec(specId)) as Spec;

            set((state) => {
                // Replace or add spec in array
                const existingIndex = state.specs.findIndex((s) => s.id === specId);
                const updatedSpecs: Spec[] =
                    existingIndex >= 0
                        ? state.specs.map((s, i) => (i === existingIndex ? spec : s))
                        : [...state.specs, spec];

                return { specs: updatedSpecs };
            });

            return spec;
        } catch (error) {
            console.error('Failed to fetch spec:', error);
            throw error;
        }
    },

    setClaudeInstances: (claudeInstances) => set({ claudeInstances }),

    updateClaudeInstance: (instance) =>
        set((state) => ({
            claudeInstances: state.claudeInstances.map((c) =>
                c.id === instance.id ? instance : c
            ),
        })),

    addQuestion: (question) =>
        set((state) => ({
            pendingQuestions: [...state.pendingQuestions, question],
        })),

    removeQuestion: (id) =>
        set((state) => ({
            pendingQuestions: state.pendingQuestions.filter((q) => q.id !== id),
        })),

    selectClaude: (selectedClaudeId) => set({ selectedClaudeId }),

    setShowShutdownConfirm: (showShutdownConfirm) => set({ showShutdownConfirm }),

    addClaudeMessage: (message) =>
        set((state) => {
            const { instanceId } = message;
            const currentMessages = state.instanceMessages[instanceId] || [];
            const newMessages = [...currentMessages, message];

            // Prune messages for non-main instances
            // Main instance (id === 'main') keeps all messages
            const prunedMessages =
                instanceId === 'main'
                    ? newMessages
                    : newMessages.slice(-MAX_MESSAGES_NON_MAIN);

            return {
                instanceMessages: {
                    ...state.instanceMessages,
                    [instanceId]: prunedMessages,
                },
            };
        }),

    getInstanceMessages: (instanceId) => {
        return get().instanceMessages[instanceId] || [];
    },

    updateTaskGroup: (taskGroup) =>
        set((state) => {
            // Find the spec containing this task group
            const updatedSpecs = state.specs.map((spec) => {
                if (!spec.taskGroups) return spec;

                const hasTaskGroup = spec.taskGroups.some((tg) => tg.id === taskGroup.id);
                if (!hasTaskGroup) return spec;

                return {
                    ...spec,
                    taskGroups: spec.taskGroups.map((tg) =>
                        tg.id === taskGroup.id ? { ...taskGroup, tasks: tg.tasks } : tg
                    ),
                };
            });

            return { specs: updatedSpecs };
        }),

    updateTask: (task) =>
        set((state) => {
            // Find the spec and task group containing this task
            const updatedSpecs = state.specs.map((spec) => {
                if (!spec.taskGroups) return spec;

                const hasTask = spec.taskGroups.some((tg) =>
                    tg.tasks.some((t) => t.id === task.id)
                );
                if (!hasTask) return spec;

                return {
                    ...spec,
                    taskGroups: spec.taskGroups.map((tg) => ({
                        ...tg,
                        tasks: tg.tasks.map((t) => (t.id === task.id ? task : t)),
                    })),
                };
            });

            return { specs: updatedSpecs };
        }),
}));
