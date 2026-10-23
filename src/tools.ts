import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createPendingAction,
  createReturn,
  createTicket,
  evaluateReturn,
  findOrder,
  listOrders,
  resolvePendingAction,
} from './commerce.js';
import { query } from './db.js';
import { logger } from './logger.js';
import { instruments, spanAttributes, withSpan } from './telemetry.js';
import type { ToolCall } from './contracts.js';

export type ToolContext = {
  userId: string;
  userEmail: string;
  chatId: string;
  requestId: string;
  traceId: string | null;
};

export const toolDefinitions = [
  {
    type: 'function' as const,
    function: {
      name: 'list_my_orders',
      description:
        "List the signed-in customer's orders with status, items, totals, and delivery dates. Use for any order, delivery, or return question when the customer has not supplied an order ID.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_order_status',
      description:
        'Get the live status and tracking details for one of the signed-in customer’s orders. Never invent order data.',
      parameters: {
        type: 'object',
        properties: { order_id: { type: 'string', description: 'Order ID such as MAX-1042' } },
        required: ['order_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'start_return',
      description:
        'Check return eligibility and, if the customer explicitly confirms, create an RMA. This is a consequential action: only set confirm=true when the customer has just confirmed the exact order and reason.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string' },
          reason: { type: 'string', description: 'The customer’s reason for returning' },
          confirm: {
            type: 'boolean',
            description: 'True only after explicit customer confirmation',
          },
        },
        required: ['order_id', 'reason'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_support_ticket',
      description:
        'Create a support ticket for warranty assessment, account issues, or anything that needs a human. Include a concise summary.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          summary: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        },
        required: ['subject', 'summary'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'handoff_to_human',
      description:
        'Escalate the conversation to a human support agent when the customer asks for a person, the request is outside policy, or confidence is too low.',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  },
];

const argsSchema = {
  list_my_orders: z.object({}),
  get_order_status: z.object({ order_id: z.string().min(2).max(40) }),
  start_return: z.object({
    order_id: z.string().min(2).max(40),
    reason: z.string().min(2).max(500),
    confirm: z.boolean().optional().default(false),
  }),
  create_support_ticket: z.object({
    subject: z.string().min(2).max(160),
    summary: z.string().min(2).max(2000),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
  }),
  handoff_to_human: z.object({ reason: z.string().min(2).max(1000) }),
};

export async function auditToolCall(ctx: ToolContext, call: ToolCall): Promise<void> {
  await query(
    `INSERT INTO tool_calls(id,trace_id,request_id,chat_id,user_id,name,args,result,status,latency_ms)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      ctx.traceId,
      ctx.requestId,
      ctx.chatId,
      ctx.userId,
      call.name,
      JSON.stringify(call.args),
      JSON.stringify(call.result),
      call.status,
      call.latencyMs,
    ],
  ).catch((error) => logger.warn({ err: error }, 'Tool audit write failed'));
}

export async function executeTool(
  ctx: ToolContext,
  name: string,
  rawArgs: unknown,
): Promise<ToolCall> {
  const started = performance.now();
  const schema = argsSchema[name as keyof typeof argsSchema];
  if (!schema) {
    return {
      name,
      args: {},
      result: { error: `Unknown tool ${name}` },
      status: 'error',
      latencyMs: 0,
    };
  }
  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      name,
      args: (rawArgs as Record<string, unknown>) ?? {},
      result: { error: parsed.error.issues.map((issue) => issue.message).join('; ') },
      status: 'error',
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
    };
  }
  const args = parsed.data as Record<string, unknown>;

  const result = await withSpan(
    `tool.${name}`,
    spanAttributes({
      'gen_ai.tool.name': name,
      'gen_ai.tool.call_id': randomUUID(),
      'support.user_id': ctx.userId,
    }),
    async (span) => {
      try {
        const value = await runTool(ctx, name, args);
        span.setAttribute('support.tool.status', 'ok');
        return value;
      } catch (error) {
        span.recordException(error as Error);
        throw error;
      }
    },
  ).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));

  const status: ToolCall['status'] =
    result && typeof result === 'object' && 'error' in result
      ? 'error'
      : result &&
          typeof result === 'object' &&
          (result as { status?: string }).status === 'confirmation_required'
        ? 'confirmation_required'
        : 'ok';
  const call: ToolCall = {
    name,
    args,
    result,
    status,
    latencyMs: Math.max(0, Math.round(performance.now() - started)),
  };
  await auditToolCall(ctx, call);
  instruments.toolCalls.add(1, { tool: name, status });
  return call;
}

async function runTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (name === 'list_my_orders') {
    const orders = await listOrders(ctx.userId);
    return {
      count: orders.length,
      orders: orders.map((order) => ({
        id: order.id,
        status: order.status,
        items: order.items,
        total: `${order.currency} ${(order.total_cents / 100).toFixed(2)}`,
        placed_at: order.placed_at,
        delivered_at: order.delivered_at,
        tracking_number: order.tracking_number,
        carrier: order.carrier,
        opened: order.opened,
      })),
    };
  }

  if (name === 'get_order_status') {
    const order = await findOrder(ctx.userId, String(args.order_id));
    if (!order)
      return { error: 'Order not found for this account. Ask the customer to check the order ID.' };
    return {
      id: order.id,
      status: order.status,
      items: order.items,
      total: `${order.currency} ${(order.total_cents / 100).toFixed(2)}`,
      placed_at: order.placed_at,
      delivered_at: order.delivered_at,
      tracking_number: order.tracking_number,
      carrier: order.carrier,
      opened: order.opened,
    };
  }

  if (name === 'start_return') {
    const order = await findOrder(ctx.userId, String(args.order_id));
    if (!order) return { error: 'Order not found for this account.' };
    const reason = String(args.reason);
    const decision = evaluateReturn(order, reason);
    if (!decision.eligible) {
      return {
        eligible: false,
        reason: decision.reason,
        policy: decision.policy,
        days_since_delivery: decision.daysSinceDelivery,
      };
    }
    if (args.confirm !== true) {
      const pending = await createPendingAction({
        chatId: ctx.chatId,
        userId: ctx.userId,
        action: 'start_return',
        payload: { orderId: order.id, reason, requiresReview: decision.requiresReview },
      });
      return {
        status: 'confirmation_required',
        eligible: true,
        requires_review: decision.requiresReview,
        order_id: order.id,
        reason: reason,
        policy: decision.policy,
        message: decision.requiresReview
          ? `This return is eligible but needs human approval because the order is above the auto-approval limit. Ask the customer to confirm creating the request.`
          : `Ask the customer to confirm that they want to start the return for ${order.id}.`,
        pending_action_id: pending.id,
      };
    }
    const created = await createReturn({ order, userId: ctx.userId, reason });
    await resolvePendingAction(String(args.pending_action_id ?? ''), 'completed').catch(
      () => undefined,
    );
    return {
      status: 'created',
      order_id: order.id,
      rma: created.rma,
      requires_review: decision.requiresReview,
      next_step: decision.requiresReview
        ? 'A support specialist will review the return within one business day.'
        : 'Pack the item in its original packaging. A prepaid label will be emailed within one business day.',
    };
  }

  if (name === 'create_support_ticket') {
    const ticket = await createTicket({
      userId: ctx.userId,
      chatId: ctx.chatId,
      subject: String(args.subject),
      summary: String(args.summary),
      priority: args.priority as string | undefined,
    });
    return {
      status: 'created',
      ticket_id: ticket.id,
      expected_response: 'within two business days',
    };
  }

  if (name === 'handoff_to_human') {
    const reason = String(args.reason);
    const ticket = await createTicket({
      userId: ctx.userId,
      chatId: ctx.chatId,
      subject: 'Human handoff requested',
      summary: reason,
      priority: 'high',
    });
    await query(`UPDATE chats SET status='handed_off', updated_at=now() WHERE id=$1`, [ctx.chatId]);
    instruments.handoffs.add(1, { reason: 'agent_tool' });
    return {
      status: 'handed_off',
      ticket_id: ticket.id,
      message: 'A human specialist will join this conversation.',
    };
  }

  return { error: `Unsupported tool ${name}` };
}

export async function confirmPendingReturn(
  ctx: ToolContext,
  pending: { id: string; action: string; payload: Record<string, unknown> },
): Promise<ToolCall> {
  const orderId = String(pending.payload.orderId ?? '');
  const reason = String(pending.payload.reason ?? 'Customer confirmed return');
  return executeTool(ctx, 'start_return', { order_id: orderId, reason, confirm: true });
}
