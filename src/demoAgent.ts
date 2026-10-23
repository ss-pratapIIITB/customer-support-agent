import type { AgentInput, AgentResult, Passage, ToolCall } from './contracts.js';
import { productById, type Product } from './catalog.js';
import { evaluateReturn, findOrder, listOrders } from './commerce.js';
import { createPendingAction, resolvePendingAction } from './commerce.js';
import { executeTool, type ToolContext } from './tools.js';

type Aspect = {
  id: string;
  label: string;
  question: RegExp;
  line: RegExp;
  section: RegExp;
};

const ASPECTS: Aspect[] = [
  {
    id: 'battery',
    label: 'Battery',
    question: /battery|how long.*(?:last|listen)|listening time|playback|runtime|charge.*last/i,
    line: /battery life|listening time|playback|hours?|charging case|single charge|fast.?charg|mah|watt-hour/i,
    section: /battery|power/i,
  },
  {
    id: 'noise',
    label: 'Noise control',
    question: /noise|anc|cancel|transparency|adaptive audio/i,
    line: /noise|cancel|transparen|adaptive|audio|hearing/i,
    section: /audio|noise|hearing/i,
  },
  {
    id: 'water',
    label: 'Water and dust resistance',
    question: /water|dust|resistan|ip rating/i,
    line: /water|dust|ip\d|resistan/i,
    section: /water|dust/i,
  },
  {
    id: 'charging',
    label: 'Charging',
    question: /charg|connector|usb|magsafe|qi|cable|adapter|port/i,
    line: /charg|usb|magsafe|qi|connector|cable|adapter|port/i,
    section: /charging|battery|power|connectivity/i,
  },
  {
    id: 'controls',
    label: 'Controls',
    question: /control|press|swipe|siri|tap/i,
    line: /press|swipe|control|siri|tap/i,
    section: /controls/i,
  },
  {
    id: 'display',
    label: 'Display',
    question: /display|screen|inch|nits|resolution/i,
    line: /inch|display|nits|resolution|retina|xdr|proMotion|oled/i,
    section: /display/i,
  },
  {
    id: 'camera',
    label: 'Camera',
    question: /camera|photo|video|lens|zoom/i,
    line: /camera|mp|zoom|lens|video|photo/i,
    section: /camera|video/i,
  },
  {
    id: 'chip',
    label: 'Chip',
    question: /chip|processor|cpu|gpu|neural/i,
    line: /chip|cpu|gpu|neural|core/i,
    section: /chip|processor|graphics/i,
  },
  {
    id: 'memory',
    label: 'Memory',
    question: /memory|ram|unified/i,
    line: /gb|memory|unified/i,
    section: /memory/i,
  },
  {
    id: 'storage',
    label: 'Storage',
    question: /storage|ssd|hard drive/i,
    line: /gb|tb|ssd|storage/i,
    section: /storage/i,
  },
  {
    id: 'weight',
    label: 'Weight',
    question: /weigh|weight|heavy|light/i,
    line: /weight|ounce|gram|pound|kg/i,
    section: /weight|size/i,
  },
  {
    id: 'audio',
    label: 'Audio',
    question: /audio|sound|speaker|spatial|hearing/i,
    line: /audio|sound|speaker|spatial|hearing|equalizer|eq|driver/i,
    section: /audio|hearing|speakers/i,
  },
  {
    id: 'connectivity',
    label: 'Connectivity',
    question: /connect|bluetooth|wi-?fi|5g|lte|wireless/i,
    line: /bluetooth|wi-?fi|5g|lte|ultra wideband|wireless/i,
    section: /connectivity|wireless/i,
  },
];

function cleanLine(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*\d{1,2}$/, '')
    .trim();
}

function aspectFor(question: string): Aspect | undefined {
  return ASPECTS.find((aspect) => aspect.question.test(question));
}

function isJunkLine(line: string): boolean {
  return /^(see .* in ar|see apple.*|learn more|shop now|buy now|we designed.*|apple’s commitment|product image|model \d|price|from|or|and|configurable to:?)$/i.test(
    line,
  );
}

