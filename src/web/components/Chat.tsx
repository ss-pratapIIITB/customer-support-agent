import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Headphones,
  LifeBuoy,
  LoaderCircle,
  Menu,
  Package,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Ticket,
  UserRound,
  Wrench,
} from 'lucide-react';
import type { Chat as ChatType, Citation, Message, Mode, Trace, ToolCall } from '../types.js';
import { label, ms, time } from '../api.js';
import { AssistantMark } from './Brand.js';
import { Markdown } from './Markdown.js';

type Props = {
  chat: ChatType | null;
  messages: Message[];
  traces: Trace[];
  mode: Mode;
  model: string;
  pending: boolean;
  error: string;
  retry: { message: string; requestId: string } | null;
  onSend: (text: string) => void;
  onRetry: () => void;
  onDismissError: () => void;
  onFeedback: (messageId: string, rating: number) => void;
  onHandoff: () => void;
  onOpenSource: (citation: Citation) => void;
  onOpenMenu: () => void;
};

const SUGGESTIONS = [
  {
    icon: <Headphones size={18} />,
    label: 'Product detail',
    text: 'What is the battery life of AirPods Pro 3?',
  },
  {
    icon: <Sparkles size={18} />,
    label: 'Compare specs',
    text: 'Compare AirPods Pro 3 and AirPods Max 2.',
  },
  {
    icon: <Package size={18} />,
    label: 'Track an order',
    text: 'Where is my order MAX-1042?',
  },
  {
    icon: <RotateCcw size={18} />,
    label: 'Start a return',
    text: 'I want to return order MAX-1042 because I changed my mind.',
  },
];

const QUICK_ASKS = [
  'What is the Demo store return policy?',
  'How long does shipping take?',
  'I need to talk to a human.',
];

export function Chat({
  chat,
  messages,
  traces,
  mode,
  model,
  pending,
  error,
  retry,
  onSend,
  onRetry,
  onDismissError,
  onFeedback,
  onHandoff,
  onOpenSource,
  onOpenMenu,
}: Props) {
  const [input, setInput] = useState('');
  const [thanked, setThanked] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    textarea.current?.focus();
  }, [chat?.id]);

  useEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }, [input]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: messages.length > 2 ? 'smooth' : 'auto' });
  }, [messages, pending]);

  function send(text = input) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    onSend(trimmed);
    setInput('');
    requestAnimationFrame(() => textarea.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  const traceById = new Map(traces.map((trace) => [trace.trace_id, trace]));
  const activeChat = chat?.title && chat.title !== 'New conversation';

  return (
    <div className="chat-shell">
      <header className="chat-header">
        <button className="mobile-menu" aria-label="Open navigation" onClick={onOpenMenu}>
          <Menu size={20} />
        </button>
        <div className="assistant-identity">
          <AssistantMark size={19} />
          <div>
            <strong>Maxify support</strong>
            <span>
              <i className={`status-dot ${mode === 'live' ? 'live' : ''}`} />
              {mode === 'live' ? `Live · ${model}` : 'Demo engine · deterministic'}
            </span>
          </div>
        </div>
        <div className="chat-header-actions">
          <span className="grounded-pill" title="Factual answers are backed by retrieved sources">
            <ShieldCheck size={14} /> Grounded
          </span>
          <button className="handoff-button" onClick={onHandoff}>
            <LifeBuoy size={15} /> <span>Human</span>
          </button>
        </div>
      </header>

      <section className={`conversation ${messages.length ? 'has-messages' : ''}`}>
        {!messages.length ? (
          <Welcome mode={mode} onSend={send} />
        ) : (
          <div className="message-list">
            <div className="day-divider">
              <span>{activeChat ? chat?.title : 'New conversation'}</span>
            </div>
            {messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                trace={message.trace_id ? traceById.get(message.trace_id) : undefined}
                thanked={thanked === message.id}
                onFeedback={(rating) => {
                  onFeedback(message.id, rating);
                  setThanked(message.id);
                }}
                onOpenSource={onOpenSource}
              />
            ))}
            {pending ? (
              <div className="message assistant typing-row">
                <AssistantMark size={18} />
                <div className="typing">
                  <span />
                  <span />
                  <span />
                  <em>Checking sources and your account…</em>
                </div>
              </div>
            ) : null}
            <div ref={bottom} />
          </div>
        )}
      </section>

      <div className="composer-wrap">
        {error ? (
          <div className="chat-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
            <div>
              {retry ? (
                <button onClick={onRetry} disabled={pending}>
                  Retry
                </button>
              ) : null}
              <button className="quiet" onClick={onDismissError}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
        <div className={`composer ${pending ? 'is-busy' : ''}`}>
          <textarea
            ref={textarea}
            rows={1}
            value={input}
            maxLength={2000}
            placeholder="Ask about a product, an order, or a policy…"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Message Maxify support"
          />
          <button
            className="send-button"
            aria-label="Send message"
            disabled={!input.trim() || pending}
            onClick={() => send()}
          >
            {pending ? <LoaderCircle size={19} className="spin" /> : <ArrowUp size={19} />}
          </button>
        </div>
        <div className="composer-meta">
          <span>
            <kbd>Enter</kbd> send · <kbd>Shift</kbd> + <kbd>Enter</kbd> new line
          </span>
          <span>
            <BookOpen size={12} /> Answers cite official specs or labeled demo policy
          </span>
        </div>
      </div>
    </div>
  );
}

