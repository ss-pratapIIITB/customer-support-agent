import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from './api.js';
import type { Chat as ChatType, Citation, Me, Message, Mode, Trace, User } from './types.js';
import { Brand } from './components/Brand.js';
import { Chat } from './components/Chat.js';
import { Login } from './components/Login.js';
import { Reviewer } from './components/Reviewer.js';
import { Sidebar } from './components/Sidebar.js';
import { SourceDrawer } from './components/SourceDrawer.js';

type MessagesResponse = {
  messages: Message[];
  traces: Trace[];
  toolCalls: unknown[];
};

type LoginResponse = {
  user: User;
  chatId: string | null;
  mode: Mode;
  model: string;
};

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [chats, setChats] = useState<ChatType[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<{ message: string; requestId: string } | null>(null);
  const [view, setView] = useState<'chat' | 'review'>('chat');
  const [source, setSource] = useState<Citation | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    let active = true;
    api<Me>('/api/me')
      .then(async (data) => {
        if (!active) return;
        setMe(data);
        await loadChats(data.chatId);
      })
      .catch(() => {
        if (active) setMe(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      setTraces([]);
      return;
    }
    void loadMessages(chatId);
  }, [chatId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        void newChat();
      }
      if (event.key === 'Escape') {
        setSource(null);
        setNavOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function loadChats(selected?: string | null) {
    try {
      const data = await api<{ chats: ChatType[] }>('/api/chats');
      const list = data.chats ?? [];
      setChats(list);
      const current = selected ?? chatId;
      const next =
        current && list.some((chat) => chat.id === current) ? current : (list[0]?.id ?? null);
      if (next !== chatId) setChatId(next);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function loadMessages(id: string) {
    try {
      const data = await api<MessagesResponse>(`/api/chats/${id}/messages`);
      setMessages(data.messages ?? []);
      setTraces(data.traces ?? []);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function login(email: string, password: string) {
    setError('');
    try {
      const data = await api<LoginResponse>('/api/login', {
        method: 'POST',
        body: { email, password },
      });
      setMe({
        user: data.user,
        chatId: data.chatId,
        mode: data.mode,
        model: data.model,
        embeddings: 'configured server-side',
        otel: true,
      });
      await loadChats(data.chatId);
      setView('chat');
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function logout() {
    await api('/api/logout', { method: 'POST' }).catch(() => undefined);
    setMe(null);
    setChats([]);
    setMessages([]);
    setTraces([]);
    setChatId(null);
    setView('chat');
  }

  async function newChat() {
    try {
      setError('');
      setRetry(null);
      const data = await api<{ chat: ChatType }>('/api/chats', { method: 'POST' });
      setView('chat');
      setNavOpen(false);
      setChatId(data.chat.id);
      await loadChats(data.chat.id);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function selectChat(id: string) {
    setChatId(id);
    setView('chat');
    setNavOpen(false);
    setError('');
    setRetry(null);
    setSource(null);
  }

  async function send(text: string, attempt?: { message: string; requestId: string } | null) {
    if (!me || pending) return;
    let targetChat = chatId;
    setError('');
    setPending(true);
    setRetry(null);
    if (!attempt) {
      const requestId = crypto.randomUUID();
      attempt = { message: text, requestId };
      setMessages((current) => [
        ...current,
        {
          id: `local-${requestId}`,
          role: 'user',
          content: text,
          status: 'running',
          created_at: new Date().toISOString(),
        },
      ]);
    }
    try {
      if (!targetChat) {
        const created = await api<{ chat: ChatType }>('/api/chats', { method: 'POST' });
        targetChat = created.chat.id;
        setChatId(targetChat);
      }
      await api(`/api/chats/${targetChat}/messages`, {
        method: 'POST',
        body: { message: attempt.message, requestId: attempt.requestId },
      });
      await Promise.all([loadMessages(targetChat), loadChats(targetChat)]);
    } catch (caught) {
      setError(messageOf(caught));
      setRetry(attempt);
      if (targetChat) await loadMessages(targetChat);
    } finally {
      setPending(false);
    }
  }

  async function feedback(messageId: string, rating: number) {
    try {
      await api(`/api/messages/${messageId}/feedback`, {
        method: 'POST',
        body: { rating },
      });
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, feedback_rating: rating } : message,
        ),
      );
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function handoff() {
    if (!chatId) return;
    try {
      await api(`/api/chats/${chatId}/handoff`, {
        method: 'POST',
        body: { reason: 'Customer requested a human specialist' },
      });
      await Promise.all([loadMessages(chatId), loadChats(chatId)]);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  if (loading) {
    return (
      <div className="boot">
        <Brand />
        <span>
          <LoaderCircle className="spin" size={18} /> Opening your workspace
        </span>
      </div>
    );
  }

  if (!me) {
    return <Login onLogin={login} error={error} />;
  }

  const currentChat = chats.find((chat) => chat.id === chatId) ?? null;

  return (
    <div className="app-shell">
      <Sidebar
        user={me.user}
        mode={me.mode}
        chats={chats}
        chatId={chatId}
        view={view}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onSelect={(id) => void selectChat(id)}
        onNew={() => void newChat()}
        onView={(next) => {
          setView(next);
          setNavOpen(false);
        }}
        onLogout={() => void logout()}
      />
      <main className="workspace">
        {view === 'chat' ? (
          <Chat
            chat={currentChat}
            messages={messages}
            traces={traces}
            mode={me.mode}
            model={me.model}
            pending={pending}
            error={error}
            retry={retry}
            onSend={(text) => void send(text)}
            onRetry={() => retry && void send(retry.message, retry)}
            onDismissError={() => {
              setError('');
              setRetry(null);
            }}
            onFeedback={(id, rating) => void feedback(id, rating)}
            onHandoff={() => void handoff()}
            onOpenSource={setSource}
            onOpenMenu={() => setNavOpen(true)}
          />
        ) : (
          <Reviewer />
        )}
      </main>
      <SourceDrawer citation={source} onClose={() => setSource(null)} />
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
