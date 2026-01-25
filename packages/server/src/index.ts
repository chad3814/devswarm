import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { initDb } from './db/index.js';
import { registerRoutes } from './routes/index.js';
import { GitManager } from './git/index.js';
import { Orchestrator } from './orchestrator/index.js';
import { WebSocketHub } from './routes/ws.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
    const app = Fastify({ logger: true });

    await app.register(cors, { origin: true });
    await app.register(websocket);

    // Serve React frontend
    await app.register(fastifyStatic, {
        root: path.join(__dirname, '../../web/dist'),
        prefix: '/',
    });

    // Initialize core services
    const db = initDb(config.dbPath);
    const git = new GitManager(config.bareRepoPath, config.worktreesPath);
    const wsHub = new WebSocketHub();

    // Dependency injection via decorators
    app.decorate('db', db);
    app.decorate('git', git);
    app.decorate('wsHub', wsHub);

    // Create orchestrator (but don't start yet)
    const orchestrator = new Orchestrator(db, git, wsHub);
    app.decorate('orchestrator', orchestrator);

    // Register routes
    await registerRoutes(app);

    // Start server
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`Server listening on port ${config.port}`);

    // Initialize repo if already authenticated, then start orchestrator
    setImmediate(async () => {
        try {
            if (git.isInitialized()) {
                console.log('Repository already initialized, starting orchestrator...');
                await orchestrator.start();
            } else {
                console.log('Waiting for authentication before initializing repository...');
            }
        } catch (e) {
            console.error('Error during startup:', e);
        }
    });

    // Handle shutdown signals
    const shutdown = async () => {
        console.log('Shutting down...');
        await orchestrator.stop();
        db.close();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
