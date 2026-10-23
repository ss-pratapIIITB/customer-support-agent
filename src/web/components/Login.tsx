import { useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Headphones,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Brand } from './Brand.js';

type Props = {
  onLogin: (email: string, password: string) => Promise<void>;
  error: string;
};

const DEMO_ACCOUNTS = [
  {
    email: 'customer@maxify.demo',
    role: 'Customer',
    detail: 'Ask product questions, check orders, start a return.',
  },
  {
    email: 'reviewer@maxify.demo',
    role: 'Reviewer',
    detail: 'Inspect conversations, evals, traces, and reliability.',
  },
];

export function Login({ onLogin, error }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(nextEmail = email, nextPassword = password) {
    setBusy(true);
    try {
      await onLogin(nextEmail, nextPassword);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  return (
    <div className="login-page">
      <section className="login-story">
        <div className="login-story-top">
          <Brand />
          <span className="login-mode">
            <i /> Live demo workspace
          </span>
        </div>

        <div className="login-copy">
          <p className="eyebrow">AI CUSTOMER SUPPORT, EXPLAINED</p>
          <h1>
            Answers you can
            <br />
            trace back to the source.
          </h1>
          <p className="login-lede">
            A support agent that retrieves official specifications, checks real order state, takes
            safe actions, and shows every step to the team behind it.
          </p>

          <div className="login-features">
            <div>
              <Span icon={<ShieldCheck size={18} />} />
              <div>
                <strong>Source-grounded</strong>
                <span>Every factual answer carries a citation.</span>
              </div>
            </div>
            <div>
              <Span icon={<Wrench size={18} />} />
              <div>
                <strong>Tool-using, not just chat</strong>
                <span>Order lookup, returns with confirmation, and human handoff.</span>
              </div>
            </div>
            <div>
              <Span icon={<Sparkles size={18} />} />
              <div>
                <strong>Built to be inspected</strong>
                <span>OpenTelemetry traces, Python evals, and live quality metrics.</span>
              </div>
            </div>
          </div>
        </div>

        <div className="login-story-footer">
          <span>MAXIFY / SUPPORT PLATFORM</span>
          <span>v1.0 · {new Date().getFullYear()}</span>
        </div>
        <div className="login-orbit login-orbit-a" />
        <div className="login-orbit login-orbit-b" />
      </section>

      <section className="login-form-area">
        <div className="login-form">
          <div className="login-form-heading">
            <span className="login-mark">
              <Headphones size={22} />
            </span>
            <h2>Welcome back</h2>
            <p>Sign in to the demo workspace.</p>
          </div>

          <form onSubmit={onSubmit}>
            <label>
              <span>Email address</span>
              <input
                type="email"
                autoComplete="username"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              <span>Password</span>
              <div className="password-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>

            {error ? (
              <div className="form-error" role="alert">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            ) : null}

            <button className="primary login-submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <span>Sign in</span>}
              {busy ? null : <ArrowRight size={17} />}
            </button>
          </form>

          <div className="demo-divider">
            <span>One-click demo accounts</span>
          </div>

          <div className="demo-logins">
            {DEMO_ACCOUNTS.map((account, index) => (
              <button
                key={account.email}
                type="button"
                className="demo-account"
                disabled={busy}
                onClick={() => void submit(account.email, 'Demo123!')}
              >
                <span className={`demo-avatar ${index === 1 ? 'reviewer' : ''}`}>
                  {index === 1 ? 'R' : 'C'}
                </span>
                <span className="demo-account-copy">
                  <strong>{account.role} workspace</strong>
                  <small>{account.detail}</small>
                  <code>{account.email}</code>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>

          <div className="login-note">
            <Check size={14} />
            <span>
              Runs without an API key using a deterministic demo engine. Add an OpenAI-compatible
              key to switch the same UI to a live model.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function Span({ icon }: { icon: ReactNode }) {
  return <span className="feature-icon">{icon}</span>;
}
