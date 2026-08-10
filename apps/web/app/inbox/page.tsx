'use client';

import { useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface Conversation { id: string; title?: string; status: string; lastMessageAt?: string; account: { platform: string; displayName: string }; contact?: { displayName: string; consentStatus: string; suppressed: boolean }; messages: Array<{ content: string; status: string }> }
export default function InboxPage() { const workspaceId = useSession((state) => state.workspaceId); const query = useQuery({ queryKey: ['conversations', workspaceId], queryFn: () => api<Conversation[]>(`/workspaces/${workspaceId}/conversations`), enabled: Boolean(workspaceId) }); return <AppShell title="Unified Inbox" subtitle="Hội thoại hợp nhất, contact context, tags và trạng thái tin nhắn trung thực.">{query.data?.length ? <div className="grid min-h-[560px] grid-cols-[320px_1fr] overflow-hidden panel"><div className="border-r border-[var(--border)]">{query.data.map((item) => <div className="border-b border-[var(--border)] p-4" key={item.id}><div className="flex items-center justify-between"><div className="font-medium">{item.contact?.displayName ?? item.title}</div><Status tone={item.contact?.suppressed ? 'danger' : 'success'}>{item.account.platform}</Status></div><p className="mt-2 truncate text-sm text-[var(--muted)]">{item.messages[0]?.content ?? 'Chưa có tin nhắn'}</p></div>)}</div><div className="grid place-items-center text-center"><div><Inbox className="mx-auto text-teal-300" /><h3 className="mt-3 font-semibold">Chọn một hội thoại</h3><p className="mt-2 text-sm text-[var(--muted)]">Lịch sử và composer sẽ xuất hiện tại đây.</p></div></div></div> : <Empty title="Inbox chưa có hội thoại" description="Tin nhắn chỉ được đồng bộ khi adapter chính thức có quyền tương ứng." />}</AppShell>; }
