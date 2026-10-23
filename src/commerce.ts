import { randomBytes, randomUUID } from 'node:crypto';
import { config } from './config.js';
import { one, query } from './db.js';

export type Order = {
  id: string;
  user_id: string;
  customer_email: string;
  status: string;
  placed_at: string;
  delivered_at: string | null;
  total_cents: number;
  currency: string;
  tracking_number: string | null;
  carrier: string | null;
  items: Array<{ name: string; quantity: number; sku?: string }>;
  opened: boolean;
  created_at: string;
};

export type ReturnDecision =
  | {
      eligible: true;
      requiresReview: boolean;
      reason: string;
      daysSinceDelivery: number;
      policy: string;
    }
  | {
      eligible: false;
      requiresReview: false;
      reason: string;
      daysSinceDelivery: number | null;
      policy: string;
    };

const RETURN_WINDOW_DAYS = 14;

export async function listOrders(userId: string): Promise<Order[]> {
  return (
    await query<Order>(`SELECT * FROM orders WHERE user_id=$1 ORDER BY placed_at DESC`, [userId])
  ).rows;
}

export async function findOrder(userId: string, orderId: string): Promise<Order | null> {
  const order = await one<Order>(`SELECT * FROM orders WHERE id=$1 AND user_id=$2`, [
    orderId.toUpperCase(),
    userId,
  ]);
  return order ?? null;
}

export function evaluateReturn(order: Order, reason: string): ReturnDecision {
  const policy =
    'Demo store policy: returns are accepted within 14 calendar days of delivery for unopened products in original packaging with proof of purchase. Opened headphones and earbuds cannot be returned for change of mind for hygiene reasons. Approved refunds return to the original payment method within 5–10 business days after inspection.';
  const faulty = /\b(faulty|broken|defect|not working|damaged|malfunction)\b/i.test(reason);
  if (order.status !== 'delivered' || !order.delivered_at) {
    return {
      eligible: false,
      requiresReview: false,
      reason: `Order ${order.id} is ${order.status.replace(/_/g, ' ')}, so the return window has not started yet.`,
      daysSinceDelivery: null,
      policy,
    };
  }
  const days = Math.floor((Date.now() - new Date(order.delivered_at).getTime()) / 86_400_000);
  if (days > RETURN_WINDOW_DAYS) {
    return {
      eligible: false,
      requiresReview: false,
      reason: `Order ${order.id} was delivered ${days} days ago, which is outside the 14-day change-of-mind window. A faulty-product assessment may still be possible.`,
      daysSinceDelivery: days,
      policy,
    };
  }
  if (order.opened && !faulty) {
    return {
      eligible: false,
      requiresReview: false,
      reason: `Order ${order.id} is marked as opened. For hygiene reasons, opened headphones and earbuds cannot be returned for change of mind. If the item is faulty, I can create a warranty assessment instead.`,
      daysSinceDelivery: days,
      policy,
    };
  }
  const requiresReview = order.total_cents > config.RETURN_AUTO_APPROVE_LIMIT_CENTS;
  return {
    eligible: true,
    requiresReview,
    reason: requiresReview
      ? `Order ${order.id} is within the return window, but its value requires a human approval before an RMA is issued.`
      : `Order ${order.id} is within the 14-day return window and can be submitted for return.`,
    daysSinceDelivery: days,
    policy,
  };
}

export async function createReturn(input: {
  order: Order;
  userId: string;
  reason: string;
}): Promise<{ id: string; rma: string; status: string }> {
  const id = randomUUID();
  const rma = `RMA-${randomBytes(3).toString('hex').toUpperCase()}`;
  await query(
    `INSERT INTO returns(id,order_id,user_id,status,reason,rma) VALUES($1,$2,$3,'requested',$4,$5)`,
    [id, input.order.id, input.userId, input.reason, rma],
  );
  return { id, rma, status: 'requested' };
}

export async function createTicket(input: {
  userId: string;
  chatId: string | null;
  subject: string;
  summary: string;
  priority?: string;
}): Promise<{ id: string; status: string }> {
  const id = randomUUID();
  await query(
    `INSERT INTO tickets(id,chat_id,user_id,subject,summary,priority) VALUES($1,$2,$3,$4,$5,$6)`,
    [id, input.chatId, input.userId, input.subject, input.summary, input.priority ?? 'normal'],
  );
  return { id, status: 'open' };
}

export type PendingActionRow = {
  id: string;
  chat_id: string;
  user_id: string;
  action: string;
  payload: Record<string, unknown>;
  status: string;
  expires_at: string;
  created_at: string;
};

export async function createPendingAction(input: {
  chatId: string;
  userId: string;
  action: string;
  payload: Record<string, unknown>;
}): Promise<PendingActionRow> {
  await query(
    `UPDATE pending_actions SET status='cancelled' WHERE chat_id=$1 AND status='pending'`,
    [input.chatId],
  );
  const id = randomUUID();
  const row = await one<PendingActionRow>(
    `INSERT INTO pending_actions(id,chat_id,user_id,action,payload,expires_at)
     VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes') RETURNING *`,
    [id, input.chatId, input.userId, input.action, JSON.stringify(input.payload)],
  );
  return row!;
}

export async function getPendingAction(chatId: string, userId: string) {
  return one<PendingActionRow>(
    `SELECT * FROM pending_actions
      WHERE chat_id=$1 AND user_id=$2 AND status='pending' AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [chatId, userId],
  );
}

export async function resolvePendingAction(id: string, status: 'completed' | 'cancelled') {
  await query(`UPDATE pending_actions SET status=$2 WHERE id=$1`, [id, status]);
}
