import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useStore } from '../../stores/store';

interface MainClaudeChatProps {
    instanceId: string;
}

export function MainClaudeChat({ instanceId }: MainClaudeChatProps) {
    const [messages, setMessages] = useState<{ role: 'user' | 'claude'; content: string; messageId?: string }[]>([]);
    const [input, setInput] = useState('');
    const [isExpanded, setIsExpanded] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const loadedRef = useRef(false);
    const { subscribeToClaude, sendToMain } = useWebSocket();
    const { getInstanceMessages } = useStore();

    // Load historical messages on mount
    useEffect(() => {
        if (!loadedRef.current) {
            const historicalMessages = getInstanceMessages(instanceId);
            const claudeMessages = historicalMessages.map(msg => ({
                role: 'claude' as const,
                content: msg.data,
                messageId: msg.messageId
            }));
            setMessages(claudeMessages);
            loadedRef.current = true;
        }
    }, [instanceId, getInstanceMessages]);

    useEffect(() => {
        const unsubscribe = subscribeToClaude(instanceId, (data) => {
            setMessages((prev) => {
                const last = prev[prev.length - 1];

                // If continuing the same message, append without extra spacing
                if (last?.role === 'claude' &&
                    last.messageId === data.messageId &&
                    data.messageType === 'continue') {
                    return [
                        ...prev.slice(0, -1),
                        {
                            ...last,
                            content: last.content + data.text
                        }
                    ];
                }

                // New message
                return [
                    ...prev,
                    {
                        role: 'claude',
                        content: data.text,
                        messageId: data.messageId
                    }
                ];
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
        setIsExpanded(false); // Reset to collapsed state
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault(); // Prevent form submit
            const target = e.currentTarget;
            const cursorPos = target.selectionStart || 0;
            const newValue = input.slice(0, cursorPos) + '\n' + input.slice(cursorPos);
            setInput(newValue);
            setIsExpanded(true);
        }
    };

    const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit(e as any);
        }
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
                    {isExpanded ? (
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleTextareaKeyDown}
                            placeholder="Send a message to main claude... (Cmd/Ctrl+Enter to send)"
                            className="flex-1 bg-gray-800 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            rows={4}
                            autoFocus
                        />
                    ) : (
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Send a message to main claude... (Shift+Enter for multi-line)"
                            className="flex-1 bg-gray-800 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    )}
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
