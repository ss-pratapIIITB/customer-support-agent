import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { authRouter } from './routes/auth.js';
import { chatRouter } from './routes/chat.js';
import { adminRouter } from './routes/admin.js';
import { internalRouter } from './routes/internal.js';
import { getIngestionStatus } from './ingest.js';
import { query } from './db.js';
import { requireReviewer } from './auth.js';
import {
  errorHandler,
  loadSession,
  originGuard,
  rateLimit,
  requestContext,
  securityHeaders,
} from './http/middleware.js';
import { version } from './version.js';

function authGate(req: Request, res: Response, next: NextFunction): void {
  if (['/health', '/login'].includes(req.path)) {
    next();
    return;
  }
  if (!res.locals.user) {
    res.status(401).json({ error: 'Please log in to continue.' });
    return;
  }
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestContext);
  app.use(securityHeaders);
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, error) =>
        error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(originGuard);

  // Token-authenticated internal endpoints are mounted before browser session auth.
  app.use('/api/internal', rateLimit('internal', 300), internalRouter);

  app.get('/api/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      const ingestion = await getIngestionStatus();
      res.status(ingestion.ready ? 200 : 503).json({
        status: ingestion.ready ? 'ready' : 'degraded',
        version,
        mode: config.liveModel ? 'live' : 'demo',
        model: config.liveModel ? config.CHAT_MODEL : 'demo-engine',
        embeddings: config.embeddings ? config.EMBEDDING_MODEL : 'lexical-only',
        otel: config.OTEL_ENABLED,
        ingestion,
        uptimeSec: Math.round(process.uptime()),
        time: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({
        status: 'unavailable',
        error: error instanceof Error ? error.message : 'Database unavailable',
      });
    }
  });

  app.use(loadSession);
  app.use('/api', authRouter);
  app.use('/api', authGate);
  app.use('/api', rateLimit('api', config.RATE_LIMIT_PER_MINUTE * 3), chatRouter);
  app.use('/api/admin', requireReviewer, adminRouter);

  const dist = path.resolve(process.cwd(), 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) => {
      res
        .type('text/plain')
        .send(
          'Maxify API is running. Start the Vite dev server with `npm run dev` or build with `npm run build`.',
        );
    });
  }

  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(errorHandler);
  return app;
}
