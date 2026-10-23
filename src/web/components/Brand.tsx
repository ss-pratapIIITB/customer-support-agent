import { Headphones } from 'lucide-react';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`}>
      <span className="brand-symbol" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span className="brand-word">
        maxify<span>support</span>
      </span>
    </div>
  );
}

export function AssistantMark({ size = 20 }: { size?: number }) {
  return (
    <span className="assistant-mark" aria-hidden="true">
      <Headphones size={size} strokeWidth={1.8} />
    </span>
  );
}
