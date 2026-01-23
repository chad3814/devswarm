import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useStore } from '../stores/store';

interface AuthGateProps {
    authStatus: { github: boolean; claude: boolean; ready: boolean };
}

export function AuthGate({ authStatus }: AuthGateProps) {
    const [githubCode, setGithubCode] = useState<string | null>(null);
    const [githubUrl, setGithubUrl] = useState<string | null>(null);
    const [polling, setPolling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { setAuthStatus } = useStore();

    const startGitHubAuth = async () => {
        try {
            const result = await api.startGitHubAuth();
            setGithubCode(result.userCode);
            setGithubUrl(result.verificationUri);
            setPolling(true);
        } catch (e) {
            setError('Failed to start GitHub authentication');
        }
    };

    useEffect(() => {
        if (!polling) return;

        const interval = setInterval(async () => {
            try {
                const result = await api.pollGitHubAuth();

                if (result.token) {
                    setPolling(false);
                    const newStatus = await api.getAuthStatus();
                    setAuthStatus(newStatus);

                    if (newStatus.ready) {
                        await api.completeAuth();
                    }
                } else if (result.error) {
                    setError(result.error);
                    setPolling(false);
                }
            } catch (e) {
                // Keep polling
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [polling, setAuthStatus]);

    return (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-gray-100 p-8">
            <h1 className="text-3xl font-bold mb-8">Orchestr8 Setup</h1>

            <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
                <h2 className="text-xl font-semibold mb-4">Authentication Required</h2>

                {/* GitHub Auth */}
                <div className="mb-6">
                    <div className="flex items-center mb-2">
                        <span className={`w-3 h-3 rounded-full mr-2 ${authStatus.github ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span>GitHub</span>
                    </div>

                    {!authStatus.github && !githubCode && (
                        <button
                            onClick={startGitHubAuth}
                            className="w-full bg-gray-700 hover:bg-gray-600 py-2 px-4 rounded"
                        >
                            Connect GitHub
                        </button>
                    )}

                    {githubCode && (
                        <div className="bg-gray-700 p-4 rounded">
                            <p className="mb-2">Enter this code at GitHub:</p>
                            <div className="bg-gray-900 p-3 rounded text-center text-2xl font-mono mb-3">
                                {githubCode}
                            </div>
                            <a
                                href={githubUrl!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block w-full bg-blue-600 hover:bg-blue-700 py-2 px-4 rounded text-center"
                            >
                                Open GitHub
                            </a>
                            {polling && (
                                <p className="text-sm text-gray-400 mt-2 text-center">
                                    Waiting for authorization...
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Claude Auth */}
                <div className="mb-6">
                    <div className="flex items-center mb-2">
                        <span className={`w-3 h-3 rounded-full mr-2 ${authStatus.claude ? 'bg-green-500' : 'bg-yellow-500'}`} />
                        <span>Claude CLI</span>
                    </div>

                    {!authStatus.claude && (
                        <p className="text-sm text-gray-400">
                            Claude CLI authentication will be handled when the orchestrator starts.
                        </p>
                    )}
                </div>

                {error && (
                    <div className="bg-red-900/50 border border-red-700 p-3 rounded mb-4">
                        {error}
                    </div>
                )}

                {authStatus.github && authStatus.claude && (
                    <button
                        onClick={async () => {
                            await api.completeAuth();
                            const newStatus = await api.getAuthStatus();
                            setAuthStatus(newStatus);
                        }}
                        className="w-full bg-green-600 hover:bg-green-700 py-2 px-4 rounded"
                    >
                        Start Orchestrator
                    </button>
                )}
            </div>
        </div>
    );
}
