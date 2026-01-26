import { useStore } from '../../stores/store';

const ROLE_COLORS: Record<string, string> = {
    main: 'bg-green-500',
    spec_creator: 'bg-blue-500',
    coordinator: 'bg-purple-500',
    worker: 'bg-yellow-500',
};

export function ClaudeList() {
    const { claudeInstances, selectedClaudeId, selectClaude } = useStore();

    return (
        <div className="border-b border-gray-700">
            <div className="p-3 border-b border-gray-700">
                <h2 className="text-sm font-semibold text-gray-400 uppercase">Claude Instances</h2>
            </div>

            <div className="max-h-48 overflow-auto">
                {claudeInstances.map((instance) => (
                    <button
                        key={instance.id}
                        onClick={() => selectClaude(instance.id === selectedClaudeId ? null : instance.id)}
                        className={`w-full px-3 py-2 text-left hover:bg-gray-800 flex items-center gap-2 ${
                            instance.id === selectedClaudeId ? 'bg-gray-800' : ''
                        }`}
                    >
                        <span className={`w-2 h-2 rounded-full ${ROLE_COLORS[instance.role] || 'bg-gray-500'}`} />
                        <span className="flex-1 truncate">
                            <span className="font-medium capitalize">{instance.role}</span>
                            <span className="text-gray-500 text-sm ml-2">{instance.id.slice(0, 8)}</span>
                        </span>
                        <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                                instance.status === 'running' ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'
                            }`}
                        >
                            {instance.status}
                        </span>
                    </button>
                ))}

                {claudeInstances.length === 0 && (
                    <div className="px-3 py-4 text-center text-gray-500 text-sm">
                        No Claude instances running
                    </div>
                )}
            </div>
        </div>
    );
}
