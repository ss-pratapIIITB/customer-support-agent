export type Intent =
  | 'order_status'
  | 'return_request'
  | 'policy_returns'
  | 'policy_shipping'
  | 'policy_warranty'
  | 'product_question'
  | 'product_comparison'
  | 'ambiguous_product'
  | 'human_handoff'
  | 'unsupported'
  | 'greeting'
  | 'thanks'
  | 'confirm'
  | 'cancel'
  | 'other';

const INJECTION_PATTERNS = [
  /\bignore (?:all |any )?(?:prior|previous|above) (?:instructions?|rules?|prompts?)\b/i,
  /\b(?:system|developer) (?:prompt|instruction|message)\b/i,
  /\breveal (?:your|the) (?:system|hidden|developer) (?:prompt|instructions?)\b/i,
  /\bdo anything now\b/i,
  /\bjailbreak\b/i,
  /\bpretend (?:you are|to be)\b/i,
  /\bdisregard (?:the|all|your) (?:rules?|instructions?|policy)\b/i,
  /\boverride (?:the|your) (?:rules?|instructions?)\b/i,
  /\bprint (?:your|the) (?:instructions?|prompt)\b/i,
  /\byou are now\b/i,
];

export function detectInjection(text: string): string[] {
  return INJECTION_PATTERNS.filter((pattern) => pattern.test(text)).map((p) => p.source);
}

/**
 * Removes instruction-like sentences while keeping the customer's legitimate
 * question. This lets the agent answer the real request without following the
 * injected instruction, and records what was stripped for audit.
 */
export function stripInjection(text: string): { cleaned: string; removed: string[] } {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const sentence of sentences) {
    if (detectInjection(sentence).length) removed.push(sentence.trim());
    else kept.push(sentence);
  }
  const cleaned = kept.join(' ').trim();
  return { cleaned: cleaned || text.trim(), removed };
}

const ORDER_ID = /\b[A-Z]{2,5}-\d{3,8}\b/i;

export function extractOrderId(text: string): string | null {
  return text.match(ORDER_ID)?.[0]?.toUpperCase() ?? null;
}

export function classifyIntent(text: string): Intent {
  const q = text.toLowerCase().trim();
  if (/^(yes|yeah|yep|sure|ok(?:ay)?|please do|go ahead|confirm|do it)\b/.test(q)) return 'confirm';
  if (/^(no|nope|cancel|stop|don't|do not)\b/.test(q)) return 'cancel';
  if (/\b(human|person|agent|representative|someone real|live support|escalate)\b/.test(q)) {
    return 'human_handoff';
  }
  if (/\b(thanks?|thank you|cheers|appreciate)\b/.test(q) && q.split(/\s+/).length <= 6)
    return 'thanks';
  if (
    /^(hi|hello|hey|good (?:morning|afternoon|evening))\b/.test(q) &&
    q.split(/\s+/).length <= 6
  ) {
    return 'greeting';
  }
  if (
    /\b(where is my order|order status|track(?:ing)?(?: number)?|has my order|when will (?:my|it) (?:arrive|ship)|delivery status|late|delayed|my orders|orders do i have|order history|list (?:my )?orders|what orders)\b/.test(
      q,
    ) ||
    (ORDER_ID.test(text) && !/\b(return|refund|warranty|repair)\b/.test(q))
  ) {
    return 'order_status';
  }
  if (/\b(return|refund|send (?:it|them|this) back|exchange|rma|money back)\b/.test(q)) {
    if (/\bpolicy|window|how (?:do|does|long)|what (?:is|are) the\b/.test(q))
      return 'policy_returns';
    return ORDER_ID.test(text) || /\b(my|this|the) order|item|product|something\b/.test(q)
      ? 'return_request'
      : 'policy_returns';
  }
  if (/\b(warranty|repair|faulty|broken|defect|not working|damaged)\b/.test(q)) {
    return 'policy_warranty';
  }
  if (/\b(shipping|delivery|dispatch|ship to|how long.*(?:arrive|deliver)|postage)\b/.test(q)) {
    return 'policy_shipping';
  }
  if (/\b(price|pricing|cost|stock|inventory|in stock|availability|discount|coupon)\b/.test(q)) {
    return 'unsupported';
  }
  if (/\b(diagnos|medical|doctor|medicine|symptom|health condition)\b/.test(q))
    return 'unsupported';
  if (/\b(compare|comparison|vs\.?|versus|difference between|which one|which should i)\b/.test(q)) {
    return 'product_comparison';
  }
  return 'other';
}

export function isAmbiguousProductQuestion(text: string): boolean {
  const q = text.toLowerCase();
  const asksProductFact =
    /\b(battery|noise cancel|anc|water resist|dust|charging|charger|connector|controls?|display|camera|chip|processor|memory|storage|ports?|weight|screen|speakers?|microphone|wi-?fi|bluetooth|sim|battery life)\b/.test(
      q,
    );
  return asksProductFact;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
