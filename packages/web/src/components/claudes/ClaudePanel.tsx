import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useWebSocket } from '../../hooks/useWebSocket';
import '@xterm/xterm/css/xterm.css';

interface ClaudePanelProps {
    instanceId: string;
    title: string;
}

export function ClaudePanel({ instanceId, title }: ClaudePanelProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const { subscribeToClaude } = useWebSocket();

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

        const unsubscribe = subscribeToClaude(instanceId, (data) => {
            term.write(data.text);
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
    }, [instanceId, subscribeToClaude]);

    return (
        <div className="flex flex-col h-full">
            <div className="px-3 py-2 bg-gray-800 text-sm font-medium text-gray-200 border-b border-gray-700">
                {title}
            </div>
            <div ref={containerRef} className="flex-1 min-h-0" />
        </div>
    );
}
