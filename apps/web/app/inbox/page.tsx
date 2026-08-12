'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Send } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface Conversation {
  id: string;
  title?: string;
  status: string;
  lastMessageAt?: string;
  account: { id: string; platform: string; displayName: string };
  contact?: { id: string; displayName: string; consentStatus: string; suppressed: boolean };
  messages: Array<{ content: string; status: string }>;
}

interface Message {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  status: string;
  timestamp: string;
  errorCode?: string;
}

export default function InboxPage() {
  const workspaceId = useSession((state) => state.workspaceId);
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [content, setContent] = useState('');
  const [promotional, setPromotional] = useState(false);
  const [error, setError] = useState('');
  const conversations = useQuery({ queryKey: ['conversations', workspaceId], queryFn: () => api<Conversation[]>(`/workspaces/${workspaceId}/conversations`), enabled: Boolean(workspaceId) });
  const selected = conversations.data?.find((item) => item.id === selectedId);
  const history = useQuery({ queryKey: ['conversation-history', workspaceId, selectedId], queryFn: () => api<Message[]>(`/workspaces/${workspaceId}/conversations/${selectedId}/messages`), enabled: Boolean(workspaceId && selectedId) });
  const send = useMutation({
    mutationFn: () => {
      if (!selected?.contact) throw new Error('Hội thoại chưa gắn contact hợp lệ.');
      return api(`/workspaces/${workspaceId}/messages`, { method: 'POST', body: JSON.stringify({ accountId: selected.account.id, contactId: selected.contact.id, content: content.trim(), promotional, idempotencyKey: `manual:${crypto.randomUUID()}` }) });
    },
    onSuccess: async () => {
      setContent('');
      setError('');
      await Promise.all([client.invalidateQueries({ queryKey: ['conversation-history', workspaceId, selectedId] }), client.invalidateQueries({ queryKey: ['conversations', workspaceId] })]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Không thể xếp hàng tin nhắn.'),
  });

  useEffect(() => {
    if (!selectedId && conversations.data?.[0]) setSelectedId(conversations.data[0].id);
  }, [conversations.data, selectedId]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError('');
    if (!content.trim()) return;
    send.mutate();
  }

  return (
    <AppShell title="Hộp thư Zalo" subtitle="Hội thoại đồng bộ từ webhook chính thức; tin gửi đi luôn qua consent, suppression, queue và worker.">
      {conversations.data?.length ? (
        <div className="grid min-h-[620px] overflow-hidden panel lg:grid-cols-[320px_1fr]">
          <div className="border-b border-[var(--border)] lg:border-b-0 lg:border-r">
            {conversations.data.map((item) => <button type="button" onClick={() => setSelectedId(item.id)} className={`w-full border-b border-[var(--border)] p-4 text-left transition hover:bg-white/[.03] ${selectedId === item.id ? 'bg-teal-400/[.07]' : ''}`} key={item.id}><div className="flex items-center justify-between gap-3"><div className="truncate font-medium">{item.contact?.displayName ?? item.title}</div><Status tone={item.contact?.suppressed ? 'danger' : 'success'}>{item.account.platform}</Status></div><p className="mt-2 truncate text-sm text-[var(--muted)]">{item.messages[0]?.content ?? 'Chưa có tin nhắn'}</p></button>)}
          </div>
          {selected ? <section className="flex min-h-[560px] flex-col">
            <header className="border-b border-[var(--border)] px-5 py-4"><div className="font-semibold">{selected.contact?.displayName ?? selected.title}</div><div className="mt-1 text-xs text-[var(--muted)]">{selected.account.displayName} · Consent: {selected.contact?.consentStatus ?? 'UNKNOWN'}</div></header>
            <div className="flex-1 space-y-3 overflow-y-auto p-5">{history.isLoading && <p className="text-sm text-[var(--muted)]">Đang tải lịch sử...</p>}{history.data?.map((message) => <div key={message.id} className={`flex ${message.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm ${message.direction === 'OUTBOUND' ? 'bg-teal-400/15 text-teal-50' : 'bg-white/[.055]'}`}><p className="whitespace-pre-wrap">{message.content}</p><div className="mt-2 flex gap-2 text-[10px] text-[var(--muted)]"><span>{new Date(message.timestamp).toLocaleString('vi-VN')}</span><span>{message.status}</span>{message.errorCode && <span className="text-rose-300">{message.errorCode}</span>}</div></div></div>)}</div>
            <form className="border-t border-[var(--border)] p-4" onSubmit={submit}><textarea className="input min-h-24 resize-y" value={content} maxLength={2000} onChange={(event) => setContent(event.target.value)} placeholder="Nhập tin tư vấn hợp lệ cho người dùng Zalo..." disabled={!selected.contact || selected.contact.suppressed} /><div className="mt-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs text-[var(--muted)]"><input type="checkbox" checked={promotional} onChange={(event) => setPromotional(event.target.checked)} /> Nội dung quảng bá (bắt buộc OPTED_IN)</label><button className="button-primary ml-auto flex items-center gap-2" disabled={send.isPending || !content.trim() || !selected.contact || selected.contact.suppressed}><Send size={16} />{send.isPending ? 'Đang xếp hàng...' : 'Gửi qua queue'}</button></div>{selected.contact?.suppressed && <p className="mt-3 text-xs text-rose-300">Contact đang nằm trong suppression list nên hệ thống khóa gửi.</p>}{error && <p className="mt-3 text-xs text-rose-300">{error}</p>}</form>
          </section> : <div className="grid place-items-center text-center"><Inbox className="mx-auto text-teal-300" /><p className="mt-3">Chọn một hội thoại</p></div>}
        </div>
      ) : <Empty title="Inbox chưa có hội thoại" description="Cấu hình Zalo webhook để sự kiện tin nhắn chính thức được đồng bộ vào đây." />}
    </AppShell>
  );
}