function defaultLines(passages: Passage[], limit: number): string[] {
  const candidates: Array<{ line: string; score: number; order: number; passage: Passage }> = [];
  let order = 0;
  for (const passage of passages) {
    for (const raw of passage.content.split('\n').slice(1)) {
      const line = cleanLine(raw);
      order += 1;
      if (line.length < 10 || line.length > 220 || isJunkLine(line)) continue;
      let score = 0;
      if (
        /(\d+(\.\d+)?\s*(hours?|hrs?|minutes?|days?|mm|inches?|grams?|g|db|mah|w|gb|tb|mp|hz|ip\d\d))/i.test(
          line,
        )
      ) {
        score += 6;
      }
      if (
        /battery|listening|noise cancel|water|dust|weight|driver|chip|display|camera|storage|memory|connectivity|bluetooth|spatial/i.test(
          line,
        )
      ) {
        score += 3;
      }
      if (/\d/.test(line)) score += 2;
      if (line.length >= 25 && line.length <= 180) score += 1;
      candidates.push({ line, score, order, passage });
    }
  }

  const seen = new Set<string>();
  const chosen: typeof candidates = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score || a.order - b.order)) {
    const key = candidate.line.toLowerCase();
    if (seen.has(key)) continue;
    if (
      chosen.some(
        (entry) => entry.line.includes(candidate.line) || candidate.line.includes(entry.line),
      )
    ) {
      continue;
    }
    seen.add(key);
    chosen.push(candidate);
    if (chosen.length >= limit) break;
  }
  return chosen.sort((a, b) => a.order - b.order).map((entry) => entry.line);
}

function linesFor(passages: Passage[], aspect: Aspect | undefined, limit = 7): string[] {
  if (!aspect) return defaultLines(passages, limit);
  const lines: string[] = [];
  const selected = aspect
    ? passages.filter(
        (passage) =>
          aspect.section.test(String(passage.section ?? '')) || aspect.line.test(passage.content),
      )
    : passages;
  for (const passage of selected.length ? selected : passages) {
    const section = String(passage.section ?? '');
    const body = passage.content.split('\n').slice(1);
    const sectionMatches = aspect ? aspect.section.test(section) : false;
    for (let index = 0; index < body.length; index += 1) {
      let line = cleanLine(body[index]);
      if (!line || line.length < 4 || line.length > 260 || isJunkLine(line)) continue;
      if (/^(model \d|product image|price|from|or|and|configurable to:?)$/i.test(line)) {
        if (/^configurable to:?$/i.test(line) && body[index + 1]) {
          const next = cleanLine(body[index + 1]);
          if (next) line = `Configurable to ${next}`;
          index += 1;
        } else {
          continue;
        }
      }
      const relevant = sectionMatches || (aspect ? aspect.line.test(line) : true);
      if (!relevant) continue;
      if (lines.some((existing) => existing.toLowerCase() === line.toLowerCase())) continue;
      lines.push(line);
      if (lines.length >= limit) return lines;
    }
  }
  return lines;
}

function citeFor(passages: Passage[], limit = 2): string[] {
  return passages.slice(0, limit).map((passage) => passage.id);
}