function Welcome({ mode, onSend }: { mode: Mode; onSend: (text: string) => void }) {
  return (
    <div className="welcome">
      <div className="welcome-glow" />
      <span className="welcome-mark">
        <Headphones size={30} strokeWidth={1.6} />
      </span>
      <p className="eyebrow">MAXIFY SUPPORT</p>
      <h1>
        A clearer way to
        <br />
        get help.
      </h1>
      <p className="welcome-lede">
        Ask about AirPods, iPhones, iPads, or Macs. Check an order. Start a return. Every factual
        answer is tied to a source you can open.
      </p>

      <div className="suggestion-grid">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.label}
            className="suggestion-card"
            onClick={() => onSend(suggestion.text)}
          >
            <span className="suggestion-icon">{suggestion.icon}</span>
            <span>
              <strong>{suggestion.label}</strong>
              <small>{suggestion.text}</small>
            </span>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>

      <div className="quick-asks">
        <span>Try asking</span>
        {QUICK_ASKS.map((question) => (
          <button key={question} onClick={() => onSend(question)}>
            {question}
          </button>
        ))}
      </div>

      <div className="welcome-note">
        <ShieldCheck size={15} />
        <span>
          {mode === 'live'
            ? 'Live model mode. Answers are still grounded in the active source corpus.'
            : 'Demo engine mode. No API key is required, and responses are deterministic for repeatable demos.'}
        </span>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  trace,
  thanked,
  onFeedback,
  onOpenSource,
}: {
  message: Message;
  trace?: Trace;
  thanked: boolean;
  onFeedback: (rating: number) => void;
  onOpenSource: (citation: Citation) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="message user-message">
        <div className="user-bubble">{message.content}</div>
        <span className="user-avatar">
          <UserRound size={15} />
        </span>
      </div>
    );
  }

  const citations = message.citations ?? [];
  const toolCalls = trace?.data?.agent?.toolCalls ?? trace?.data?.toolCalls ?? [];
  const behavior = message.behavior ?? trace?.data?.behavior;
  const latency = message.latency_ms ?? trace?.data?.latencyMs;

  return (
    <div className="message assistant-message">
      <AssistantMark size={18} />
      <div className="message-body">
        <div className="message-meta">
          <strong>Maxify support</strong>
          {behavior ? (
            <span className={`behavior-badge ${behavior}`}>{behaviorLabel(behavior)}</span>
          ) : null}
          <span className="message-time">{time(message.created_at)}</span>
          {latency ? <span className="message-latency">{ms(latency)}</span> : null}
        </div>

        <Markdown text={message.content} />

        {toolCalls.length ? (
          <div className="tool-call-list">
            {toolCalls.map((call, index) => (
              <ToolChip key={`${call.name}-${index}`} call={call} />
            ))}
          </div>
        ) : null}

        {citations.length ? (
          <div className="citation-list">
            <span className="citation-label">
              <BookOpen size={13} /> Sources
            </span>
            {citations.map((citation, index) => (
              <button
                key={citation.id}
                className="citation-chip"
                onClick={() => onOpenSource(citation)}
                title={citation.snippet}
              >
                <span>{index + 1}</span>
                <span>{citation.section || citation.title}</span>
                {citation.sourceType === 'demo_policy' ? <em>demo policy</em> : null}
              </button>
            ))}
          </div>
        ) : null}

        <div className="message-actions">
          {thanked ? (
            <span className="feedback-thanks">
              <Check size={13} /> Thanks for the feedback
            </span>
          ) : (
            <>
              <span>Was this helpful?</span>
              <button aria-label="Helpful" title="Helpful" onClick={() => onFeedback(5)}>
                <ThumbsUp size={14} />
              </button>
              <button aria-label="Not helpful" title="Not helpful" onClick={() => onFeedback(2)}>
                <ThumbsDown size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function behaviorLabel(behavior: string): string {
  if (behavior === 'clarify') return 'Needs detail';
  if (behavior === 'abstain') return 'No source';
  return 'Answered';
}

function ToolChip({ call }: { call: ToolCall }) {
  const config: Record<string, { icon: ReactNode; label: string }> = {
    list_my_orders: { icon: <Package size={14} />, label: 'Checked your orders' },
    get_order_status: { icon: <Package size={14} />, label: 'Verified order status' },
    start_return: {
      icon: <RotateCcw size={14} />,
      label: call.status === 'confirmation_required' ? 'Return ready to confirm' : 'Return created',
    },
    create_support_ticket: { icon: <Ticket size={14} />, label: 'Support ticket created' },
    handoff_to_human: { icon: <LifeBuoy size={14} />, label: 'Handed to a human' },
  };
  const entry = config[call.name] ?? { icon: <Wrench size={14} />, label: label(call.name) };
  const result = call.result as Record<string, unknown> | null;
  const reference =
    result && typeof result === 'object'
      ? String(result.rma ?? result.ticket_id ?? result.order_id ?? '')
      : '';
  return (
    <span className={`tool-chip ${call.status}`}>
      {entry.icon}
      <span>{entry.label}</span>
      {reference ? <code>{reference}</code> : null}
      {call.status === 'error' ? <CircleHelp size={13} /> : null}
    </span>
  );
}
