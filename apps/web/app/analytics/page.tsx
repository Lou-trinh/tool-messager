'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, ContactRound, Download, Inbox, Printer, Workflow } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Metric } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface Analytics { contacts: { total: number; optedIn: number; suppressed: number }; conversations: number; accounts: number; activeAutomations: number; messages: Record<string, number>; campaigns: Record<string, number>; posts: Record<string, number>; queue: Record<string, number> }

export default function AnalyticsPage() {
  const workspaceId = useSession((state) => state.workspaceId);
  const query = useQuery({ queryKey: ['analytics', workspaceId], queryFn: () => api<Analytics>(`/workspaces/${workspaceId}/analytics`), enabled: Boolean(workspaceId), refetchInterval: 30_000 });
  const data = query.data;
  const exportCsv = () => {
    if (!data) return;
    const rows: Array<[string, string, number]> = [
      ['contacts', 'total', data.contacts.total], ['contacts', 'opted_in', data.contacts.optedIn], ['contacts', 'suppressed', data.contacts.suppressed],
      ['workspace', 'conversations', data.conversations], ['workspace', 'accounts', data.accounts], ['workspace', 'active_automations', data.activeAutomations],
      ...Object.entries(data.messages).map(([key, value]) => ['messages', key, value] as [string, string, number]),
      ...Object.entries(data.campaigns).map(([key, value]) => ['campaigns', key, value] as [string, string, number]),
      ...Object.entries(data.posts).map(([key, value]) => ['posts', key, value] as [string, string, number]),
      ...Object.entries(data.queue).map(([key, value]) => ['queue', key, value] as [string, string, number]),
    ];
    const blob = new Blob([`category,metric,value\r\n${rows.map((row) => row.join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `analytics-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  return <AppShell title="Phân tích vận hành" subtitle="Số liệu trực tiếp từ PostgreSQL và BullMQ; tự làm mới mỗi 30 giây." action={<div className="flex gap-2"><button className="button-ghost" disabled={!data} onClick={exportCsv}><Download className="mr-2 inline" size={15} />Xuất CSV</button><button className="button-ghost" onClick={() => window.print()}><Printer className="mr-2 inline" size={15} />In / PDF</button></div>}>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Metric label="Contacts" value={data?.contacts.total ?? '—'} detail={`${data?.contacts.optedIn ?? 0} opted-in · ${data?.contacts.suppressed ?? 0} suppressed`} icon={<ContactRound size={18} />} /><Metric label="Conversations" value={data?.conversations ?? '—'} detail="Unified inbox" icon={<Inbox size={18} />} /><Metric label="Automation active" value={data?.activeAutomations ?? '—'} detail="Versioned workflow" icon={<Workflow size={18} />} /><Metric label="Queue waiting" value={data?.queue.waiting ?? '—'} detail={`${data?.queue.failed ?? 0} failed`} icon={<BarChart3 size={18} />} /></div>
    <div className="mt-5 grid gap-4 lg:grid-cols-3">{([['Messages', data?.messages], ['Campaigns', data?.campaigns], ['Posts', data?.posts]] as const).map(([label, values]) => <div className="panel p-5" key={label}><h3 className="font-semibold">{label}</h3><div className="mt-4 space-y-2">{Object.entries(values ?? {}).map(([status, value]) => <div className="flex items-center justify-between rounded-lg bg-white/[.025] px-3 py-2 text-sm" key={status}><span className="text-[var(--muted)]">{status}</span><strong>{value.toLocaleString('vi-VN')}</strong></div>)}</div></div>)}</div>
  </AppShell>;
}
