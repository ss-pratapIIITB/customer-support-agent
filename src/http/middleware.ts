import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { config } from '../config.js';
import { getSessionUser, sessionIdFromCookie } from '../auth.js';
import { currentTraceId } from '../telemetry.js';
import { logger } from '../logger.js';

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.header('x-request-id') || randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  const traceId = currentTraceId();
  if (traceId) res.setHeader('x-trace-id', traceId);
  next();
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'",
  );
  next();
}

export function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  const origin = req.header('origin');
  if (!origin) {
    next();
    return;
  }
  try {
    const originHost = new URL(origin).hostname;
    const allowed = new Set([
      req.hostname,
      new URL(config.APP_BASE_URL).hostname,
      'localhost',
      '127.0.0.1',
    ]);
    if (!allowed.has(originHost)) {
      res.status(403).json({ error: 'Origin is not permitted.' });
      return;
    }
  } catch {
    res.status(403).json({ error: 'Invalid origin.' });
    return;
  }
  next();
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(name: string, limit = config.RATE_LIMIT_PER_MINUTE, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${name}:${req.ip ?? 'unknown'}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    next();
  };
}

export async function loadSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionId = sessionIdFromCookie(req.headers.cookie);
  const user = await getSessionUser(sessionId);
  if (user) res.locals.user = user;
  next();
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Invalid request',
      issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  logger.error(
    { err: error, path: req.path, requestId: res.locals.requestId },
    'Unhandled request error',
  );
  res.status(500).json({
    error: 'Something went wrong on our side.',
    ...(config.isProduction
      ? {}
      : { detail: error instanceof Error ? error.message : String(error) }),
  });
}
