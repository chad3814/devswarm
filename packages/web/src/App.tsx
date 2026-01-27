import { useEffect } from 'react';
import { useStore } from './stores/store';
import { api } from './api/client';
import { useWebSocket } from './hooks/useWebSocket';
import { AuthGate } from './components/AuthGate';
import { RoadmapPanel } from './components/roadmap/RoadmapPanel';
import { ClaudeSelector } from './components/claudes/ClaudeSelector';
import { ClaudePanel } from './components/claudes/ClaudePanel';
import { MainClaudeChat } from './components/claudes/MainClaudeChat';
import { QuestionModal } from './components/questions/QuestionModal';
import { StatusBar } from './components/controls/StatusBar';

export function App() {
    const { authStatus, setAuthStatus, selectedClaudeId, claudeInstances, pendingQuestions } = useStore();
    const { shutdown } = useWebSocket();

    useEffect(() => {
        api.getAuthStatus().then(setAuthStatus).catch(console.error);
    }, [setAuthStatus]);

    // When auth is ready, trigger the orchestrator initialization
    useEffect(() => {
        if (authStatus?.ready) {
            api.completeAuth().catch(console.error);
        }
    }, [authStatus?.ready]);

    if (!authStatus) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-100">
                Loading...
            </div>
        );
    }

    if (!authStatus.ready) {
        return <AuthGate authStatus={authStatus} />;
    }

    const selectedClaude = claudeInstances.find((c) => c.id === selectedClaudeId);

    return (
        <div className="flex flex-col h-screen bg-gray-900 text-gray-100">
            <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
                <h1 className="text-xl font-bold">/dev/swarm</h1>
                <button
                    onClick={() => {
                        if (confirm('Are you sure you want to shut down? All work will be saved.')) {
                            shutdown();
                        }
                    }}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
                >
                    Shutdown
                </button>
            </header>

            <div className="flex-1 flex overflow-hidden">
                {/* Left: Roadmap */}
                <div className="w-1/3 border-r border-gray-700 overflow-auto">
                    <RoadmapPanel />
                </div>

                {/* Right: Unified Claude column with selector */}
                <div className="w-2/3 flex flex-col">
                    <ClaudeSelector />

                    <div className="flex-1 min-h-0">
                        {selectedClaude?.role === 'main' ? (
                            <MainClaudeChat instanceId={selectedClaude.id} />
                        ) : selectedClaude ? (
                            <ClaudePanel
                                instanceId={selectedClaude.id}
                                title={`${selectedClaude.role} - ${selectedClaude.id.slice(0, 8)}`}
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full text-gray-500">
                                No Claude instances running
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <StatusBar />

            {/* Question modal */}
            {pendingQuestions.length > 0 && <QuestionModal question={pendingQuestions[0]} />}
        </div>
    );
}
