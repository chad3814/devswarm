import { create } from 'zustand';

export interface RoadmapItem {
    id: string;
    title: string;
    description: string;
    status: string;
    github_issue_url?: string;
    spec_id?: string;
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

interface OrchestratorState {
    // Auth
    authStatus: AuthStatus | null;

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
    setRoadmapItems: (items: RoadmapItem[]) => void;
    updateRoadmapItem: (item: RoadmapItem) => void;
    addRoadmapItem: (item: RoadmapItem) => void;
    setSpecs: (specs: Spec[]) => void;
    updateSpec: (spec: Spec) => void;
    setClaudeInstances: (instances: ClaudeInstance[]) => void;
    updateClaudeInstance: (instance: ClaudeInstance) => void;
    addQuestion: (question: Question) => void;
    removeQuestion: (id: string) => void;
    selectClaude: (id: string | null) => void;
    setShowShutdownConfirm: (show: boolean) => void;
    addClaudeMessage: (message: ClaudeMessage) => void;
    getInstanceMessages: (instanceId: string) => ClaudeMessage[];
}

const MAX_MESSAGES_NON_MAIN = 10;

export const useStore = create<OrchestratorState>((set, get) => ({
    authStatus: null,
    roadmapItems: [],
    specs: [],
    claudeInstances: [],
    pendingQuestions: [],
    instanceMessages: {},
    selectedClaudeId: null,
    showShutdownConfirm: false,

    setAuthStatus: (authStatus) => set({ authStatus }),

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
}));