function passageSnippet(passage: Passage | undefined, max = 320): string {
  if (!passage) return '';
  return passage.content
    .replace(/^.*?\n/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function productAnswer(
  product: Product | undefined,
  evidence: Passage[],
  question: string,
): { answer: string; citations: string[] } | null {
  const relevant = product
    ? evidence.filter((passage) => passage.product_id === product.id)
    : evidence;
  if (!relevant.length) return null;
  const aspect = aspectFor(question);
  const lines = linesFor(relevant, aspect, 7);
  if (!lines.length) {
    const passage = relevant[0];
    return {
      answer: `Here is the relevant detail from the official ${product?.title ?? passage.title} specifications:\n\n${passageSnippet(passage)} [1]`,
      citations: citeFor(relevant, 1),
    };
  }
  const heading = product ? `**${product.title}**` : `**${relevant[0].title}**`;
  const intro = aspect
    ? `From the official ${heading} specifications, here is the ${aspect.label.toLowerCase()} information:`
    : `From the official ${heading} specifications:`;
  const bullets = lines.map((line) => `- ${line}`).join('\n');
  const qualifier =
    aspect?.id === 'battery'
      ? '\n\nBattery life varies with settings, environment, and usage.'
      : '';
  const used = relevant.filter((passage) => lines.some((line) => passage.content.includes(line)));
  return {
    answer: `${intro}\n\n${bullets}${qualifier}`,
    citations: citeFor(used.length ? used : relevant, 3),
  };
}

function comparisonAnswer(
  products: Product[],
  evidence: Passage[],
  question: string,
): { answer: string; citations: string[] } | null {
  const aspect = aspectFor(question);
  const sections: string[] = [];
  const citations: string[] = [];
  for (const product of products) {
    const relevant = evidence.filter((passage) => passage.product_id === product.id);
    if (!relevant.length) continue;
    const lines = linesFor(relevant, aspect, 4);
    if (!lines.length) continue;
    sections.push(`**${product.title}**\n${lines.map((line) => `- ${line}`).join('\n')}`);
    const used = relevant.filter((passage) => lines.some((line) => passage.content.includes(line)));
    citations.push(...citeFor(used.length ? used : relevant, 2));
  }
  if (!sections.length) return null;
  const intro = aspect
    ? `Here is how the ${aspect.label.toLowerCase()} compares, from the official specifications:`
    : 'Here is a specification comparison from the official product pages:';
  return {
    answer: `${intro}\n\n${sections.join('\n\n')}\n\nValues are model-specific and may depend on configuration, settings, and usage.`,
    citations: [...new Set(citations)].slice(0, 4),
  };
}

function policyAnswer(
  evidence: Passage[],
  intent: string,
  question: string,
): { answer: string; citations: string[] } | null {
  const policy = evidence.filter((passage) => passage.source_type === 'demo_policy');
  if (!policy.length) return null;
  const wanted = intent.includes('shipping')
    ? /shipping/i
    : intent.includes('warranty')
      ? /warranty/i
      : /returns?/i;
  const ordered = [...policy].sort(
    (a, b) => Number(wanted.test(b.content)) - Number(wanted.test(a.content)),
  );
  const passage = ordered[0];
  const body = passage.content.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
  let answer = `Under the **Demo store policy** (a fictional retailer policy, not Apple’s):\n\n${body}`;
  if (/restocking|fee/i.test(question) && !/restocking|fee/i.test(body)) {
    answer +=
      '\n\nThe policy shown here does not mention a restocking fee, so I can’t confirm one. A support specialist can check the specific order.';
  }
  return { answer, citations: [passage.id] };
}

export function unsupportedAnswer(question: string): { answer: string } {
  if (/price|cost|how much|discount|coupon/i.test(question)) {
    return {
      answer:
        'I can’t see live prices, promotions, or inventory from the support sources. I can compare official specifications, and a human specialist can confirm current pricing and stock.',
    };
  }
  if (/medical|diagnos|doctor|medicine|symptom|health condition/i.test(question)) {
    return {
      answer:
        'I can’t provide medical advice or diagnose a health condition. I can share official product information, and I’d recommend speaking with a qualified healthcare professional.',
    };
  }
  return {
    answer:
      'I don’t have evidence in the current support sources to answer that. I can help with product specifications, Demo store policies, and orders placed on this account.',
  };
}

function clarifyProduct(): { answer: string; citations: string[] } {
  return {
    answer:
      'Which product are you asking about? I can help with **AirPods 5**, **AirPods Pro 3**, **AirPods Max 2**, **iPhone 17**, **iPad Air**, **iPad Pro**, **MacBook Air**, or **MacBook Pro**.',
    citations: [],
  };
}

function orderSummary(order: {
  id?: string;
  status?: string;
  items?: Array<{ name: string }>;
  total?: string;
  delivered_at?: string | null;
  tracking_number?: string | null;
  carrier?: string | null;
}): string {
  if (!order?.id) return 'Order not found.';
  const items = (order.items ?? []).map((item) => item.name).join(', ');
  const delivered = order.delivered_at
    ? new Date(order.delivered_at).toLocaleDateString('en-SG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'not delivered yet';
  const lines = [
    `Order **${order.id}** is **${String(order.status ?? 'unknown').replace(/_/g, ' ')}**.`,
    `- Items: ${items}`,
    `- Total: ${order.total ?? 'unknown'}`,
    `- Delivered: ${delivered}`,
  ];
  if (order.tracking_number)
    lines.push(`- Tracking: ${order.tracking_number} (${order.carrier ?? 'carrier'})`);
  return lines.join('\n');
}

async function orderIntent(
  input: AgentInput,
  toolContext: ToolContext,
  toolCalls: ToolCall[],
): Promise<{ answer: string; citations: string[]; behavior: AgentResult['behavior'] }> {
  const orderId = input.question.match(/\b[A-Z]{2,5}-\d{3,8}\b/i)?.[0]?.toUpperCase();
  if (orderId) {
    const call = await executeTool(toolContext, 'get_order_status', { order_id: orderId });
    toolCalls.push(call);
    const result = call.result as { error?: string } & Record<string, unknown>;
    if (result.error) {
      return {
        answer: `I couldn’t find order **${orderId}** on this account. Please check the order ID and try again.`,
        citations: [],
        behavior: 'clarify',
      };
    }
    return {
      answer: orderSummary(result as Parameters<typeof orderSummary>[0]),
      citations: [],
      behavior: 'answer',
    };
  }
  const call = await executeTool(toolContext, 'list_my_orders', {});
  toolCalls.push(call);
  const result = call.result as { orders?: Array<Record<string, unknown>> };
  const orders = result.orders ?? [];
  if (!orders.length) {
    return {
      answer:
        'I can check order status once I have an order ID such as **MAX-1042**. I don’t see any orders on this demo account yet.',
      citations: [],
      behavior: 'clarify',
    };
  }
  const summary = orders
    .slice(0, 4)
    .map(
      (order) =>
        `- **${order.id}** — ${String(order.status).replace(/_/g, ' ')} · ${
          order.items
            ? (order.items as Array<{ name: string }>).map((item) => item.name).join(', ')
            : 'order'
        }`,
    )
    .join('\n');
  return {
    answer: `I found these orders on your account:\n\n${summary}\n\nWhich order would you like to check?`,
    citations: [],
    behavior: 'clarify',
  };
}

async function returnIntent(
  input: AgentInput,
  toolContext: ToolContext,
  toolCalls: ToolCall[],
): Promise<{ answer: string; citations: string[]; behavior: AgentResult['behavior'] }> {
  const orderId = input.question.match(/\b[A-Z]{2,5}-\d{3,8}\b/i)?.[0]?.toUpperCase();
  if (!orderId) {
    const orders = await listOrders(input.userId);
    if (!orders.length) {
      return {
        answer:
          'I can start a return when you share the order ID (for example **MAX-1042**). I don’t see any orders on this demo account yet.',
        citations: [],
        behavior: 'clarify',
      };
    }
    const list = orders
      .slice(0, 4)
      .map(
        (order) =>
          `- **${order.id}** — ${order.items.map((item) => item.name).join(', ')} · ${order.status.replace(/_/g, ' ')}`,
      )
      .join('\n');
    return {
      answer: `I can help with a return. Which order is it?\n\n${list}\n\nThe Demo store returns policy accepts unopened products within 14 days of delivery.`,
      citations: [],
      behavior: 'clarify',
    };
  }

  const order = await findOrder(input.userId, orderId);
  if (!order) {
    return {
      answer: `I couldn’t find order **${orderId}** on this account. Please check the order ID.`,
      citations: [],
      behavior: 'clarify',
    };
  }
  const decision = evaluateReturn(order, input.question);
  if (!decision.eligible) {
    return {
      answer: `${decision.reason}\n\n${decision.policy}`,
      citations: [],
      behavior: 'answer',
    };
  }
  const call = await executeTool(toolContext, 'start_return', {
    order_id: order.id,
    reason: input.question,
    confirm: false,
  });
  toolCalls.push(call);
  return {
    answer: `${decision.reason}\n\n${decision.policy}\n\n${
      decision.requiresReview
        ? 'Because of the order value, I’ll create the request for human approval. Shall I proceed?'
        : 'Shall I create the return and issue an RMA?'
    }`,
    citations: [],
    behavior: 'clarify',
  };
}

async function confirmPending(
  input: AgentInput,
  toolContext: ToolContext,
  toolCalls: ToolCall[],
): Promise<{ answer: string; citations: string[]; behavior: AgentResult['behavior'] } | null> {
  const pending = input.pendingAction;
  if (!pending) return null;
  const confirming = /^(yes|yeah|yep|sure|ok(?:ay)?|please do|go ahead|confirm|do it)\b/i.test(
    input.question.trim(),
  );
  const cancelling = /^(no|nope|cancel|stop|don't|do not)\b/i.test(input.question.trim());
  if (cancelling) {
    await resolvePendingAction(pending.id, 'cancelled');
    return {
      answer: 'No problem — I’ve cancelled that request. Is there anything else I can help with?',
      citations: [],
      behavior: 'answer',
    };
  }
  if (!confirming) return null;
  if (pending.action === 'start_return') {
    const call = await executeTool(toolContext, 'start_return', {
      order_id: pending.payload.orderId,
      reason: pending.payload.reason,
      confirm: true,
    });
    toolCalls.push(call);
    await resolvePendingAction(pending.id, 'completed');
    const result = call.result as {
      rma?: string;
      order_id?: string;
      next_step?: string;
      requires_review?: boolean;
    };
    return {
      answer: `Done — return **${result.rma ?? ''}** is now open for order **${result.order_id ?? pending.payload.orderId}**.${
        result.requires_review
          ? ' It will be reviewed by a support specialist within one business day.'
          : ''
      }\n\n${result.next_step ?? ''}`,
      citations: [],
      behavior: 'answer',
    };
  }
  if (pending.action === 'create_ticket') {
    const call = await executeTool(toolContext, 'create_support_ticket', {
      subject: String(pending.payload.subject ?? 'Warranty assessment'),
      summary: String(pending.payload.summary ?? input.question),
      priority: 'normal',
    });
    toolCalls.push(call);
    await resolvePendingAction(pending.id, 'completed');
    return {
      answer:
        'Done — I’ve created a warranty assessment ticket. A support specialist will respond within two business days.',
      citations: [],
      behavior: 'answer',
    };
  }
  return null;
}

export async function demoAnswer(input: AgentInput): Promise<AgentResult> {
  const started = performance.now();
  const toolCalls: ToolCall[] = [];
  const toolContext: ToolContext = {
    userId: input.userId,
    userEmail: input.userEmail,
    chatId: input.chatId,
    requestId: input.requestId,
    traceId: input.traceId ?? null,
  };
  const make = (
    result: { answer: string; citations: string[]; behavior: AgentResult['behavior'] },
    confidence: number,
  ): AgentResult => ({
    ...result,
    intent: input.intent,
    confidence,
    model: 'demo-engine',
    provider: 'deterministic',
    costUsd: 0,
    toolCalls,
    latencyMs: Math.max(0, Math.round(performance.now() - started)),
    traceId: input.traceId ?? null,
  });

  const pendingResult = await confirmPending(input, toolContext, toolCalls);
  if (pendingResult) return make(pendingResult, 0.95);

  const q = input.question.toLowerCase();
  if (
    /ignore (all |any )?(previous|prior|above) (instructions|prompts)|system prompt|developer message|jailbreak|reveal (your|the) (instructions|prompt)/i.test(
      q,
    )
  ) {
    return make(
      {
        answer:
          'I can’t share internal instructions or change how I operate. I can still help with product specifications, Demo store policies, orders, returns, and warranty questions.',
        citations: [],
        behavior: 'abstain',
      },
      0.9,
    );
  }
  if (/^(hi|hello|hey)\b/.test(q) && q.split(/\s+/).length <= 6) {
    return make(
      {
        answer:
          'Hi — I’m the Maxify support agent. I can answer product questions from official specifications, explain Demo store policies, check your order, and start a return. What can I help with?',
        citations: [],
        behavior: 'answer',
      },
      0.95,
    );
  }
  if (/^(thanks|thank you|cheers|appreciate)\b/.test(q)) {
    return make(
      {
        answer: 'You’re welcome. I’m here if anything else comes up.',
        citations: [],
        behavior: 'answer',
      },
      0.95,
    );
  }
  if (/\b(human|person|agent|representative|live support|escalate)\b/i.test(q)) {
    const call = await executeTool(toolContext, 'handoff_to_human', {
      reason: input.question.slice(0, 500),
    });
    toolCalls.push(call);
    return make(
      {
        answer:
          'I’ve handed this to a human specialist and attached the conversation. A support agent will pick it up from here; the expected response time is within two business hours.',
        citations: [],
        behavior: 'answer',
      },
      0.9,
    );
  }

  if (input.intent === 'order_status') {
    const result = await orderIntent(input, toolContext, toolCalls);
    return make(result, result.behavior === 'answer' ? 0.92 : 0.65);
  }
  if (input.intent === 'return_request') {
    const result = await returnIntent(input, toolContext, toolCalls);
    return make(result, result.behavior === 'answer' ? 0.9 : 0.7);
  }
  if (input.intent === 'unsupported') {
    return make(
      { answer: unsupportedAnswer(input.question).answer, citations: [], behavior: 'abstain' },
      0.55,
    );
  }

  const policy = policyAnswer(input.evidence, input.intent, input.question);
  if (policy && ['policy_returns', 'policy_shipping'].includes(input.intent)) {
    return make({ ...policy, behavior: 'answer' }, 0.91);
  }
  if (input.intent === 'ambiguous_product') {
    return make({ ...clarifyProduct(), behavior: 'clarify' }, 0.5);
  }
  if (input.intent === 'policy_warranty') {
    await createPendingAction({
      chatId: input.chatId,
      userId: input.userId,
      action: 'create_ticket',
      payload: {
        subject: 'Warranty assessment',
        summary: input.question,
      },
    });
    return make(
      {
        answer: `${policy?.answer ?? ''}\n\nI can create a warranty assessment ticket with your proof of purchase, serial number, and a description of the fault. Shall I create it?`,
        citations: policy?.citations ?? [],
        behavior: 'clarify',
      },
      0.8,
    );
  }

  // Product / comparison questions.
  const productIds =
    input.evidence.length &&
    input.evidence.every((passage) => passage.source_type === 'manufacturer')
      ? [
          ...new Set(
            input.evidence.map((passage) => String(passage.product_id ?? '')).filter(Boolean),
          ),
        ]
      : [];
  const named =
    productIds.length > 0
      ? productIds
          .map((id) => productById(id))
          .filter((product): product is Product => Boolean(product))
      : [];

  if (named.length > 1 && /\b(compare|vs\.?|versus|difference|which one)\b/i.test(q)) {
    const comparison = comparisonAnswer(named, input.evidence, input.question);
    if (comparison) return make({ ...comparison, behavior: 'answer' }, 0.86);
  }

  if (named.length === 1) {
    const product = named[0];
    const answer = productAnswer(product, input.evidence, input.question);
    if (answer) return make({ ...answer, behavior: 'answer' }, 0.9);
  }

  if (!named.length && input.intent !== 'policy_returns' && input.intent !== 'policy_shipping') {
    if (input.evidence.some((passage) => passage.source_type === 'demo_policy')) {
      const answer = policyAnswer(input.evidence, input.intent, input.question);
      if (answer) return make({ ...answer, behavior: 'answer' }, 0.78);
    }
    if (
      /\b(battery|noise|water|charging|connector|display|camera|chip|memory|storage|weight|controls?)\b/i.test(
        q,
      )
    ) {
      return make({ ...clarifyProduct(), behavior: 'clarify' }, 0.45);
    }
  }

  if (questionsForProduct(input.question) && named.length === 0 && input.evidence.length > 0) {
    return make({ ...clarifyProduct(), behavior: 'clarify' }, 0.45);
  }

  if (input.intent === 'other') {
    return make(
      {
        answer:
          'I’m not sure I have a grounded answer for that. I can help with product specifications, Demo store policies, order status, returns, warranty assessments, or connect you with a human specialist.',
        citations: [],
        behavior: 'clarify',
      },
      0.45,
    );
  }

  return make(
    {
      answer: unsupportedAnswer(input.question).answer,
      citations: [],
      behavior: 'abstain',
    },
    0.4,
  );
}

function questionsForProduct(question: string): boolean {
  return /\b(battery|noise|water|charging|connector|display|camera|chip|memory|storage|weight|controls?)\b/i.test(
    question,
  );
}
