import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useStore } from '../../stores/store';
import '@xterm/xterm/css/xterm.css';

interface ClaudePanelProps {
    instanceId: string;
    title: string;
}

export function ClaudePanel({ instanceId, title }: ClaudePanelProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const loadedMessagesRef = useRef<Set<string>>(new Set());
    const { subscribeToClaude } = useWebSocket();
    const { getInstanceMessages } = useStore();

    useEffect(() => {
        if (!containerRef.current) return;

        const term = new Terminal({
            fontSize: 13,
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
            theme: {
                background: '#1a1a2e',
                foreground: '#eaeaea',
                cursor: '#f8f8f2',
            },
            scrollback: 5000,
            convertEol: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);

        // Initial fit
        setTimeout(() => fitAddon.fit(), 0);

        termRef.current = term;

        // Load historical messages from store
        const messages = getInstanceMessages(instanceId);
        const isTruncated = instanceId !== 'main' && messages.length === 10;

        if (isTruncated) {
            term.writeln('\x1b[33m[Message history truncated - showing last 10 messages]\x1b[0m\r');
            term.writeln('');
        }

        // Write historical messages
        for (const msg of messages) {
            if (!loadedMessagesRef.current.has(msg.messageId)) {
                term.write(msg.data);
                loadedMessagesRef.current.add(msg.messageId);
            }
        }

        const unsubscribe = subscribeToClaude(instanceId, (data) => {
            // Only write if we haven't seen this message ID yet
            // (prevents duplicates when switching between instances)
            if (!loadedMessagesRef.current.has(data.messageId)) {
                term.write(data.text);
                loadedMessagesRef.current.add(data.messageId);
            }
        });

        const resizeObserver = new ResizeObserver(() => {
            fitAddon.fit();
        });
        resizeObserver.observe(containerRef.current);

        return () => {
            unsubscribe();
            resizeObserver.disconnect();
            term.dispose();
        };
    }, [instanceId, subscribeToClaude, getInstanceMessages]);

    return (
        <div className="flex flex-col h-full">
            <div className="px-3 py-2 bg-gray-800 text-sm font-medium text-gray-200 border-b border-gray-700">
                {title}
            </div>
            <div ref={containerRef} className="flex-1 min-h-0" />
        </div>
    );
}
