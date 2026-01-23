import { useStore } from '../../stores/store';

export function StatusBar() {
    const { roadmapItems, claudeInstances, pendingQuestions } = useStore();

    const pending = roadmapItems.filter((r) => r.status === 'pending').length;
    const inProgress = roadmapItems.filter((r) =>
        ['spec_in_progress', 'in_progress', 'pr_open'].includes(r.status)
    ).length;
    const done = roadmapItems.filter((r) => r.status === 'done').length;

    const runningClaudes = claudeInstances.filter((c) => c.status === 'running').length;

    return (
        <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
                <span className="text-gray-400">Roadmap:</span>
                <span className="text-yellow-400">{pending} pending</span>
                <span className="text-blue-400">{inProgress} in progress</span>
                <span className="text-green-400">{done} done</span>
            </div>

            <div className="flex items-center gap-2">
                <span className="text-gray-400">Claudes:</span>
                <span className={runningClaudes > 0 ? 'text-green-400' : 'text-gray-500'}>
                    {runningClaudes} running
                </span>
            </div>

            {pendingQuestions.length > 0 && (
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                    <span className="text-orange-400">
                        {pendingQuestions.length} question{pendingQuestions.length !== 1 ? 's' : ''} waiting
                    </span>
                </div>
            )}
        </div>
    );
}
