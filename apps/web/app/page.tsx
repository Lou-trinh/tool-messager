'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ContactRound, Inbox, Megaphone, MessageSquare, ShieldCheck, UsersRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { Empty, Metric, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface WorkspaceItem { role: string; workspace: { id: string; name: string; slug: string } }
interface UsageItem { used: number; limit: number }
interface TenantDashboard {
  workspace: { id: string; name: string; slug: string; timezone: string; status: string; suspendedAt?: string };
  subscription: null | { id: string; status: string; startAt: string; endAt: string; daysRemaining: number; autoRenew: boolean; plan: { code: string; name: string } };
  metrics: { accounts: number; connectedAccounts: number; contacts: number; conversations: number; campaigns: number; posts: number; messagesToday: number };
  usage: { users: UsageItem; accounts: UsageItem; contacts: UsageItem; campaigns: UsageItem; messagesToday: UsageItem; messagesMonth: UsageItem; storage: UsageItem };
}

function QuotaBar({ label, value }: { label: string; value: UsageItem }) {
  const percent = value.limit > 0 ? Math.min(100, Math.round(value.used / value.limit * 100)) : 0;
  return <div><div className="mb-2 flex justify-between text-xs"><span>{label}</span><span className="text-[var(--muted)]">{value.used.toLocaleString('vi-VN')} / {value.limit.toLocaleString('vi-VN')}</span></div><div className="h-2 overflow-hidden rounded-full bg-white/[.05]"><div className={`h-full rounded-full ${percent >= 90 ? 'bg-rose-400' : percent >= 70 ? 'bg-amber-300' : 'bg-teal-400'}`} style={{ width: `${percent}%` }} /></div></div>;
}

export default function DashboardPage() {
  const router = useRouter();
  const token = useSession((state) => state.accessToken);
  const hydrated = useSession((state) => state.hydrated);
  const workspaceId = useSession((state) => state.workspaceId);
  const setWorkspace = useSession((state) => state.setWorkspace);
  useEffect(() => { if (hydrated && token === null) router.replace('/login'); }, [hydrated, router, token]);
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: () => api<WorkspaceItem[]>('/workspaces'), enabled: hydrated && Boolean(token) });
  useEffect(() => { const first = workspaces.data?.[0]?.workspace.id; if (!workspaceId && first) setWorkspace(first); }, [setWorkspace, workspaceId, workspaces.data]);
  const dashboard = useQuery({ queryKey: ['tenant-dashboard', workspaceId], queryFn: () => api<TenantDashboard>(`/workspaces/${workspaceId}/dashboard`), enabled: Boolean(workspaceId), refetchInterval: 30_000 });
  const data = dashboard.data;
  const subscription = data?.subscription;
  const subscriptionTone = subscription?.status === 'ACTIVE' ? 'success' : subscription?.status === 'EXPIRING' ? 'warning' : 'danger';

  return <AppShell title={data?.workspace.name ?? 'Tổng quan vận hành'} subtitle="Dashboard tenant dùng dữ liệu thật, quota hiệu lực và vòng đời subscription được kiểm tra tại API lẫn worker.">
    {subscription && <div className={`mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4 ${subscription.status === 'EXPIRED' ? 'border-rose-400/40 bg-rose-400/10' : subscription.status === 'EXPIRING' ? 'border-amber-300/40 bg-amber-300/10' : 'border-teal-400/30 bg-teal-400/[.06]'}`}><div><div className="text-xs font-semibold uppercase tracking-[.1em] text-[var(--muted)]">Subscription</div><div className="mt-1 flex items-center gap-3"><strong>Gói {subscription.plan.code}</strong><Status tone={subscriptionTone}>{subscription.status}</Status></div><p className="mt-1 text-xs text-[var(--muted)]">Hiệu lực đến {new Date(subscription.endAt).toLocaleDateString('vi-VN')} · {subscription.autoRenew ? 'Tự động gia hạn' : 'Gia hạn thủ công'}</p></div><div className="text-right"><div className="text-3xl font-bold">{subscription.daysRemaining}</div><div className="text-xs text-[var(--muted)]">ngày còn lại</div></div></div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Zalo Accounts" value={data?.metrics.accounts ?? '—'} detail={`${data?.metrics.connectedAccounts ?? 0} đang kết nối`} icon={<UsersRound size={18} />} />
      <Metric label="Danh bạ" value={data?.metrics.contacts ?? '—'} detail="Cô lập theo tenant" icon={<ContactRound size={18} />} />
      <Metric label="Tin nhắn hôm nay" value={data?.metrics.messagesToday ?? '—'} detail={`${data?.usage.messagesToday.limit.toLocaleString('vi-VN') ?? 0} quota/ngày`} icon={<MessageSquare size={18} />} />
      <Metric label="Chiến dịch" value={data?.metrics.campaigns ?? '—'} detail={`${data?.usage.campaigns.limit.toLocaleString('vi-VN') ?? 0} chiến dịch tối đa`} icon={<Megaphone size={18} />} />
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <div className="panel p-5"><div className="flex items-center justify-between"><div><div className="eyebrow">Effective quota</div><h2 className="mt-2 font-semibold">Mức sử dụng hiện tại</h2></div><CalendarClock className="text-teal-300" size={20} /></div>{data?.usage ? <div className="mt-6 grid gap-5 sm:grid-cols-2"><QuotaBar label="Người dùng" value={data.usage.users} /><QuotaBar label="Zalo OA" value={data.usage.accounts} /><QuotaBar label="Danh bạ" value={data.usage.contacts} /><QuotaBar label="Tin nhắn tháng" value={data.usage.messagesMonth} /></div> : <div className="mt-6 text-sm text-[var(--muted)]">Đang tải quota...</div>}</div>
      <div className="panel p-5"><div className="eyebrow">Read-only after expiry</div><h2 className="mt-2 font-semibold">Chính sách vòng đời an toàn</h2><div className="mt-5 space-y-4 text-sm"><div className="flex gap-3"><ShieldCheck className="mt-0.5 text-green-400" size={17} /><div><strong>Luôn cho phép xem</strong><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Đăng nhập, xem dữ liệu, lịch sử, usage và thông tin subscription.</p></div></div><div className="flex gap-3"><Inbox className="mt-0.5 text-amber-300" size={17} /><div><strong>Khóa outbound khi hết hạn</strong><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Gửi tin, campaign, automation và publish bị chặn fail-closed.</p></div></div></div></div>
    </div>
    {dashboard.isError && <div className="mt-5"><Empty title="Không tải được dashboard" description={dashboard.error.message} /></div>}
  </AppShell>;
}
