const BASE_URL = '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
        ...(options?.headers as Record<string, string>),
    };

    // Only set Content-Type for requests with a body
    if (options?.body) {
        headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers,
    });

    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    return res.json();
}

export const api = {
    // Auth
    getAuthStatus: () => request<{ github: boolean; claude: boolean; ready: boolean }>('/api/auth/status'),

    startGitHubAuth: () =>
        request<{ userCode: string; verificationUri: string; expiresIn: number }>('/api/auth/github/start', {
            method: 'POST',
        }),

    pollGitHubAuth: () =>
        request<{ token?: string; pending?: boolean; error?: string }>('/api/auth/github/poll', {
            method: 'POST',
        }),

    completeAuth: () => request<{ success: boolean }>('/api/auth/complete', { method: 'POST' }),

    // Roadmap
    getRoadmapItems: () => request<unknown[]>('/api/roadmap'),

    createRoadmapItem: (title: string, description: string) =>
        request<unknown>('/api/roadmap', {
            method: 'POST',
            body: JSON.stringify({ title, description }),
        }),

    updateRoadmapItem: (id: string, updates: { title?: string; description?: string; status?: string }) =>
        request<unknown>(`/api/roadmap/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(updates),
        }),

    getRoadmapItemTasks: (id: string) => request<unknown>(`/api/roadmap/${id}/tasks`),

    // Specs
    getSpecs: () => request<unknown[]>('/api/specs'),

    getSpec: (id: string) => request<unknown>(`/api/specs/${id}`),

    // Claude instances
    getClaudeInstances: () => request<unknown[]>('/api/claudes'),

    // Questions
    answerQuestion: (id: string, response: string) =>
        request<{ success: boolean }>(`/api/questions/${id}/answer`, {
            method: 'POST',
            body: JSON.stringify({ response }),
        }),

    // Main claude
    sendToMain: (message: string) =>
        request<{ success: boolean }>('/api/main/message', {
            method: 'POST',
            body: JSON.stringify({ message }),
        }),

    // Shutdown
    shutdown: () => request<{ success: boolean }>('/shutdown', { method: 'POST' }),
};
