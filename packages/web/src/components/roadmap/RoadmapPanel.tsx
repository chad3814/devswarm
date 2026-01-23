import { useState } from 'react';
import { useStore } from '../../stores/store';
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

export function RoadmapPanel() {
    const { roadmapItems, addRoadmapItem } = useStore();
    const [showAdd, setShowAdd] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDescription, setNewDescription] = useState('');

    const handleAdd = async () => {
        if (!newTitle.trim()) return;

        try {
            const item = await api.createRoadmapItem(newTitle, newDescription);
            addRoadmapItem(item as any);
            setNewTitle('');
            setNewDescription('');
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
                    <div
                        key={item.id}
                        className="bg-gray-800 rounded p-3 hover:bg-gray-750 cursor-pointer"
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[item.status] || 'bg-gray-500'}`} />
                            <span className="font-medium">{item.title}</span>
                        </div>
                        <p className="text-sm text-gray-400 line-clamp-2">{item.description}</p>
                        <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs text-gray-500 capitalize">{item.status.replace(/_/g, ' ')}</span>
                            {item.github_issue_url && (
                                <a
                                    href={item.github_issue_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-400 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    GitHub Issue
                                </a>
                            )}
                        </div>
                    </div>
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
