import { asksPolicy, asksProductFact, inferScope, type Scope } from './catalog.js';
import type { HistoryMessage, RetrievalScope } from './contracts.js';

/**
 * Resolve the retrieval scope from the current question and committed history.
 * The current question always wins. History only fills gaps for genuine
 * follow-ups, which is what makes "how do I charge them?" work without letting
 * a two-turn-old product hijack a new question.
 */
export function resolveRetrievalScope(question: string, history: HistoryMessage[]): RetrievalScope {
  const current = inferScope(question);
  if (current.product || current.productIds?.length) return current;
  if (current.sourceType === 'demo_policy') return { sourceType: 'demo_policy' };

  const previous = [...history]
    .reverse()
    .filter((message) => message.role === 'user')
    .map((message) => inferScope(message.content))
    .find((scope) => scope.product || scope.productIds?.length || scope.sourceType);

  if (!previous) return current;

  // A policy follow-up -> product detail switch (or vice versa) should not keep
  // the wrong source scope.
  if (previous.sourceType === 'demo_policy' && asksProductFact(question)) {
    return { sourceType: 'manufacturer' };
  }
  if (previous.sourceType === 'manufacturer' && asksPolicy(question)) {
    return { sourceType: 'demo_policy' };
  }

  const merged: RetrievalScope = {
    product: previous.product,
    productIds: previous.productIds,
    sourceType: previous.sourceType,
  };
  return merged;
}

export function scopeLabel(scope: Scope | RetrievalScope): string {
  if (scope.sourceType === 'demo_policy') return 'Demo store policy';
  if (scope.productIds?.length) {
    return scope.productIds.map((id) => id.replace(/-/g, ' ')).join(' vs ');
  }
  if (scope.product) return scope.product.replace(/-/g, ' ');
  return 'All sources';
}
