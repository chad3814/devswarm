import { WebSocket } from 'ws';
import { Db, UserQuestion } from '../db/index.js';

interface Client {
    ws: WebSocket;
    subscribedClaudes: Set<string>;
}

export class WebSocketHub {
    private clients = new Set<Client>();

    addClient(ws: WebSocket): Client {
        const client: Client = {
            ws,
            subscribedClaudes: new Set(),
        };
        this.clients.add(client);
        return client;
    }

    removeClient(client: Client): void {
        this.clients.delete(client);
    }

    broadcast(message: object): void {
        const data = JSON.stringify(message);
        for (const client of this.clients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(data);
            }
        }
    }

    broadcastState(db: Db): void {
        const roadmapItems = db.getRoadmapItems();
        const specs = db.getSpecs();
        const claudeInstances = db.getClaudeInstances({ status: 'running' });

        this.broadcast({
            type: 'state',
            payload: {
                roadmapItems,
                specs,
                claudeInstances,
            },
        });
    }

    broadcastClaudeOutput(instanceId: string, data: string | { text: string; messageType: string; messageId: string }): void {
        // Support both legacy string format and new metadata format
        const payload = typeof data === 'string'
            ? {
                type: 'claude_output',
                instanceId,
                data,
                messageType: 'continue', // Default for backwards compatibility
                messageId: `legacy-${Date.now()}`,
              }
            : {
                type: 'claude_output',
                instanceId,
                data: data.text,
                messageType: data.messageType,
                messageId: data.messageId,
              };

        const message = JSON.stringify(payload);

        let sentCount = 0;
        for (const client of this.clients) {
            console.log(`[WS] Client subscribed to: [${Array.from(client.subscribedClaudes).join(', ')}], looking for: ${instanceId}`);
            if (client.subscribedClaudes.has(instanceId) && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(message);
                sentCount++;
            }
        }
        console.log(`[WS] broadcastClaudeOutput(${instanceId}): sent to ${sentCount}/${this.clients.size} clients`);
    }

    broadcastQuestion(question: UserQuestion): void {
        this.broadcast({
            type: 'question',
            question,
        });
    }

    broadcastRoadmapUpdate(item: object): void {
        this.broadcast({
            type: 'roadmap_update',
            item,
        });
    }

    broadcastSpecUpdate(spec: object): void {
        this.broadcast({
            type: 'spec_update',
            spec,
        });
    }

    broadcastClaudeUpdate(instance: object): void {
        this.broadcast({
            type: 'claude_update',
            instance,
        });
    }

    broadcastShutdownProgress(stage: string): void {
        this.broadcast({
            type: 'shutdown_progress',
            stage,
        });
    }

    subscribeToClaudeOutput(client: Client, instanceId: string): void {
        console.log(`[WS] Client subscribing to claude: ${instanceId}`);
        client.subscribedClaudes.add(instanceId);
    }

    unsubscribeFromClaudeOutput(client: Client, instanceId: string): void {
        console.log(`[WS] Client unsubscribing from claude: ${instanceId}`);
        client.subscribedClaudes.delete(instanceId);
    }
}
