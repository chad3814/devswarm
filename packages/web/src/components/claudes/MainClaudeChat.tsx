import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useStore } from '../../stores/store';
import { uploadFile } from '../../api/client';

interface MainClaudeChatProps {
    instanceId: string;
}

export function MainClaudeChat({ instanceId }: MainClaudeChatProps) {
    const [messages, setMessages] = useState<{ role: 'user' | 'claude'; content: string; messageId?: string }[]>([]);
    const [input, setInput] = useState('');
    const [uploading, setUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const loadedRef = useRef(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
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

    const handleFileUpload = async (files: FileList) => {
        setUploading(true);
        const fileArray = Array.from(files);
        setUploadProgress({ current: 0, total: fileArray.length });

        try {
            let uploadedCount = 0;
            for (const file of fileArray) {
                if (file.size > 1024 * 1024) {
                    alert(`File ${file.name} exceeds 1MB limit`);
                    continue;
                }

                setUploadProgress({ current: uploadedCount + 1, total: fileArray.length });
                const path = await uploadFile(file);
                setInput(prev => prev ? `${prev} \`${path}\`` : `\`${path}\``);
                uploadedCount++;
            }
        } catch (error) {
            console.error('Upload failed:', error);
            alert('Failed to upload file');
        } finally {
            setUploading(false);
            setUploadProgress({ current: 0, total: 0 });
        }
    };

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(true);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileUpload(e.dataTransfer.files);
        }
    };

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
        <div
            className="flex flex-col h-full"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className={`px-4 py-3 bg-gray-800 border-b border-gray-700 ${dragActive ? 'ring-2 ring-blue-500' : ''}`}>
                <h2 className="font-semibold">Main Claude</h2>
            </div>

            <div className={`flex-1 overflow-auto p-4 space-y-4 ${dragActive ? 'ring-2 ring-blue-500 bg-blue-900/10' : ''}`}>
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

            <form
                onSubmit={handleSubmit}
                className={`p-4 border-t border-gray-700 ${dragActive ? 'ring-2 ring-blue-500' : ''}`}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                    className="hidden"
                    multiple
                />
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
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded disabled:opacity-50"
                        disabled={uploading}
                        title="Upload file(s)"
                    >
                        📎
                    </button>
                    <button
                        type="submit"
                        className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded disabled:opacity-50"
                        disabled={uploading}
                    >
                        {uploading
                            ? `Uploading... (${uploadProgress.current}/${uploadProgress.total})`
                            : 'Send'
                        }
                    </button>
                </div>
            </form>
        </div>
    );
}
