'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, ContactRound, Inbox, Workflow } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Metric } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface Analytics { contacts: { total: number; optedIn: number; suppressed: number }; conversations: number; accounts: number; activeAutomations: number; messages: Record<string, number>; campaigns: Record<string, number>; posts: Record<string, number>; queue: Record<string, number> }
export default function AnalyticsPage() { const workspaceId = useSession((state) => state.workspaceId); const query = useQuery({ queryKey: ['analytics', workspaceId], queryFn: () => api<Analytics>(`/workspaces/${workspaceId}/analytics`), enabled: Boolean(workspaceId), refetchInterval: 30_000 }); const data = query.data; return <AppShell title="Phân tích vận hành" subtitle="Số liệu trực tiếp từ PostgreSQL và BullMQ; tự làm mới mỗi 30 giây."><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Metric label="Contacts" value={data?.contacts.total ?? '—'} detail={`${data?.contacts.optedIn ?? 0} opted-in · ${data?.contacts.suppressed ?? 0} suppressed`} icon={<ContactRound size={18} />} /><Metric label="Conversations" value={data?.conversations ?? '—'} detail="Unified inbox" icon={<Inbox size={18} />} /><Metric label="Automation active" value={data?.activeAutomations ?? '—'} detail="Versioned workflow" icon={<Workflow size={18} />} /><Metric label="Queue waiting" value={data?.queue.waiting ?? '—'} detail={`${data?.queue.failed ?? 0} failed`} icon={<BarChart3 size={18} />} /></div><div className="mt-5 grid gap-4 lg:grid-cols-3">{[['Messages', data?.messages], ['Campaigns', data?.campaigns], ['Posts', data?.posts]].map(([label, values]) => <div className="panel p-5" key={label as string}><h3 className="font-semibold">{label as string}</h3><pre className="mt-4 overflow-auto text-xs leading-6 text-[var(--muted)]">{JSON.stringify(values ?? {}, null, 2)}</pre></div>)}</div></AppShell>; }
