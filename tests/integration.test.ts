import assert from 'node:assert/strict';
import test from 'node:test';

const baseUrl = (process.env.MAXIFY_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const token = process.env.EVAL_API_TOKEN ?? 'local-eval-token-change-me';
const maybe = process.env.INTEGRATION === '1' ? test : test.skip;

maybe('health endpoint reports a ready demo application', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    status: string;
    mode: string;
    ingestion: { ready: boolean };
  };
  assert.equal(body.status, 'ready');
  assert.equal(body.mode, 'demo');
  assert.equal(body.ingestion.ready, true);
});

maybe('customer login and internal evaluation metadata work', async () => {
  const login = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@maxify.demo', password: 'Demo123!' }),
  });
  assert.equal(login.status, 200);
  const body = (await login.json()) as { user: { role: string } };
  assert.equal(body.user.role, 'customer');

  const meta = await fetch(`${baseUrl}/api/internal/eval/meta`, {
    headers: { 'x-eval-token': token },
  });
  assert.equal(meta.status, 200);
  const data = (await meta.json()) as { mode: string; demoUserId: string | null; chunks: number };
  assert.equal(data.mode, 'demo');
  assert.ok(data.demoUserId);
  assert.ok(data.chunks > 0);
});

maybe('internal evaluation answer is grounded and cites evidence', async () => {
  const metaResponse = await fetch(`${baseUrl}/api/internal/eval/meta`, {
    headers: { 'x-eval-token': token },
  });
  const meta = (await metaResponse.json()) as { demoUserId: string };
  const response = await fetch(`${baseUrl}/api/internal/eval/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-eval-token': token },
    body: JSON.stringify({
      question: 'What is the battery life of AirPods Pro 3?',
      userId: meta.demoUserId,
      category: 'integration',
      runId: 'integration-test',
      caseId: 'integration-battery',
    }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    answer: string;
    behavior: string;
    citationObjects: Array<{ id: string }>;
  };
  assert.equal(body.behavior, 'answer');
  assert.match(body.answer, /hours/i);
  assert.ok(body.citationObjects.length > 0);
});

maybe('internal endpoints reject an invalid token', async () => {
  const response = await fetch(`${baseUrl}/api/internal/eval/meta`, {
    headers: { 'x-eval-token': 'wrong-token-value' },
  });
  assert.equal(response.status, 401);
});
