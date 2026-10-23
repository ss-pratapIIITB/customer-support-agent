import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  DollarSign,
  ExternalLink,
  FileText,
  FlaskConical,
  Gauge,
  LoaderCircle,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { api, label, money, ms, percent, relative, time } from '../api.js';
import type { Citation, Message, Trace } from '../types.js';
import { Donut, IntentBars, TrendChart, type TrendPoint } from './Charts.js';
import { Markdown } from './Markdown.js';
import { TraceWaterfall } from './TraceWaterfall.js';

type Tab = 'overview' | 'conversations' | 'evals' | 'traces' | 'knowledge';
type Any = Record<string, any>;

type ConversationDetail = {
  chat: Any;
  messages: Array<Message & { feedback_reason?: string | null }>;
  traces: Trace[];
  toolCalls: Any[];
  tickets: Any[];
  returns: Any[];
  pendingActions: Any[];
};

const TABS: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <Gauge size={15} /> },
  { id: 'conversations', label: 'Conversations', icon: <MessageSquare size={15} /> },
  { id: 'evals', label: 'Evaluations', icon: <FlaskConical size={15} /> },
  { id: 'traces', label: 'Traces', icon: <Activity size={15} /> },
  { id: 'knowledge', label: 'Knowledge', icon: <Database size={15} /> },
];

const INTENT_COLORS = ['#276f70', '#4e9490', '#d29a62', '#8ab3ae', '#b8654f', '#9fb8b2'];

