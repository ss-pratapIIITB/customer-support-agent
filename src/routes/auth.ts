import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { loginSchema } from '../contracts.js';
import { createSession, destroySession, sessionIdFromCookie } from '../auth.js';
import { one, query } from '../db.js';
import { rateLimit } from '../http/middleware.js';
import { logger } from '../logger.js';

export const authRouter = Router();

authRouter.post('/login', rateLimit('login', 10), async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await one<{
    id: string;
    email: string;
    role: string;
    password_hash: string;
    name: string | null;
  }>(`SELECT id,email,role,password_hash,name FROM users WHERE email=$1`, [
    email.toLowerCase().trim(),
  ]);
  const { verifyPassword } = await import('../auth.js');
  if (!user || !verifyPassword(password, user.password_hash)) {
    logger.warn({ email }, 'Failed login');
    res.status(401).json({ error: 'Email or password is incorrect.' });
    return;
  }
  const sessionId = await createSession(user.id, config.SESSION_HOURS);
  res.cookie('support_session', sessionId, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.COOKIE_SECURE,
    maxAge: config.SESSION_HOURS * 3_600_000,
    path: '/',
  });

  let chat = await one<{ id: string }>(
    `SELECT id FROM chats WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1`,
    [user.id],
  );
  if (!chat) {
    const chatId = randomUUID();
    await query(`INSERT INTO chats(id,user_id,title) VALUES($1,$2,'New conversation')`, [
      chatId,
      user.id,
    ]);
    chat = { id: chatId };
  }
  res.json({
    user: { id: user.id, email: user.email, role: user.role, name: user.name },
    chatId: chat.id,
    mode: config.liveModel ? 'live' : 'demo',
    model: config.liveModel ? config.CHAT_MODEL : 'demo-engine',
  });
});

authRouter.post('/logout', async (req, res) => {
  await destroySession(sessionIdFromCookie(req.headers.cookie));
  res.clearCookie('support_session', { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', async (_req, res) => {
  const user = res.locals.user as { id: string; email: string; role: string; name: string | null };
  const chat = await one<{ id: string }>(
    `SELECT id FROM chats WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1`,
    [user.id],
  );
  res.json({
    user,
    chatId: chat?.id ?? null,
    mode: config.liveModel ? 'live' : 'demo',
    model: config.liveModel ? config.CHAT_MODEL : 'demo-engine',
    embeddings: config.embeddings ? config.EMBEDDING_MODEL : 'lexical-only',
    otel: config.OTEL_ENABLED,
  });
});
