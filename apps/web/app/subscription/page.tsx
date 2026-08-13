'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

type UsageItem = { used: number; limit: number };
type Usage = { plan: string; subscription: { status: string; start: string; end: string }; users: UsageItem; accounts: UsageItem; contacts: UsageItem; campaigns: UsageItem; messagesToday: UsageItem; messagesMonth: UsageItem; storage: UsageItem; features: { automation: boolean; analytics: boolean; api: boolean } };

export default function SubscriptionPage() {
  const workspaceId = useSession((state) => state.workspaceId);
  const query = useQuery({ queryKey: ['usage', workspaceId], queryFn: () => api<Usage>(`/workspaces/${workspaceId}/usage`), enabled: Boolean(workspaceId) });
  const data = query.data;
  const rows: Array<[string, UsageItem | undefined]> = [['Người dùng', data?.users], ['Tài khoản Zalo', data?.accounts], ['Danh bạ', data?.contacts], ['Chiến dịch', data?.campaigns], ['Tin nhắn hôm nay', data?.messagesToday], ['Tin nhắn tháng', data?.messagesMonth], ['Dung lượng (bytes)', data?.storage]];
  return <AppShell title="Gói thuê và mức sử dụng" subtitle="Quota được kiểm tra phía API và worker; trang này vẫn xem được khi subscription đã hết hạn."><div className="panel p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow">Current plan</div><h2 className="mt-2 text-xl font-bold">{data?.plan ?? '—'}</h2></div><Status tone={data?.subscription.status === 'ACTIVE' ? 'success' : data?.subscription.status === 'EXPIRING' ? 'warning' : 'danger'}>{data?.subscription.status ?? 'LOADING'}</Status></div><p className="mt-3 text-sm text-[var(--muted)]">Hiệu lực đến {data?.subscription ? new Date(data.subscription.end).toLocaleString('vi-VN') : '—'}</p></div><div className="mt-5 grid gap-4 md:grid-cols-2">{rows.map(([label, value]) => { const percent = value?.limit ? Math.min(100, Math.round(value.used / value.limit * 100)) : 0; return <div className="panel p-5" key={label}><div className="flex justify-between text-sm"><span>{label}</span><span className="text-[var(--muted)]">{value?.used.toLocaleString('vi-VN') ?? 0} / {value?.limit.toLocaleString('vi-VN') ?? 0}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[.05]"><div className={`h-full rounded-full ${percent >= 90 ? 'bg-rose-400' : 'bg-teal-400'}`} style={{ width: `${percent}%` }} /></div></div>; })}</div></AppShell>;
}
