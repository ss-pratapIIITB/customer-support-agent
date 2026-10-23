import { Activity, ArrowUpRight, LogOut, MessageSquare, Plus, ShieldCheck, X } from 'lucide-react';
import type { Chat, Mode, User } from '../types.js';
import { Brand } from './Brand.js';

type Props = {
  user: User;
  mode: Mode;
  chats: Chat[];
  chatId: string | null;
  view: 'chat' | 'review';
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onView: (view: 'chat' | 'review') => void;
  onLogout: () => void;
};

function dayKey(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start - target) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}

export function Sidebar({
  user,
  mode,
  chats,
  chatId,
  view,
  open,
  onClose,
  onSelect,
  onNew,
  onView,
  onLogout,
}: Props) {
  const reviewer = user.role === 'reviewer' || user.role === 'admin';
  const groups = new Map<string, Chat[]>();
  for (const chat of chats) {
    const key = dayKey(chat.updated_at ?? chat.created_at);
    const list = groups.get(key) ?? [];
    list.push(chat);
    groups.set(key, list);
  }

  return (
    <>
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Workspace navigation">
        <div className="sidebar-head">
          <Brand />
          <button className="sidebar-close" aria-label="Close navigation" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <button className="new-chat" onClick={onNew}>
          <span className="new-chat-icon">
            <Plus size={17} />
          </span>
          New conversation
          <span className="shortcut">⌘ K</span>
        </button>

        <nav className="sidebar-nav" aria-label="Workspace">
          <p className="nav-label">Workspace</p>
          <button
            className={`nav-item ${view === 'chat' ? 'active' : ''}`}
            onClick={() => onView('chat')}
          >
            <MessageSquare size={17} />
            <span>Customer support</span>
          </button>
          {reviewer ? (
            <button
              className={`nav-item ${view === 'review' ? 'active' : ''}`}
              onClick={() => onView('review')}
            >
              <Activity size={17} />
              <span>Reviewer console</span>
              <em>Admin</em>
            </button>
          ) : null}
        </nav>

        <div className="history-heading">
          <span>Conversations</span>
          <span>{chats.length}</span>
        </div>

        <div className="history">
          {[...groups.entries()].map(([label, items]) => (
            <div className="history-group" key={label}>
              <p>{label}</p>
              {items.map((chat) => (
                <button
                  key={chat.id}
                  className={`history-item ${chatId === chat.id && view === 'chat' ? 'selected' : ''}`}
                  onClick={() => onSelect(chat.id)}
                  title={chat.title}
                >
                  <span
                    className={`history-dot ${chat.status === 'handed_off' ? 'handoff' : ''}`}
                  />
                  <span className="history-copy">
                    <strong>{chat.title || 'New conversation'}</strong>
                    {chat.last_message ? <small>{chat.last_message}</small> : null}
                  </span>
                  {chat.negative_feedback ? (
                    <span className="history-alert" title="Negative feedback">
                      !
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
          {!chats.length ? <p className="history-empty">No conversations yet.</p> : null}
        </div>

        <div className="sidebar-footer">
          <div className="engine-card">
            <span className={`engine-dot ${mode === 'live' ? 'live' : ''}`} />
            <div>
              <strong>{mode === 'live' ? 'Live model' : 'Demo engine'}</strong>
              <small>
                {mode === 'live'
                  ? 'OpenAI-compatible provider'
                  : 'Deterministic · no API key needed'}
              </small>
            </div>
            <ShieldCheck size={15} />
          </div>

          <div className="account">
            <span className="account-avatar">{reviewer ? 'R' : 'C'}</span>
            <span className="account-copy">
              <strong>{user.name || (reviewer ? 'Demo reviewer' : 'Demo customer')}</strong>
              <small>{user.email}</small>
            </span>
            <button aria-label="Log out" title="Log out" onClick={onLogout}>
              <LogOut size={16} />
            </button>
          </div>

          <a
            className="sidebar-link"
            href="https://github.com/ss-pratapIIITB/customer-support-agent"
            target="_blank"
            rel="noreferrer"
          >
            View source on GitHub <ArrowUpRight size={13} />
          </a>
        </div>
      </aside>
      {open ? <button className="scrim" aria-label="Close navigation" onClick={onClose} /> : null}
    </>
  );
}