export function Reviewer() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Any | null>(null);
  const [conversations, setConversations] = useState<Any[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationDetail | null>(null);
  const [evals, setEvals] = useState<Any[]>([]);
  const [selectedEval, setSelectedEval] = useState<Any | null>(null);
  const [traces, setTraces] = useState<Any[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<Any | null>(null);
  const [sources, setSources] = useState<Any[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');

  async function loadOverview() {
    try {
      const data = await api<Any>('/api/admin/overview');
      setOverview(data);
      setSources(data.sources ?? []);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function loadConversations(term = search) {
    try {
      const data = await api<Any>(
        `/api/admin/conversations${term ? `?search=${encodeURIComponent(term)}` : ''}`,
      );
      setConversations(data.conversations ?? []);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function loadEvals() {
    try {
      const data = await api<Any>('/api/admin/evals');
      const runs = data.runs ?? [];
      setEvals(runs);
      setSelectedEval((current) => {
        if (!current) return runs[0] ?? null;
        return runs.find((run: Any) => run.id === current.id) ?? runs[0] ?? null;
      });
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function loadTraces() {
    try {
      const data = await api<Any>('/api/admin/traces');
      setTraces(data.traces ?? []);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function loadKnowledge() {
    try {
      const data = await api<Any>('/api/admin/sources');
      setSources(data.sources ?? []);
      setOverview((current) => ({ ...(current ?? {}), ingestion: data.ingestion }));
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    if (tab === 'conversations') void loadConversations();
    if (tab === 'evals') void loadEvals();
    if (tab === 'traces') void loadTraces();
    if (tab === 'knowledge') void loadKnowledge();
  }, [tab]);

  useEffect(() => {
    if (tab !== 'overview') return;
    const timer = window.setInterval(() => void loadOverview(), 20_000);
    return () => window.clearInterval(timer);
  }, [tab]);

  useEffect(() => {
    if (tab !== 'evals') return;
    const timer = window.setInterval(() => void loadEvals(), 5_000);
    return () => window.clearInterval(timer);
  }, [tab]);

  async function openConversation(id: string) {
    setBusy('conversation');
    try {
      const data = await api<ConversationDetail>(`/api/admin/conversations/${id}`);
      setSelectedConversation(data);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  async function openTrace(id: string) {
    setBusy('trace');
    setTab('traces');
    try {
      const data = await api<Any>(`/api/admin/traces/${id}`);
      setSelectedTrace(data);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  async function runEval() {
    setBusy('eval');
    setNotice('');
    try {
      const data = await api<Any>('/api/admin/evals/run', { method: 'POST' });
      setNotice(
        `Evaluation ${String(data.runId).slice(0, 8)} is running. Results import automatically.`,
      );
      await loadEvals();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  async function runIngestion() {
    setBusy('ingest');
    try {
      const data = await api<Any>('/api/admin/ingest', { method: 'POST' });
      setNotice(
        data.summary?.unchanged
          ? 'Corpus is already current. No chunks were rewritten.'
          : `Activated ${data.summary?.chunks ?? 0} chunks from ${data.summary?.sources ?? 0} sources.`,
      );
      await Promise.all([loadKnowledge(), loadOverview()]);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  const analytics = overview?.analytics;
  const system = overview?.system;

  return (
    <div className="reviewer">
      <header className="review-heading">
        <div>
          <p className="eyebrow">REVIEWER CONSOLE</p>
          <h1>See what is behind every answer.</h1>
          <p>Quality, conversations, traces, and the source corpus in one operating view.</p>
        </div>
        <div className="review-heading-actions">
          {system ? (
            <span className={`mode-badge ${system.mode}`}>
              <i /> {system.mode === 'live' ? 'Live model' : 'Demo engine'}
            </span>
          ) : null}
          <button
            className="button secondary"
            onClick={() => {
              void loadOverview();
              if (tab === 'conversations') void loadConversations();
              if (tab === 'evals') void loadEvals();
              if (tab === 'traces') void loadTraces();
              if (tab === 'knowledge') void loadKnowledge();
            }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </header>

      <nav className="review-tabs" aria-label="Reviewer sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={tab === entry.id ? 'active' : ''}
            onClick={() => {
              setTab(entry.id);
              setError('');
              setNotice('');
            }}
          >
            {entry.icon}
            {entry.label}
            {entry.id === 'evals' && evals.some((run) => run.status === 'running') ? (
              <span className="tab-pulse" />
            ) : null}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="review-notice error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="review-notice">
          <CheckCircle2 size={16} />
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      ) : null}

      {tab === 'overview' ? (
        !overview ? (
          <Loading label="Loading the operating view" />
        ) : (
          <Overview
            data={overview}
            analytics={analytics}
            system={system}
            onOpenEval={(run) => {
              setSelectedEval(run);
              setTab('evals');
            }}
            onOpenTrace={(id) => void openTrace(id)}
            onGoToEvals={() => setTab('evals')}
          />
        )
      ) : null}

      {tab === 'conversations' ? (
        <div className="review-split">
          <section className="panel list-panel">
            <div className="panel-heading">
              <div>
                <h3>Conversations</h3>
                <p>Every customer turn, linked to its trace.</p>
              </div>
              <span className="count-pill">{conversations.length}</span>
            </div>
            <form
              className="search-row"
              onSubmit={(event) => {
                event.preventDefault();
                void loadConversations();
              }}
            >
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by title or customer email"
                aria-label="Search conversations"
              />
              <button type="submit">Search</button>
            </form>
            <div className="conversation-list">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`conversation-row ${
                    selectedConversation?.chat?.id === conversation.id ? 'selected' : ''
                  }`}
                  onClick={() => void openConversation(conversation.id)}
                >
                  <span className="conversation-icon">
                    <MessageSquare size={15} />
                  </span>
                  <span className="conversation-copy">
                    <strong>{conversation.title || 'Untitled conversation'}</strong>
                    <small>
                      {conversation.email} · {conversation.message_count ?? 0} messages
                    </small>
                  </span>
                  <span className="conversation-meta">
                    <em className={`status-badge ${conversation.status}`}>
                      {label(conversation.status)}
                    </em>
                    <small>{relative(conversation.updated_at)}</small>
                  </span>
                  {conversation.negative_feedback ? (
                    <span className="feedback-flag" title="Negative feedback">
                      !
                    </span>
                  ) : null}
                  <ChevronRight size={15} />
                </button>
              ))}
              {!conversations.length ? (
                <Empty
                  icon={<MessageSquare size={22} />}
                  title="No conversations match"
                  text="Try a different search term or start a conversation from the customer workspace."
                />
              ) : null}
            </div>
          </section>

          <section className="panel detail-panel">
            {busy === 'conversation' ? <Loading label="Loading transcript" /> : null}
            {!busy && !selectedConversation ? (
              <Empty
                icon={<BookOpen size={22} />}
                title="Select a conversation"
                text="Open a transcript to inspect answers, tool calls, tickets, and the trace behind each turn."
              />
            ) : null}
            {selectedConversation ? (
              <ConversationDetailView
                detail={selectedConversation}
                onOpenTrace={(id) => void openTrace(id)}
              />
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === 'evals' ? (
        <div className="review-split eval-split">
          <section className="panel list-panel">
            <div className="panel-heading">
              <div>
                <h3>Evaluation runs</h3>
                <p>Deterministic graders, optional LLM judge.</p>
              </div>
              <button
                className="button primary compact"
                disabled={busy === 'eval' || evals.some((run) => run.status === 'running')}
                onClick={() => void runEval()}
              >
                {busy === 'eval' ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}
                Run evals
              </button>
            </div>
            <div className="eval-run-list">
              {evals.map((run) => (
                <EvalRunRow
                  key={run.id}
                  run={run}
                  selected={selectedEval?.id === run.id}
                  onClick={() => setSelectedEval(run)}
                />
              ))}
              {!evals.length ? (
                <Empty
                  icon={<FlaskConical size={22} />}
                  title="No evaluation runs"
                  text="Run the Python harness to measure answer quality, citations, safety, and tool behavior."
                />
              ) : null}
            </div>
          </section>
          <section className="panel detail-panel">
            {selectedEval ? (
              <EvalDetail run={selectedEval} />
            ) : (
              <Loading label="Loading evaluations" />
            )}
          </section>
        </div>
      ) : null}

      {tab === 'traces' ? (
        <div className="review-split trace-split">
          <section className="panel list-panel">
            <div className="panel-heading">
              <div>
                <h3>Recent traces</h3>
                <p>Retrieval, model, tool, and latency data.</p>
              </div>
              <span className="count-pill">{traces.length}</span>
            </div>
            <div className="trace-list">
              {traces.map((trace) => (
                <button
                  key={trace.id}
                  className={`trace-row ${selectedTrace?.trace?.id === trace.id ? 'selected' : ''}`}
                  onClick={() => void openTrace(trace.id)}
                >
                  <span className={`trace-status ${trace.summary?.status ?? ''}`}>
                    {trace.summary?.status === 'failed' ? (
                      <XCircle size={14} />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                  </span>
                  <span className="trace-copy">
                    <strong>{prettyIntent(trace.summary?.intent ?? 'unknown')}</strong>
                    <small>
                      {trace.email ?? 'system'} · {time(trace.created_at)}
                    </small>
                  </span>
                  <span className="trace-meta">
                    <small>{ms(trace.summary?.latencyMs)}</small>
                    <small>{trace.summary?.toolCalls ?? 0} tools</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
              {!traces.length ? (
                <Empty
                  icon={<Activity size={22} />}
                  title="No traces yet"
                  text="Send a support message or start a conversation to produce a trace."
                />
              ) : null}
            </div>
          </section>
          <section className="panel detail-panel">
            {busy === 'trace' ? <Loading label="Loading trace" /> : null}
            {!busy && !selectedTrace ? (
              <Empty
                icon={<Activity size={22} />}
                title="Select a trace"
                text="Inspect the span waterfall, tool calls, token usage, and cost for a single support turn."
              />
            ) : null}
            {selectedTrace ? (
              <div className="trace-detail">
                <div className="panel-heading">
                  <div>
                    <h3>{prettyIntent(selectedTrace.trace?.data?.intent ?? 'Support turn')}</h3>
                    <p>
                      {selectedTrace.trace?.trace_id} · {time(selectedTrace.trace?.created_at)}
                    </p>
                  </div>
                  {selectedTrace.jaegerUrl ? (
                    <a
                      className="button secondary compact"
                      href={selectedTrace.jaegerUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Jaeger <ExternalLink size={13} />
                    </a>
                  ) : null}
                </div>
                <TraceWaterfall trace={selectedTrace.trace} jaegerUrl={selectedTrace.jaegerUrl} />
                {selectedTrace.modelCalls?.length ? (
                  <div className="model-call-table">
                    <h4>Model calls</h4>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Purpose</th>
                          <th>Model</th>
                          <th>Tokens</th>
                          <th>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTrace.modelCalls.map((call: Any) => (
                          <tr key={call.id}>
                            <td>{call.purpose}</td>
                            <td>{call.model}</td>
                            <td>
                              {call.input_tokens} / {call.output_tokens}
                            </td>
                            <td>{money(call.cost_usd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <details className="raw-json">
                  <summary>Raw trace JSON</summary>
                  <pre>{JSON.stringify(selectedTrace.trace?.data, null, 2)}</pre>
                </details>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === 'knowledge' ? (
        <Knowledge
          sources={sources}
          overview={overview}
          busy={busy === 'ingest'}
          onIngest={() => void runIngestion()}
        />
      ) : null}
    </div>
  );
}

function Overview({
  data,
  analytics,
  system,
  onOpenEval,
  onOpenTrace,
  onGoToEvals,
}: {
  data: Any;
  analytics: Any;
  system: Any;
  onOpenEval: (run: Any) => void;
  onOpenTrace: (id: string) => void;
  onGoToEvals: () => void;
}) {
  const conversations = analytics?.conversations ?? {};
  const csat = analytics?.csat ?? {};
  const latency = analytics?.latency ?? {};
  const costs = data.costs ?? {};
  const totals = costs.totals ?? {};
  const daily = (analytics?.daily ?? []) as TrendPoint[];
  const intents = (analytics?.intents ?? []) as Array<{ intent: string; count: number }>;
  const tools = (analytics?.tools ?? []) as Array<{
    name: string;
    count: number;
    failures: number;
  }>;
  const latest = analytics?.latestEval ?? data.evalRuns?.[0];
  const latestSummary = latest?.results?.summary ?? {};
  const evalTotal = latestSummary.total ?? latest?.results?.cases?.length ?? 0;
  const evalPassed = latestSummary.passed ?? 0;
  const evalRate =
    typeof latestSummary.passRate === 'number'
      ? latestSummary.passRate
      : evalTotal
        ? evalPassed / evalTotal
        : null;
  const topIntents = intents.slice(0, 5).map((item, index) => ({
    label: prettyIntent(item.intent),
    value: item.count,
    color: INTENT_COLORS[index % INTENT_COLORS.length],
  }));
  const intentTotal = intents.reduce((sum, item) => sum + item.count, 0);
  const recentTraces = (data.traces ?? []).slice(0, 6);
  const checks = data.reliability ?? [];

  return (
    <div className="overview">
      <div className="kpi-grid">
        <Kpi
          icon={<ShieldCheck size={18} />}
          label="Containment"
          value={percent(conversations.containmentRate, 0)}
          detail={`${conversations.resolved ?? 0} of ${conversations.total ?? 0} conversations resolved without handoff`}
          tone="teal"
        />
        <Kpi
          icon={<Sparkles size={18} />}
          label="CSAT"
          value={csat.average != null ? `${Number(csat.average).toFixed(2)} / 5` : '—'}
          detail={`${csat.responses ?? 0} customer ratings · ${percent(csat.positiveRate, 0)} positive`}
          tone="amber"
        />
        <Kpi
          icon={<Clock size={18} />}
          label="p95 response"
          value={ms(latency.p95)}
          detail={`Median ${ms(latency.p50)} · ${analytics?.messages?.assistant ?? 0} answers`}
          tone="blue"
        />
        <Kpi
          icon={<Users size={18} />}
          label="Handoff rate"
          value={percent(conversations.handoffRate, 0)}
          detail={`${conversations.handoffs ?? 0} conversations escalated to a person`}
          tone="rose"
        />
      </div>

      <div className="overview-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h3>Support volume</h3>
              <p>Last {analytics?.rangeDays ?? 14} days · answers, conversations, and handoffs</p>
            </div>
            <span className="panel-stat">
              <strong>{analytics?.messages?.total ?? 0}</strong> messages
            </span>
          </div>
          <TrendChart data={daily} />
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Intent mix</h3>
              <p>How customers ask for help</p>
            </div>
          </div>
          {topIntents.length ? (
            <Donut
              segments={topIntents}
              center={
                <>
                  <strong>{intentTotal}</strong>
                  <span>traces</span>
                </>
              }
              caption="Intent distribution"
            />
          ) : (
            <div className="chart-empty">No intent data yet.</div>
          )}
          <IntentBars data={intents} total={intentTotal} />
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Latest evaluation</h3>
              <p>
                {latest
                  ? `${latest.results?.dataset?.name ?? 'support_v1'} · ${time(latest.created_at)}`
                  : 'No evaluation has run yet'}
              </p>
            </div>
            <button className="text-button" onClick={onGoToEvals}>
              View all <ArrowUpRight size={13} />
            </button>
          </div>
          {latest ? (
            <>
              <div className="eval-hero">
                <div
                  className={`eval-ring ${evalRate != null && evalRate >= 0.9 ? 'good' : 'warn'}`}
                >
                  <svg viewBox="0 0 120 120" aria-hidden="true">
                    <circle cx="60" cy="60" r="50" className="ring-track" />
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      className="ring-value"
                      strokeDasharray={`${(evalRate ?? 0) * 314} 314`}
                    />
                  </svg>
                  <span>
                    <strong>{evalRate != null ? percent(evalRate, 0) : '—'}</strong>
                    <small>pass rate</small>
                  </span>
                </div>
                <div className="eval-hero-copy">
                  <strong>
                    {evalPassed} / {evalTotal} cases passed
                  </strong>
                  <p>
                    Deterministic checks cover behavior, citations, keywords, safety, and tool use.
                    {latest.results?.comparison
                      ? ` ${latest.results.comparison.summary ?? ''}`
                      : ''}
                  </p>
                  <div className="mini-metrics">
                    <span>
                      <em>Answer accuracy</em>
                      <strong>{percent(latestSummary.answerAccuracy, 1)}</strong>
                    </span>
                    <span>
                      <em>Citation validity</em>
                      <strong>{percent(latestSummary.citationValidity, 1)}</strong>
                    </span>
                    <span>
                      <em>Avg latency</em>
                      <strong>{ms(latestSummary.avgLatencyMs)}</strong>
                    </span>
                  </div>
                  <button className="button secondary compact" onClick={() => onOpenEval(latest)}>
                    Inspect run <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <Empty
              icon={<FlaskConical size={22} />}
              title="No eval results"
              text="Run the Python harness to generate a baseline and populate the reviewer console."
            />
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Tool usage</h3>
              <p>Actions the agent actually took</p>
            </div>
            <span className="count-pill">{tools.reduce((sum, tool) => sum + tool.count, 0)}</span>
          </div>
          <div className="tool-usage">
            {tools.map((tool) => (
              <div className="tool-usage-row" key={tool.name}>
                <span className="tool-name">
                  <Wrench size={13} /> {prettyTool(tool.name)}
                </span>
                <div className="tool-track">
                  <span
                    style={{
                      width: `${Math.max(
                        6,
                        (tool.count / Math.max(1, ...tools.map((item) => item.count))) * 100,
                      )}%`,
                    }}
                  />
                </div>
                <strong>{tool.count}</strong>
                <small>{tool.failures ? `${tool.failures} failed` : 'healthy'}</small>
              </div>
            ))}
            {!tools.length ? (
              <p className="muted-copy">
                No tool calls recorded yet. Ask about an order or start a return.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <div className="overview-bottom">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Recent traces</h3>
              <p>Each turn records retrieval, model, tools, and latency.</p>
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Intent</th>
                  <th>Behavior</th>
                  <th>Latency</th>
                  <th>Tools</th>
                  <th>Cost</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {recentTraces.map((trace: Any) => (
                  <tr key={trace.id} className="clickable" onClick={() => onOpenTrace(trace.id)}>
                    <td>{prettyIntent(trace.data?.intent ?? 'unknown')}</td>
                    <td>
                      <span className={`behavior-badge ${trace.data?.behavior ?? ''}`}>
                        {label(trace.data?.behavior ?? '—')}
                      </span>
                    </td>
                    <td>{ms(trace.data?.latencyMs)}</td>
                    <td>{trace.data?.agent?.toolCalls?.length ?? 0}</td>
                    <td>{money(trace.data?.agent?.costUsd ?? 0)}</td>
                    <td>{relative(trace.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!recentTraces.length ? <p className="muted-copy">No traces yet.</p> : null}
          </div>
        </section>

        <section className="panel spend-panel">
          <div className="panel-heading">
            <div>
              <h3>Model spend</h3>
              <p>Last {analytics?.rangeDays ?? 14} days</p>
            </div>
            <DollarSign size={17} />
          </div>
          <div className="spend-total">{money(totals.total_usd ?? 0)}</div>
          <p className="spend-note">{costs.note}</p>
          <dl className="mini-dl">
            <div>
              <dt>Calls</dt>
              <dd>{totals.calls ?? 0}</dd>
            </div>
            <div>
              <dt>Per conversation</dt>
              <dd>{money(analytics?.cost?.perConversationUsd ?? 0)}</dd>
            </div>
            <div>
              <dt>Tokens</dt>
              <dd>
                {(totals.input_tokens ?? 0).toLocaleString()} /{' '}
                {(totals.output_tokens ?? 0).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Unknown costs</dt>
              <dd>{totals.unknown_costs ?? 0}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="system-strip">
        <span>
          <i className={`status-dot ${system?.mode === 'live' ? 'live' : ''}`} />
          {system?.mode === 'live' ? 'Live' : 'Demo'} · {system?.chatModel}
        </span>
        <span>
          <Database size={13} /> {data.ingestion?.chunks ?? 0} chunks ·{' '}
          {data.ingestion?.embedded ?? 0} embedded
        </span>
        <span>
          <Activity size={13} /> OTel {system?.otelEnabled ? 'on' : 'off'} · v{system?.version}
        </span>
        {system?.jaegerUrl ? (
          <a href={system.jaegerUrl} target="_blank" rel="noreferrer">
            Jaeger UI <ExternalLink size={12} />
          </a>
        ) : null}
        <span className="system-spacer" />
        <span className="system-checks">
          <ShieldCheck size={13} />
          {checks.length
            ? `${checks.filter((check: Any) => check.status === 'passed').length}/${checks.length} reliability checks passing`
            : 'Reliability suite available via make reliability'}
        </span>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label: kpiLabel,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <div className={`kpi-card ${tone}`}>
      <span className="kpi-icon">{icon}</span>
      <span className="kpi-label">{kpiLabel}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function EvalRunRow({
  run,
  selected,
  onClick,
}: {
  run: Any;
  selected: boolean;
  onClick: () => void;
}) {
  const summary = run.results?.summary ?? {};
  const total = summary.total ?? run.results?.cases?.length ?? 0;
  const passed = summary.passed ?? 0;
  const rate = summary.passRate ?? (total ? passed / total : null);
  return (
    <button className={`eval-run-row ${selected ? 'selected' : ''}`} onClick={onClick}>
      <span className={`eval-run-status ${run.status}`}>
        {run.status === 'running' ? (
          <LoaderCircle size={14} className="spin" />
        ) : run.status === 'failed' ? (
          <XCircle size={14} />
        ) : (
          <CheckCircle2 size={14} />
        )}
      </span>
      <span className="eval-run-copy">
        <strong>{run.results?.dataset?.name ?? run.dataset ?? 'support_v1'}</strong>
        <small>
          {run.source} · {time(run.created_at)}
        </small>
      </span>
      <span className="eval-run-rate">{rate != null ? percent(rate, 0) : '—'}</span>
      <ChevronRight size={15} />
    </button>
  );
}

function EvalDetail({ run }: { run: Any }) {
  const report = run.results ?? {};
  const summary = report.summary ?? {};
  const cases = (report.cases ?? []) as Any[];
  const categories = (report.categories ?? []) as Any[];
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? cases[0];
  const total = summary.total ?? cases.length;
  const passed = summary.passed ?? cases.filter((item) => item.passed).length;
  const passRate = summary.passRate ?? (total ? passed / total : null);
  const answerAccuracy =
    summary.answerAccuracy ??
    ratio(
      cases.filter((item) => item.expectedBehavior === 'answer'),
      (item) => item.checks?.correctness !== false,
    );
  const citationValidity =
    summary.citationValidity ??
    ratio(
      cases.filter((item) => item.expectedBehavior === 'answer'),
      (item) => item.checks?.citations !== false,
    );
  const comparison = report.comparison;
  const checks = selectedCase?.checks ?? {};

  if (run.status === 'running') {
    return <Loading label="Evaluation running. Cases import when the Python harness finishes." />;
  }
  if (run.status === 'failed') {
    return (
      <div className="eval-failed">
        <XCircle size={24} />
        <h3>Evaluation failed</h3>
        <p>{report.error ?? 'The harness exited before reporting results.'}</p>
        {report.log ? <pre>{report.log}</pre> : null}
      </div>
    );
  }

  return (
    <div className="eval-detail">
      <div className="panel-heading">
        <div>
          <h3>Run {String(run.id).slice(0, 8)}</h3>
          <p>
            {report.mode === 'live' ? 'Live model' : 'Demo engine'} ·{' '}
            {report.model ?? 'demo-engine'} · {time(run.created_at)}
          </p>
        </div>
        <span className={`status-badge ${run.status}`}>{label(run.status)}</span>
      </div>

      <div className="eval-metric-grid">
        <Metric
          label="Pass rate"
          value={percent(passRate, 1)}
          detail={`${passed} / ${total} cases`}
        />
        <Metric
          label="Answer accuracy"
          value={percent(answerAccuracy, 1)}
          detail="Correct answers among answerable cases"
        />
        <Metric
          label="Citation validity"
          value={percent(citationValidity, 1)}
          detail="Answers citing a supplied source"
        />
        <Metric
          label="Avg latency"
          value={ms(summary.avgLatencyMs)}
          detail={`p95 ${ms(summary.p95LatencyMs)}`}
        />
      </div>

      {comparison ? (
        <div className="comparison-banner">
          <Sparkles size={16} />
          <span>
            {comparison.summary ??
              `Compared with the checked-in baseline: ${comparison.passRateDelta >= 0 ? '+' : ''}${(
                (comparison.passRateDelta ?? 0) * 100
              ).toFixed(1)} pts pass rate.`}
          </span>
        </div>
      ) : null}

      <div className="eval-grid">
        <div>
          <h4 className="subhead">By category</h4>
          <div className="category-list">
            {categories.map((category) => (
              <div className="category-row" key={category.category}>
                <span>{prettyIntent(category.category)}</span>
                <div className="category-track">
                  <span style={{ width: `${(category.passRate ?? 0) * 100}%` }} />
                </div>
                <strong>{percent(category.passRate, 0)}</strong>
                <small>
                  {category.passed}/{category.total}
                </small>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="subhead">Run metadata</h4>
          <dl className="eval-meta">
            <div>
              <dt>Dataset</dt>
              <dd>{report.dataset?.name ?? 'support_v1'}</dd>
            </div>
            <div>
              <dt>Harness</dt>
              <dd>{report.harness ?? 'python-harness'}</dd>
            </div>
            <div>
              <dt>Judge</dt>
              <dd>{report.judge?.enabled ? report.judge.model : 'deterministic only'}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{time(report.startedAt)}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{time(report.finishedAt)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <h4 className="subhead">Cases</h4>
      <div className="data-table-wrap">
        <table className="data-table case-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Question</th>
              <th>Expected</th>
              <th>Actual</th>
              <th>Checks</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((item) => (
              <tr
                key={item.id}
                className={`clickable ${selectedCase?.id === item.id ? 'selected' : ''}`}
                onClick={() => setSelectedCaseId(item.id)}
              >
                <td>
                  <code>{item.id}</code>
                </td>
                <td className="question-cell">{item.question}</td>
                <td>{label(item.expectedBehavior)}</td>
                <td>{label(item.actualBehavior)}</td>
                <td>
                  <span className={`pass-pill ${item.passed ? 'pass' : 'fail'}`}>
                    {item.passed ? <Check size={12} /> : <X size={12} />}
                    {item.passed ? 'Pass' : 'Fail'}
                  </span>
                </td>
                <td>{ms(item.latencyMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedCase ? (
        <div className="case-detail">
          <div className="case-detail-head">
            <div>
              <span className="eyebrow">
                {selectedCase.id} · {prettyIntent(selectedCase.category)}
              </span>
              <h3>{selectedCase.question}</h3>
            </div>
            <span className={`pass-pill ${selectedCase.passed ? 'pass' : 'fail'}`}>
              {selectedCase.passed ? 'Passed' : 'Failed'}
            </span>
          </div>
          <div className="case-answer">
            <h4>Agent answer</h4>
            <Markdown text={selectedCase.actualAnswer ?? '—'} />
          </div>
          <div className="case-checks">
            {Object.entries(checks).map(([check, value]) => (
              <span
                key={check}
                className={`check-pill ${value === true ? 'pass' : value === false ? 'fail' : 'neutral'}`}
              >
                {value === true ? <Check size={12} /> : value === false ? <X size={12} /> : null}
                {label(check)}
              </span>
            ))}
          </div>
          {selectedCase.notes ? (
            <div className="case-note">
              <AlertCircle size={14} />
              <span>{selectedCase.notes}</span>
            </div>
          ) : null}
          {selectedCase.citations?.length ? (
            <p className="case-citations">
              <BookOpen size={13} /> Citations: {selectedCase.citations.length} ·{' '}
              {selectedCase.citations
                .slice(0, 4)
                .map((citation: Citation | string) =>
                  typeof citation === 'string' ? citation : citation.id,
                )
                .join(', ')}
            </p>
          ) : null}
          {selectedCase.traceId ? (
            <p className="case-citations">
              <Activity size={13} /> Trace <code>{selectedCase.traceId}</code>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ConversationDetailView({
  detail,
  onOpenTrace,
}: {
  detail: ConversationDetail;
  onOpenTrace: (id: string) => void;
}) {
  const latestTrace = detail.traces[detail.traces.length - 1];
  return (
    <div className="conversation-detail">
      <div className="panel-heading">
        <div>
          <h3>{detail.chat.title}</h3>
          <p>
            {detail.chat.email} · {detail.messages.length} messages · {label(detail.chat.status)}
          </p>
        </div>
        {latestTrace ? (
          <button className="button secondary compact" onClick={() => onOpenTrace(latestTrace.id)}>
            <Activity size={13} /> Trace
          </button>
        ) : null}
      </div>

      <div className="transcript">
        {detail.messages.map((message) => (
          <div key={message.id} className={`transcript-message ${message.role}`}>
            <div className="transcript-meta">
              <strong>{message.role === 'user' ? detail.chat.email : 'Maxify support'}</strong>
              <span>{time(message.created_at)}</span>
              {message.intent ? <em>{prettyIntent(message.intent)}</em> : null}
              {message.feedback_rating != null ? (
                <span className="transcript-rating">{message.feedback_rating}/5</span>
              ) : null}
            </div>
            {message.role === 'assistant' ? (
              <Markdown text={message.content} />
            ) : (
              <p className="transcript-user-text">{message.content}</p>
            )}
            {message.citations?.length ? (
              <div className="transcript-citations">
                <BookOpen size={12} />
                {message.citations.length} source{message.citations.length === 1 ? '' : 's'}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="conversation-side">
        <div>
          <h4>Tool calls</h4>
          {detail.toolCalls.length ? (
            detail.toolCalls.map((call) => (
              <div className="side-row" key={call.id}>
                <Wrench size={13} />
                <span>{prettyTool(call.name)}</span>
                <em className={`tool-status ${call.status}`}>{label(call.status)}</em>
              </div>
            ))
          ) : (
            <p className="muted-copy">No tools were needed.</p>
          )}
        </div>
        <div>
          <h4>Tickets & returns</h4>
          {detail.tickets.map((ticket) => (
            <div className="side-row" key={ticket.id}>
              <FileText size={13} />
              <span>{ticket.subject}</span>
              <em>{label(ticket.status)}</em>
            </div>
          ))}
          {detail.returns.map((item) => (
            <div className="side-row" key={item.id}>
              <FileText size={13} />
              <span>{item.rma}</span>
              <em>{label(item.status)}</em>
            </div>
          ))}
          {!detail.tickets.length && !detail.returns.length ? (
            <p className="muted-copy">No tickets or RMAs.</p>
          ) : null}
        </div>
        <div>
          <h4>Pending actions</h4>
          {detail.pendingActions.length ? (
            detail.pendingActions.map((action) => (
              <div className="side-row" key={action.id}>
                <Clock size={13} />
                <span>{prettyTool(action.action)}</span>
                <em>{label(action.status)}</em>
              </div>
            ))
          ) : (
            <p className="muted-copy">Nothing awaiting confirmation.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Knowledge({
  sources,
  overview,
  busy,
  onIngest,
}: {
  sources: Any[];
  overview: Any | null;
  busy: boolean;
  onIngest: () => void;
}) {
  const ingestion = overview?.ingestion ?? {};
  return (
    <div className="knowledge">
      <div className="knowledge-grid">
        <section className="panel ingestion-card">
          <div className="panel-heading">
            <div>
              <h3>Active corpus</h3>
              <p>Immutable snapshots with verified content hashes.</p>
            </div>
            <span className={`status-badge ${ingestion.ready ? 'completed' : 'failed'}`}>
              {ingestion.ready ? 'Ready' : 'Not ready'}
            </span>
          </div>
          <div className="ingestion-stats">
            <div>
              <strong>{ingestion.chunks ?? 0}</strong>
              <span>chunks</span>
            </div>
            <div>
              <strong>{ingestion.sources ?? 0}</strong>
              <span>documents</span>
            </div>
            <div>
              <strong>{ingestion.embedded ?? 0}</strong>
              <span>embedded</span>
            </div>
            <div>
              <strong>{ingestion.lexicalOnly ? 'Lexical' : 'Hybrid'}</strong>
              <span>retrieval</span>
            </div>
          </div>
          <p className="corpus-version">
            <Terminal size={13} /> {ingestion.activeVersion ?? 'No active corpus version'}
          </p>
          <button className="button secondary compact" disabled={busy} onClick={onIngest}>
            {busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
            {busy ? 'Ingesting…' : 'Run ingestion'}
          </button>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Corpus versions</h3>
              <p>Activation is atomic; failed staging never replaces the active corpus.</p>
            </div>
          </div>
          <div className="version-list">
            {(ingestion.versions ?? []).map((version: Any) => (
              <div className="version-row" key={version.id}>
                <span className={`version-dot ${version.status}`} />
                <code>{version.id}</code>
                <span className={`status-badge ${version.status}`}>{label(version.status)}</span>
                <small>{time(version.activated_at ?? version.created_at)}</small>
                {version.error ? <em title={version.error}>error</em> : null}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Source documents</h3>
            <p>
              Preserved manufacturer specifications and clearly labeled fictional demo policies.
            </p>
          </div>
          <span className="count-pill">{sources.length}</span>
        </div>
        <div className="source-table">
          <div className="source-table-head">
            <span>Document</span>
            <span>Type</span>
            <span>Chunks</span>
            <span>Embedded</span>
            <span />
          </div>
          {sources.map((source) => (
            <div className="source-row" key={source.id}>
              <span className="source-name">
                <FileText size={16} />
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.url}</small>
                </span>
              </span>
              <span
                className={`source-type ${source.source_type === 'demo_policy' ? 'policy' : ''}`}
              >
                {source.source_type === 'demo_policy' ? 'Demo policy' : 'Manufacturer'}
              </span>
              <span>{source.chunks}</span>
              <span>{source.embedded}</span>
              <a
                href={`/api/admin/sources/${encodeURIComponent(source.id)}/raw`}
                target="_blank"
                rel="noreferrer"
                className="icon-button"
                aria-label={`Open raw ${source.title}`}
              >
                <ExternalLink size={15} />
              </a>
            </div>
          ))}
        </div>
      </section>

      <div className="knowledge-note">
        <ShieldCheck size={16} />
        <p>
          Snapshots are hash-verified before ingestion. Product facts come from manufacturer pages;
          Demo store policies are fictional and labeled as such in the UI. Retrieval never invents a
          citation for content that was not indexed.
        </p>
      </div>
    </div>
  );
}

function Metric({
  label: metricLabel,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="eval-metric">
      <span>{metricLabel}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function Loading({ label: loadingLabel }: { label: string }) {
  return (
    <div className="loading-state">
      <LoaderCircle className="spin" size={22} />
      {loadingLabel}
    </div>
  );
}

function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function prettyIntent(intent: string): string {
  const labels: Record<string, string> = {
    product_question: 'Product question',
    product_comparison: 'Comparison',
    ambiguous_product: 'Needs clarification',
    policy_returns: 'Returns policy',
    policy_shipping: 'Shipping policy',
    policy_warranty: 'Warranty',
    order_status: 'Order status',
    return_request: 'Return request',
    human_handoff: 'Human handoff',
    unsupported: 'Out of scope',
    greeting: 'Greeting',
    thanks: 'Thanks',
    answer: 'Answered',
    clarify: 'Clarify',
    abstain: 'Abstain',
    safety: 'Safety',
    citations: 'Citations',
    behavior: 'Behavior',
    correctness: 'Correctness',
    keyword: 'Keyword',
    tool_use: 'Tool use',
    no_hallucination: 'No hallucination',
  };
  return labels[intent] ?? intent.replace(/_/g, ' ');
}

function prettyTool(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function ratio(items: Any[], predicate: (item: Any) => boolean): number | null {
  if (!items.length) return null;
  return items.filter(predicate).length / items.length;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
