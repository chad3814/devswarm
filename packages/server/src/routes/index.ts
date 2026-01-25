import { FastifyInstance, FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import { GitHubAuth } from '../github/auth.js';
import { WebSocketHub } from './ws.js';
import { Db } from '../db/index.js';
import { GitManager } from '../git/index.js';
import { Orchestrator } from '../orchestrator/index.js';
import { config } from '../config.js';

// Extend FastifyInstance with our decorators
declare module 'fastify' {
    interface FastifyInstance {
        db: Db;
        git: GitManager;
        wsHub: WebSocketHub;
        orchestrator: Orchestrator;
    }
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
    const ghAuth = new GitHubAuth();

    // Health check
    app.get('/health', async () => {
        return { status: 'ok' };
    });

    // Auth routes
    app.get('/api/auth/status', async () => {
        const ghAuthed = await ghAuth.isAuthenticated();
        // TODO: Check claude auth status
        const claudeAuthed = true; // Assume authed for now

        return {
            github: ghAuthed,
            claude: claudeAuthed,
            ready: ghAuthed && claudeAuthed,
        };
    });

    app.post('/api/auth/github/start', async () => {
        return ghAuth.startDeviceFlow();
    });

    app.post('/api/auth/github/poll', async () => {
        return ghAuth.pollForToken();
    });

    app.post('/api/auth/complete', async () => {
        const { git, orchestrator } = app;

        if (!git.isInitialized()) {
            await git.init(config.repoUrl);
        }

        await orchestrator.start();

        return { success: true };
    });

    // Roadmap routes
    app.get('/api/roadmap', async () => {
        return app.db.getRoadmapItems();
    });

    app.post('/api/roadmap', async (request: FastifyRequest<{ Body: { title: string; description: string } }>) => {
        const { title, description } = request.body;

        const item = app.db.createRoadmapItem({
            github_issue_id: null,
            github_issue_url: null,
            title,
            description,
            status: 'pending',
            spec_id: null,
        });

        app.wsHub.broadcastRoadmapUpdate(item);

        return item;
    });

    app.patch('/api/roadmap/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: Partial<{ title: string; description: string; status: string }> }>) => {
        const { id } = request.params;
        const updates = request.body;

        app.db.updateRoadmapItem(id, updates);
        const item = app.db.getRoadmapItem(id);

        app.wsHub.broadcastRoadmapUpdate(item!);

        return item;
    });

    // Specs routes
    app.get('/api/specs', async () => {
        return app.db.getSpecs();
    });

    app.get('/api/specs/:id', async (request: FastifyRequest<{ Params: { id: string } }>) => {
        const spec = app.db.getSpec(request.params.id);
        if (!spec) {
            throw { statusCode: 404, message: 'Spec not found' };
        }

        const taskGroups = app.db.getTaskGroupsForSpec(spec.id);
        const taskGroupsWithTasks = taskGroups.map((tg) => ({
            ...tg,
            tasks: app.db.getTasksForGroup(tg.id),
        }));

        return {
            ...spec,
            taskGroups: taskGroupsWithTasks,
        };
    });

    // Claude instances routes
    app.get('/api/claudes', async () => {
        return app.db.getClaudeInstances({ status: 'running' });
    });

    // Questions routes
    app.get('/api/questions/pending', async () => {
        return app.db.getPendingQuestions();
    });

    app.post('/api/questions/:id/answer', async (request: FastifyRequest<{ Params: { id: string }; Body: { response: string } }>) => {
        const { id } = request.params;
        const { response } = request.body;

        await app.orchestrator.answerQuestion(id, response);

        return { success: true };
    });

    // Send message to main claude
    app.post('/api/main/message', async (request: FastifyRequest<{ Body: { message: string } }>) => {
        const { message } = request.body;

        await app.orchestrator.sendToMain(message);

        return { success: true };
    });

    // Shutdown
    app.post('/shutdown', async () => {
        app.wsHub.broadcastShutdownProgress('stopping_orchestrator');
        await app.orchestrator.stop();

        app.wsHub.broadcastShutdownProgress('closing_database');
        app.db.close();

        app.wsHub.broadcastShutdownProgress('complete');

        // Give clients time to receive the message
        setTimeout(() => {
            process.exit(0);
        }, 1000);

        return { success: true };
    });

    // WebSocket handler
    app.get('/ws', { websocket: true }, (socket: WebSocket) => {
        const client = app.wsHub.addClient(socket);

        // Send initial state
        app.wsHub.broadcastState(app.db);

        socket.on('message', async (rawData: Buffer) => {
            try {
                const message = JSON.parse(rawData.toString());
                console.log(`[WS] Received message: ${message.type}`, message);

                switch (message.type) {
                    case 'subscribe_claude':
                        app.wsHub.subscribeToClaudeOutput(client, message.instanceId);
                        break;

                    case 'unsubscribe_claude':
                        app.wsHub.unsubscribeFromClaudeOutput(client, message.instanceId);
                        break;

                    case 'answer_question':
                        await app.orchestrator.answerQuestion(message.questionId, message.response);
                        break;

                    case 'send_to_main':
                        await app.orchestrator.sendToMain(message.message);
                        break;

                    case 'shutdown':
                        app.wsHub.broadcastShutdownProgress('stopping_orchestrator');
                        await app.orchestrator.stop();
                        app.wsHub.broadcastShutdownProgress('closing_database');
                        app.db.close();
                        app.wsHub.broadcastShutdownProgress('complete');
                        setTimeout(() => process.exit(0), 1000);
                        break;
                }
            } catch (e) {
                console.error('WebSocket message error:', e);
            }
        });

        socket.on('close', () => {
            app.wsHub.removeClient(client);
        });
    });
}
