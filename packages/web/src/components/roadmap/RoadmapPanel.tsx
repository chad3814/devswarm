import { useState } from 'react';
import { useStore, RoadmapItem } from '../../stores/store';
import { api } from '../../api/client';

const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-gray-500',
    spec_in_progress: 'bg-yellow-500',
    spec_review: 'bg-orange-500',
    ready: 'bg-blue-500',
    in_progress: 'bg-purple-500',
    pr_open: 'bg-cyan-500',
    done: 'bg-green-500',
};

const getStatusIcon = (status: string): string => {
    switch (status) {
        case 'done':
            return '✓';
        case 'in_progress':
            return '◐';
        case 'pending':
        default:
            return '○';
    }
};

const getResolutionDescription = (method: string | undefined): string => {
    switch (method) {
        case 'merge_and_push':
            return 'Automatically merge to main and push when complete';
        case 'create_pr':
            return 'Create a pull request for review when complete';
        case 'push_branch':
            return 'Push the branch without merging when complete';
        case 'manual':
            return 'Main Claude will handle completion manually';
        default:
            return 'Automatically merge to main and push when complete';
    }
};

function RoadmapItemComponent({ item, loadingSpecs, setLoadingSpecs }: {
    item: RoadmapItem;
    loadingSpecs: Set<string>;
    setLoadingSpecs: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const { specs, fetchSpec } = useStore();

    const handleResolutionChange = async (itemId: string, newMethod: string) => {
        try {
            await api.updateRoadmapItem(itemId, {
                resolution_method: newMethod as 'merge_and_push' | 'create_pr' | 'push_branch' | 'manual'
            });
            // The WebSocket broadcast will update the store automatically
        } catch (e) {
            console.error('Failed to update resolution method:', e);
        }
    };

    const toggleExpand = async () => {
        if (isExpanded) {
            setIsExpanded(false);
        } else {
            setIsExpanded(true);

            // Fetch spec details if needed
            if (item.spec_id) {
                const cached = specs.find((s) => s.id === item.spec_id);
                if (!cached || !cached.taskGroups) {
                    setLoadingSpecs(prev => new Set(prev).add(item.spec_id!));
                    try {
                        await fetchSpec(item.spec_id);
                    } catch (e) {
                        console.error('Failed to load spec:', e);
                    } finally {
                        setLoadingSpecs(prev => {
                            const next = new Set(prev);
                            next.delete(item.spec_id!);
                            return next;
                        });
                    }
                }
            }
        }
    };

    const renderTaskProgress = () => {
        if (!item.spec_id) return null;

        // Loading state
        if (loadingSpecs.has(item.spec_id)) {
            return (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                    <span className="animate-spin">⟳</span>
                    <span>Loading tasks...</span>
                </div>
            );
        }

        // Get spec from store
        const spec = specs.find((s) => s.id === item.spec_id);
        if (!spec?.taskGroups || spec.taskGroups.length === 0) {
            return (
                <div className="text-sm text-gray-500 italic">
                    No tasks defined yet
                </div>
            );
        }

        // Render task groups and tasks
        return (
            <div className="space-y-2">
                <h4 className="text-xs font-semibold text-gray-400 uppercase">Tasks</h4>
                {spec.taskGroups.map((group) => (
                    <div key={group.id} className="space-y-1">
                        {/* Task Group Header */}
                        <div className="flex items-center gap-2 text-sm">
                            <span>{getStatusIcon(group.status)}</span>
                            <span className="font-medium text-gray-200">
                                {group.name}
                            </span>
                            <span className="text-xs text-gray-500 capitalize">
                                ({group.status.replace(/_/g, ' ')})
                            </span>
                        </div>

                        {/* Tasks */}
                        {group.tasks && group.tasks.length > 0 && (
                            <div className="ml-6 space-y-0.5">
                                {group.tasks.map((task) => (
                                    <div key={task.id} className="flex items-start gap-2 text-sm">
                                        <span className="text-gray-400 flex-shrink-0">
                                            {getStatusIcon(task.status)}
                                        </span>
                                        <span className={`text-gray-300 ${task.status === 'done' ? 'line-through text-gray-500' : ''}`}>
                                            {task.description}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="bg-gray-800 rounded hover:bg-gray-750 transition-colors">
            <div
                className="p-3 cursor-pointer flex items-center gap-2"
                onClick={toggleExpand}
            >
                <span className="text-gray-400 transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                    ›
                </span>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[item.status] || 'bg-gray-500'}`} />
                <span className="font-medium flex-1">{item.title}</span>
                <span className="text-xs text-gray-500 capitalize">{item.status.replace(/_/g, ' ')}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300 flex-shrink-0">
                    {item.resolution_method === 'merge_and_push' && '🔀 Auto-merge'}
                    {item.resolution_method === 'create_pr' && '🔃 PR'}
                    {item.resolution_method === 'push_branch' && '📤 Push'}
                    {item.resolution_method === 'manual' && '✋ Manual'}
                    {!item.resolution_method && '🔀 Auto-merge'}
                </span>
                {item.github_issue_url && (
                    <a
                        href={item.github_issue_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:underline flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                    >
                        Issue
                    </a>
                )}
            </div>

            {isExpanded && (
                <div className="px-3 pb-3 space-y-3 border-t border-gray-700 pt-3 mt-1">
                    {item.description && (
                        <p className="text-sm text-gray-300 whitespace-pre-wrap">{item.description}</p>
                    )}

                    {/* Resolution Method Editor */}
                    {item.status !== 'done' && (
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Resolution Method</label>
                            <select
                                value={item.resolution_method || 'merge_and_push'}
                                onChange={(e) => handleResolutionChange(item.id, e.target.value)}
                                className="w-full bg-gray-700 rounded px-3 py-1.5 text-sm"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <option value="merge_and_push">🔀 Merge and Push (Recommended)</option>
                                <option value="create_pr">🔃 Create Pull Request</option>
                                <option value="push_branch">📤 Push Branch Only</option>
                                <option value="manual">✋ Manual</option>
                            </select>
                            <p className="text-xs text-gray-500 mt-1">
                                {getResolutionDescription(item.resolution_method)}
                            </p>
                        </div>
                    )}

                    {renderTaskProgress()}
                </div>
            )}
        </div>
    );
}

export function RoadmapPanel() {
    const { roadmapItems, addRoadmapItem } = useStore();
    const [showAdd, setShowAdd] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [loadingSpecs, setLoadingSpecs] = useState<Set<string>>(new Set());
    const [resolutionMethod, setResolutionMethod] = useState('merge_and_push');

    const handleAdd = async () => {
        if (!newTitle.trim()) return;

        try {
            const item = await api.createRoadmapItem(newTitle, newDescription, resolutionMethod);
            addRoadmapItem(item as any);
            setNewTitle('');
            setNewDescription('');
            setResolutionMethod('merge_and_push');
            setShowAdd(false);
        } catch (e) {
            console.error('Failed to create roadmap item:', e);
        }
    };

    return (
        <div className="p-4">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Roadmap</h2>
                <button
                    onClick={() => setShowAdd(!showAdd)}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm"
                >
                    {showAdd ? 'Cancel' : '+ Add'}
                </button>
            </div>

            {showAdd && (
                <div className="bg-gray-800 rounded p-4 mb-4">
                    <input
                        type="text"
                        placeholder="Title"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        className="w-full bg-gray-700 rounded px-3 py-2 mb-2"
                    />
                    <textarea
                        placeholder="Description"
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        className="w-full bg-gray-700 rounded px-3 py-2 mb-2 h-24"
                    />

                    <div className="mb-2">
                        <label className="block text-sm text-gray-400 mb-1">Resolution Method</label>
                        <select
                            value={resolutionMethod}
                            onChange={(e) => setResolutionMethod(e.target.value)}
                            className="w-full bg-gray-700 rounded px-3 py-2"
                        >
                            <option value="merge_and_push">Merge and Push (Recommended)</option>
                            <option value="create_pr">Create Pull Request</option>
                            <option value="push_branch">Push Branch Only</option>
                            <option value="manual">Manual (No Automatic Action)</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                            {resolutionMethod === 'merge_and_push' && 'Automatically merge to main and push when complete'}
                            {resolutionMethod === 'create_pr' && 'Create a pull request for review when complete'}
                            {resolutionMethod === 'push_branch' && 'Push the branch without merging when complete'}
                            {resolutionMethod === 'manual' && 'Main Claude will handle completion manually'}
                        </p>
                    </div>

                    <button
                        onClick={handleAdd}
                        className="w-full bg-green-600 hover:bg-green-700 rounded py-2"
                    >
                        Create
                    </button>
                </div>
            )}

            <div className="space-y-2">
                {roadmapItems.map((item) => (
                    <RoadmapItemComponent
                        key={item.id}
                        item={item}
                        loadingSpecs={loadingSpecs}
                        setLoadingSpecs={setLoadingSpecs}
                    />
                ))}

                {roadmapItems.length === 0 && (
                    <div className="text-center text-gray-500 py-8">
                        No roadmap items yet. Add one or sync from GitHub issues.
                    </div>
                )}
            </div>
        </div>
    );
}
