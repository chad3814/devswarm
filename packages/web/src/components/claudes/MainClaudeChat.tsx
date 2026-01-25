import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';

interface MainClaudeChatProps {
    instanceId: string;
}

export function MainClaudeChat({ instanceId }: MainClaudeChatProps) {
    const [messages, setMessages] = useState<{ role: 'user' | 'claude'; content: string }[]>([]);
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { subscribeToClaude, sendToMain } = useWebSocket();

    useEffect(() => {
        const unsubscribe = subscribeToClaude(instanceId, (data) => {
            setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === 'claude') {
                    return [...prev.slice(0, -1), { ...last, content: last.content + data }];
                }
                return [...prev, { role: 'claude', content: data }];
            });
        });

        return unsubscribe;
    }, [instanceId, subscribeToClaude]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!input.trim()) {
            return;
        }

        setMessages((prev) => [...prev, { role: 'user', content: input }]);
        sendToMain(input);
        setInput('');
    };

    return (
        <div className="flex flex-col h-full">
            <div className="px-4 py-3 bg-gray-800 border-b border-gray-700">
                <h2 className="font-semibold">Main Claude</h2>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-4">
                {messages.map((msg, i) => (
                    <div
                        key={i}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`max-w-[80%] rounded-lg px-4 py-2 ${
                                msg.role === 'user'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-800 text-gray-100'
                            }`}
                        >
                            <pre className="whitespace-pre-wrap font-sans text-sm">{msg.content}</pre>
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Send a message to main claude..."
                        className="flex-1 bg-gray-800 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        type="submit"
                        className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
                    >
                        Send
                    </button>
                </div>
            </form>
        </div>
    );
}
