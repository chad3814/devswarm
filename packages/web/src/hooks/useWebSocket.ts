import { useEffect, useRef, useCallback } from 'react';
import { useStore, RoadmapItem, Spec, ClaudeInstance, Question } from '../stores/store';

type ServerMessage =
    | { type: 'state'; payload: { roadmapItems: RoadmapItem[]; specs: Spec[]; claudeInstances: ClaudeInstance[] } }
    | { type: 'roadmap_update'; item: RoadmapItem }
    | { type: 'spec_update'; spec: Spec }
    | { type: 'claude_update'; instance: ClaudeInstance }
    | { type: 'claude_output'; instanceId: string; data: string }
    | { type: 'question'; question: Question }
    | { type: 'shutdown_progress'; stage: string };

type ClientMessage =
    | { type: 'subscribe_claude'; instanceId: string }
    | { type: 'unsubscribe_claude'; instanceId: string }
    | { type: 'answer_question'; questionId: string; response: string }
    | { type: 'send_to_main'; message: string }
    | { type: 'shutdown' };

export function useWebSocket() {
    const wsRef = useRef<WebSocket | null>(null);
    const outputCallbacksRef = useRef<Map<string, (data: string) => void>>(new Map());

    const {
        setRoadmapItems,
        updateRoadmapItem,
        setSpecs,
        updateSpec,
        setClaudeInstances,
        updateClaudeInstance,
        addQuestion,
    } = useStore();

    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
        wsRef.current = ws;

        ws.onmessage = (event) => {
            const msg: ServerMessage = JSON.parse(event.data);

            switch (msg.type) {
                case 'state':
                    setRoadmapItems(msg.payload.roadmapItems);
                    setSpecs(msg.payload.specs);
                    setClaudeInstances(msg.payload.claudeInstances);
                    break;

                case 'roadmap_update':
                    updateRoadmapItem(msg.item);
                    break;

                case 'spec_update':
                    updateSpec(msg.spec);
                    break;

                case 'claude_update':
                    updateClaudeInstance(msg.instance);
                    break;

                case 'claude_output': {
                    const callback = outputCallbacksRef.current.get(msg.instanceId);
                    if (callback) {
                        callback(msg.data);
                    }
                    break;
                }

                case 'question':
                    addQuestion(msg.question);
                    break;

                case 'shutdown_progress':
                    console.log('Shutdown progress:', msg.stage);
                    break;
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        ws.onclose = () => {
            console.log('WebSocket closed');
        };

        return () => {
            ws.close();
        };
    }, [setRoadmapItems, updateRoadmapItem, setSpecs, updateSpec, setClaudeInstances, updateClaudeInstance, addQuestion]);

    const send = useCallback((msg: ClientMessage) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(msg));
        }
    }, []);

    const subscribeToClaude = useCallback(
        (instanceId: string, onData: (data: string) => void) => {
            outputCallbacksRef.current.set(instanceId, onData);
            send({ type: 'subscribe_claude', instanceId });

            return () => {
                outputCallbacksRef.current.delete(instanceId);
                send({ type: 'unsubscribe_claude', instanceId });
            };
        },
        [send]
    );

    const answerQuestion = useCallback(
        (questionId: string, response: string) => {
            send({ type: 'answer_question', questionId, response });
        },
        [send]
    );

    const sendToMain = useCallback(
        (message: string) => {
            send({ type: 'send_to_main', message });
        },
        [send]
    );

    const shutdown = useCallback(() => {
        send({ type: 'shutdown' });
    }, [send]);

    return {
        subscribeToClaude,
        answerQuestion,
        sendToMain,
        shutdown,
    };
}
