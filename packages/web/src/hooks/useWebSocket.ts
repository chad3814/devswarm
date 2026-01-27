import { useEffect, useRef, useCallback } from 'react';
import { useStore, RoadmapItem, Spec, ClaudeInstance, Question, ClaudeMessage, TaskGroup, Task } from '../stores/store';

type ServerMessage =
    | { type: 'state'; payload: { roadmapItems: RoadmapItem[]; specs: Spec[]; claudeInstances: ClaudeInstance[]; taskGroupsBySpec?: Record<string, TaskGroup[]> } }
    | { type: 'roadmap_update'; item: RoadmapItem }
    | { type: 'spec_update'; spec: Spec }
    | { type: 'claude_update'; instance: ClaudeInstance }
    | { type: 'claude_output'; instanceId: string; role: string; worktree: string | null; data: string; messageType: 'new' | 'continue'; messageId: string; timestamp: number }
    | { type: 'question'; question: Question }
    | { type: 'task_group_update'; taskGroup: TaskGroup }
    | { type: 'task_update'; task: Task }
    | { type: 'shutdown_progress'; stage: string };

type ClientMessage =
    | { type: 'subscribe_claude'; instanceId: string }
    | { type: 'unsubscribe_claude'; instanceId: string }
    | { type: 'answer_question'; questionId: string; response: string }
    | { type: 'send_to_main'; message: string }
    | { type: 'shutdown' };

export interface ClaudeOutputData {
    text: string;
    messageType: 'new' | 'continue';
    messageId: string;
}

export function useWebSocket() {
    const wsRef = useRef<WebSocket | null>(null);
    const outputCallbacksRef = useRef<Map<string, (data: ClaudeOutputData) => void>>(new Map());
    const pendingMessagesRef = useRef<ClientMessage[]>([]);

    const {
        setRoadmapItems,
        updateRoadmapItem,
        setSpecs,
        updateSpec,
        setClaudeInstances,
        updateClaudeInstance,
        addQuestion,
        addClaudeMessage,
        updateTaskGroup,
        updateTask,
    } = useStore();

    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('[WS] WebSocket opened');
            // Flush any pending messages
            console.log(`[WS] Flushing ${pendingMessagesRef.current.length} pending messages`);
            for (const msg of pendingMessagesRef.current) {
                console.log('[WS] Sending queued message:', msg);
                ws.send(JSON.stringify(msg));
            }
            pendingMessagesRef.current = [];
        };

        ws.onmessage = (event) => {
            const msg: ServerMessage = JSON.parse(event.data);

            switch (msg.type) {
                case 'state':
                    setRoadmapItems(msg.payload.roadmapItems);
                    // Merge task groups into specs if provided
                    if (msg.payload.taskGroupsBySpec) {
                        const specsWithTaskGroups = msg.payload.specs.map(spec => ({
                            ...spec,
                            taskGroups: msg.payload.taskGroupsBySpec?.[spec.id] || spec.taskGroups
                        }));
                        setSpecs(specsWithTaskGroups);
                    } else {
                        setSpecs(msg.payload.specs);
                    }
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
                    console.log(`[WS] Received claude_output for ${msg.instanceId} (${msg.data.length} chars, type: ${msg.messageType}, id: ${msg.messageId})`);

                    // Store message in Zustand store
                    const claudeMessage: ClaudeMessage = {
                        instanceId: msg.instanceId,
                        role: msg.role,
                        worktree: msg.worktree,
                        data: msg.data,
                        messageType: msg.messageType,
                        messageId: msg.messageId,
                        timestamp: msg.timestamp,
                    };
                    addClaudeMessage(claudeMessage);

                    // Also invoke callback if one is registered (for backwards compatibility)
                    const callback = outputCallbacksRef.current.get(msg.instanceId);
                    if (callback) {
                        console.log('[WS] Found callback, invoking');
                        callback({
                            text: msg.data,
                            messageType: msg.messageType,
                            messageId: msg.messageId,
                        });
                    } else {
                        console.log('[WS] No callback registered for this instance');
                    }
                    break;
                }

                case 'question':
                    addQuestion(msg.question);
                    break;

                case 'task_group_update':
                    updateTaskGroup(msg.taskGroup);
                    break;

                case 'task_update':
                    updateTask(msg.task);
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
    }, [setRoadmapItems, updateRoadmapItem, setSpecs, updateSpec, setClaudeInstances, updateClaudeInstance, addQuestion, addClaudeMessage, updateTaskGroup, updateTask]);

    const send = useCallback((msg: ClientMessage) => {
        const state = wsRef.current?.readyState;
        console.log(`[WS] send() called, readyState=${state}, msg=`, msg);
        if (state === WebSocket.OPEN) {
            console.log('[WS] Sending immediately');
            wsRef.current!.send(JSON.stringify(msg));
        } else {
            // Queue message to send when socket opens
            console.log('[WS] Queueing message (socket not open)');
            pendingMessagesRef.current.push(msg);
        }
    }, []);

    const subscribeToClaude = useCallback(
        (instanceId: string, onData: (data: ClaudeOutputData) => void) => {
            console.log(`[WS] subscribeToClaude called for: ${instanceId}`);
            outputCallbacksRef.current.set(instanceId, onData);
            send({ type: 'subscribe_claude', instanceId });

            return () => {
                console.log(`[WS] unsubscribing from: ${instanceId}`);
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
