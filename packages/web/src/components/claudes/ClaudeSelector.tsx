import { useEffect } from 'react';
import { useStore } from '../../stores/store';

const ROLE_COLORS: Record<string, string> = {
    main: 'bg-green-500',
    spec_creator: 'bg-blue-500',
    coordinator: 'bg-purple-500',
    worker: 'bg-yellow-500',
};

const ROLE_PRIORITY: Record<string, number> = {
    main: 0,
    spec_creator: 1,
    coordinator: 2,
    worker: 3,
};

export function ClaudeSelector() {
    const { claudeInstances, selectedClaudeId, selectClaude } = useStore();

    // Sort instances by role priority
    const sortedInstances = [...claudeInstances].sort((a, b) => {
        const priorityA = ROLE_PRIORITY[a.role] ?? 999;
        const priorityB = ROLE_PRIORITY[b.role] ?? 999;
        return priorityA - priorityB;
    });

    // Auto-select main if available and nothing is selected
    useEffect(() => {
        if (selectedClaudeId === null && claudeInstances.length > 0) {
            const mainInstance = claudeInstances.find((c) => c.role === 'main');
            const instanceToSelect = mainInstance || claudeInstances[0];
            selectClaude(instanceToSelect.id);
        }
    }, [claudeInstances, selectedClaudeId, selectClaude]);

    // If selected instance was removed, auto-select next available
    useEffect(() => {
        if (selectedClaudeId && !claudeInstances.find((c) => c.id === selectedClaudeId)) {
            if (claudeInstances.length > 0) {
                const mainInstance = claudeInstances.find((c) => c.role === 'main');
                const instanceToSelect = mainInstance || claudeInstances[0];
                selectClaude(instanceToSelect.id);
            } else {
                selectClaude(null);
            }
        }
    }, [claudeInstances, selectedClaudeId, selectClaude]);

    const selectedInstance = claudeInstances.find((c) => c.id === selectedClaudeId);

    if (claudeInstances.length === 0) {
        return (
            <div className="p-3 border-b border-gray-700">
                <div className="text-sm text-gray-500">No Claude instances running</div>
            </div>
        );
    }

    return (
        <div className="p-3 border-b border-gray-700">
            <label htmlFor="claude-selector" className="block text-xs font-semibold text-gray-400 uppercase mb-2">
                Claude Instance
            </label>
            <select
                id="claude-selector"
                value={selectedClaudeId || ''}
                onChange={(e) => selectClaude(e.target.value || null)}
                className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 hover:bg-gray-700"
            >
                {sortedInstances.map((instance) => (
                    <option key={instance.id} value={instance.id}>
                        {instance.role.charAt(0).toUpperCase() + instance.role.slice(1).replace('_', ' ')} - {instance.id.slice(0, 8)} ({instance.status})
                    </option>
                ))}
            </select>

            {selectedInstance && (
                <div className="mt-2 flex items-center gap-2 text-sm">
                    <span className={`w-2 h-2 rounded-full ${ROLE_COLORS[selectedInstance.role] || 'bg-gray-500'}`} />
                    <span className="font-medium capitalize">{selectedInstance.role.replace('_', ' ')}</span>
                    <span className="text-gray-500">{selectedInstance.id.slice(0, 8)}</span>
                    <span
                        className={`ml-auto text-xs px-1.5 py-0.5 rounded ${
                            selectedInstance.status === 'running' ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'
                        }`}
                    >
                        {selectedInstance.status}
                    </span>
                </div>
            )}
        </div>
    );
}
