import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { one, query } from './db.js';

export type SessionUser = { id: string; email: string; role: 'customer' | 'reviewer' | 'admin' };

export function hashPassword(value: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
}

export function verifyPassword(value: string, hash: string): boolean {
  const [salt, digest] = hash.split(':');
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(value, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function sessionIdFromCookie(value?: string): string | null {
  const pair = value
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('support_session='));
  return pair?.slice('support_session='.length) || null;
}

export async function getSessionUser(sessionId: string | null): Promise<SessionUser | null> {
  if (!sessionId) return null;
  const row = await one<SessionUser>(
    `SELECT u.id, u.email, u.role
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId],
  );
  return row ?? null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = res.locals.user as SessionUser | undefined;
  if (!user) {
    res.status(401).json({ error: 'Please log in to continue.' });
    return;
  }
  next();
}

export function requireReviewer(req: Request, res: Response, next: NextFunction): void {
  const user = res.locals.user as SessionUser | undefined;
  if (!user || !['reviewer', 'admin'].includes(user.role)) {
    res.status(403).json({ error: 'Reviewer access required.' });
    return;
  }
  next();
}

export function requireEvalToken(req: Request, res: Response, next: NextFunction): void {
  const token = req.header('x-eval-token');
  const expected = config.EVAL_API_TOKEN;
  if (!expected || !token) {
    res.status(401).json({ error: 'Evaluation token required.' });
    return;
  }
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Invalid evaluation token.' });
    return;
  }
  next();
}

export async function createSession(userId: string, hours: number): Promise<string> {
  const id = randomBytes(32).toString('hex');
  await query(
    `INSERT INTO auth_sessions(id, user_id, expires_at) VALUES($1,$2,now()+($3 || ' hours')::interval)`,
    [id, userId, String(hours)],
  );
  return id;
}

export async function destroySession(sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  await query('DELETE FROM auth_sessions WHERE id=$1', [sessionId]);
}
