'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, Ban, Building2, ContactRound, Megaphone, MessageSquare, Power, Radio, ShieldAlert, UsersRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { Empty, Metric, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

type Dashboard = {
  tenants: { total: number; active: number; expiring: number; expired: number; suspended: number };
  expiringSubscriptions: Array<{ id: string; endAt: string; daysRemaining: number; workspace: { id: string; name: string; slug: string }; plan: { code: string; name: string } }>;
  accounts: { total: number; connected: number; disconnected: number };
  contacts: number;
  messages: { today: number; month: number };
  campaigns: { active: number; failed: number };
  queue: Record<string, Record<string, number | boolean>>;
  system: { outboundPaused: boolean; reason?: string };
};
type Tenant = { id: string; name: string; slug: string; status: string; suspendedAt?: string; createdAt: string; owner?: { displayName: string; email: string }; subscription?: { status: string; endAt: string; daysRemaining: number; plan: { code: string } }; _count: { accounts: number; contacts: number; campaigns: number; messages: number } };
type Plan = { id: string; code: string; name: string; description?: string; monthlyPriceCents: number; maxZaloAccounts: number; maxUsers: number; maxContacts: number; maxCampaigns: number; maxMessagesPerDay: number; maxMessagesPerMonth: number; maxStorageBytes: number; automationEnabled: boolean; analyticsEnabled: boolean; apiEnabled: boolean; active: boolean };
type Suppression = { id: string; normalizedPhone?: string; platform?: string; platformUserId?: string; reason: string; createdAt: string };
type Audit = { id: string; action: string; resource: string; result: string; createdAt: string; workspace?: { name: string }; user?: { email: string } };

const emptyForm = { companyName: '', tenantSlug: '', ownerName: '', ownerEmail: '', temporaryPassword: '', plan: 'BASIC', startDate: new Date().toISOString().slice(0, 10), expirationDate: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10) };

export default function AdminPage() {
  const router = useRouter();
  const client = useQueryClient();
  const setWorkspace = useSession((state) => state.setWorkspace);
  const [form, setForm] = useState(emptyForm);
  const [suppression, setSuppression] = useState({ phone: '', reason: '' });
  const [error, setError] = useState('');
  const dashboard = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => api<Dashboard>('/admin/dashboard'), refetchInterval: 20_000, retry: false });
  const tenants = useQuery({ queryKey: ['admin-tenants'], queryFn: () => api<Tenant[]>('/admin/tenants'), retry: false });
  const plans = useQuery({ queryKey: ['admin-plans'], queryFn: () => api<Plan[]>('/admin/plans'), retry: false });
  const suppressions = useQuery({ queryKey: ['admin-suppressions'], queryFn: () => api<Suppression[]>('/admin/suppressions'), retry: false });
  const logs = useQuery({ queryKey: ['admin-logs'], queryFn: () => api<Audit[]>('/admin/logs'), retry: false });
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ['admin-dashboard'] }), client.invalidateQueries({ queryKey: ['admin-tenants'] })]); };
  const create = useMutation({ mutationFn: () => api('/admin/tenants', { method: 'POST', body: JSON.stringify({ ...form, startDate: new Date(form.startDate).toISOString(), expirationDate: new Date(form.expirationDate).toISOString() }) }), onSuccess: async () => { setForm(emptyForm); setError(''); await refresh(); }, onError: (cause: Error) => setError(cause.message) });
  const action = useMutation({ mutationFn: ({ id, operation }: { id: string; operation: 'suspend' | 'activate' }) => api(`/admin/tenants/${id}/${operation}`, { method: 'POST' }), onSuccess: refresh, onError: (cause: Error) => setError(cause.message) });
  const manage = useMutation({
    mutationFn: async ({ tenant, operation }: { tenant: Tenant; operation: 'plan' | 'quota' | 'extend' | 'reset' | 'support' }) => {
      if (operation === 'plan') {
        const plan = window.prompt('Plan mới: FREE, BASIC, PRO, BUSINESS, ENTERPRISE', tenant.subscription?.plan.code ?? 'BASIC')?.trim().toUpperCase();
        if (!plan) return;
        return api(`/admin/tenants/${tenant.id}/change-plan`, { method: 'POST', body: JSON.stringify({ plan }) });
      }
      if (operation === 'extend') {
        const expirationDate = window.prompt('Ngày hết hạn mới (YYYY-MM-DD)', tenant.subscription?.endAt.slice(0, 10) ?? '')?.trim();
        if (!expirationDate) return;
        return api(`/admin/tenants/${tenant.id}/extend`, { method: 'POST', body: JSON.stringify({ expirationDate: new Date(expirationDate).toISOString() }) });
      }
      if (operation === 'quota') {
        const maxContacts = Number(window.prompt('Quota contact riêng cho tenant', String(Math.max(tenant._count.contacts, 1_000))) ?? '');
        const maxMessagesPerMonth = Number(window.prompt('Quota tin nhắn/tháng riêng', '10000') ?? '');
        if (!Number.isFinite(maxContacts) || !Number.isFinite(maxMessagesPerMonth)) return;
        return api(`/admin/tenants/${tenant.id}/quota`, { method: 'PATCH', body: JSON.stringify({ maxContacts, maxMessagesPerMonth }) });
      }
      if (operation === 'reset') {
        const temporaryPassword = window.prompt('Mật khẩu tạm mới (12+ ký tự, có hoa/thường/số/ký tự đặc biệt)')?.trim();
        if (!temporaryPassword) return;
        return api(`/admin/tenants/${tenant.id}/reset-password`, { method: 'POST', body: JSON.stringify({ temporaryPassword }) });
      }
      const reason = window.prompt('Lý do mở support mode cho tenant này?')?.trim();
      if (!reason) return;
      return api(`/admin/tenants/${tenant.id}/support-sessions`, { method: 'POST', body: JSON.stringify({ reason, durationMinutes: 60 }) });
    },
    onSuccess: async (_data, variables) => {
      setError('');
      await refresh();
      await client.invalidateQueries({ queryKey: ['workspaces'] });
      if (variables.operation === 'support') { setWorkspace(variables.tenant.id); router.push('/'); }
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const emergency = useMutation({ mutationFn: (paused: boolean) => paused ? api('/admin/emergency-stop', { method: 'POST', body: JSON.stringify({ reason: window.prompt('Lý do dừng toàn bộ outbound?') || 'Dừng khẩn cấp bởi SUPER_ADMIN' }) }) : api('/admin/emergency-stop', { method: 'DELETE' }), onSuccess: refresh, onError: (cause: Error) => setError(cause.message) });
  const editPlan = useMutation({ mutationFn: (plan: Plan) => {
    const monthlyPriceCents = Number(window.prompt('Giá tháng (đơn vị nhỏ nhất)', String(plan.monthlyPriceCents)) ?? plan.monthlyPriceCents);
    const maxZaloAccounts = Number(window.prompt('Số Zalo OA tối đa', String(plan.maxZaloAccounts)) ?? plan.maxZaloAccounts);
    const maxContacts = Number(window.prompt('Số contact tối đa', String(plan.maxContacts)) ?? plan.maxContacts);
    const maxMessagesPerMonth = Number(window.prompt('Tin nhắn/tháng', String(plan.maxMessagesPerMonth)) ?? plan.maxMessagesPerMonth);
    return api(`/admin/plans/${plan.code}`, { method: 'PATCH', body: JSON.stringify({ name: plan.name, description: plan.description, monthlyPriceCents, maxZaloAccounts, maxUsers: plan.maxUsers, maxContacts, maxCampaigns: plan.maxCampaigns, maxMessagesPerDay: plan.maxMessagesPerDay, maxMessagesPerMonth, maxStorageBytes: plan.maxStorageBytes, automationEnabled: plan.automationEnabled, analyticsEnabled: plan.analyticsEnabled, apiEnabled: plan.apiEnabled, active: plan.active }) });
  }, onSuccess: () => client.invalidateQueries({ queryKey: ['admin-plans'] }), onError: (cause: Error) => setError(cause.message) });
  const suppress = useMutation({ mutationFn: () => api('/admin/suppressions', { method: 'POST', body: JSON.stringify(suppression) }), onSuccess: async () => { setSuppression({ phone: '', reason: '' }); await client.invalidateQueries({ queryKey: ['admin-suppressions'] }); }, onError: (cause: Error) => setError(cause.message) });
  const unsuppress = useMutation({ mutationFn: (id: string) => api(`/admin/suppressions/${id}`, { method: 'DELETE' }), onSuccess: () => client.invalidateQueries({ queryKey: ['admin-suppressions'] }), onError: (cause: Error) => setError(cause.message) });
  const data = dashboard.data;
  const denied = dashboard.error?.message.includes('SUPER_ADMIN');

  if (denied) return <AppShell title="Quản trị SaaS" subtitle="Khu vực dành riêng cho SUPER_ADMIN."><Empty title="Không có quyền truy cập" description="Tài khoản hiện tại không có vai trò hệ thống SUPER_ADMIN." /></AppShell>;
  return <AppShell title="ZaloHub SaaS Control Center" subtitle="Quản lý tenant, subscription, quota, queue và trạng thái outbound toàn hệ thống." action={<button className={data?.system.outboundPaused ? 'button-primary' : 'rounded-lg border border-rose-400/40 px-4 py-2 text-sm font-semibold text-rose-300'} disabled={emergency.isPending} onClick={() => emergency.mutate(!data?.system.outboundPaused)}>{data?.system.outboundPaused ? <><Power className="mr-2 inline" size={15} />Mở lại outbound</> : <><ShieldAlert className="mr-2 inline" size={15} />Dừng toàn bộ outbound</>}</button>}>
    {data?.system.outboundPaused && <div className="mb-5 rounded-xl border border-rose-400/40 bg-rose-400/10 px-5 py-4 font-semibold text-rose-200">SYSTEM OUTBOUND PAUSED · {data.system.reason}</div>}
    {error && <div className="mb-5 rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Tenant" value={data?.tenants.total ?? '—'} detail={`${data?.tenants.active ?? 0} active · ${data?.tenants.expiring ?? 0} sắp hết hạn`} icon={<Building2 size={18} />} />
      <Metric label="Zalo accounts" value={data?.accounts.connected ?? '—'} detail={`${data?.accounts.total ?? 0} total · ${data?.accounts.disconnected ?? 0} disconnected`} icon={<UsersRound size={18} />} />
      <Metric label="Contacts" value={data?.contacts ?? '—'} detail="Cô lập theo tenant" icon={<ContactRound size={18} />} />
      <Metric label="Messages tháng" value={data?.messages.month ?? '—'} detail={`${data?.messages.today ?? 0} hôm nay`} icon={<MessageSquare size={18} />} />
    </div>
    {data?.expiringSubscriptions.length ? <div className="mt-5 panel border-amber-300/30 p-5"><div className="flex items-center gap-2 text-amber-200"><AlertTriangle size={18} /><h2 className="font-semibold">Tenant cần gia hạn</h2></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.expiringSubscriptions.map((item) => <div className="rounded-xl border border-amber-300/20 bg-amber-300/[.05] p-4" key={item.id}><div className="font-semibold">{item.workspace.name}</div><div className="mt-2 text-xs text-[var(--muted)]">{item.plan.code} · hết hạn {new Date(item.endAt).toLocaleDateString('vi-VN')}</div><div className="mt-3 text-sm font-bold text-amber-200">Còn {item.daysRemaining} ngày</div></div>)}</div></div> : null}
    <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_.75fr]">
      <div className="panel overflow-x-auto"><div className="flex items-center justify-between border-b border-[var(--border)] p-5"><div><div className="eyebrow">Tenant management</div><h2 className="mt-2 font-semibold">Khách thuê</h2></div><div className="text-xs text-[var(--muted)]"><Megaphone className="mr-1 inline" size={14} />{data?.campaigns.active ?? 0} campaign active</div></div>
        <table className="data-table"><thead><tr><th>Tenant</th><th>Plan</th><th>Hết hạn</th><th>Usage</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{tenants.data?.map((tenant) => <tr key={tenant.id}><td><div className="font-medium">{tenant.name}</div><div className="mt-1 text-xs text-[var(--muted)]">{tenant.owner?.email ?? tenant.slug}</div></td><td>{tenant.subscription?.plan.code ?? '—'}</td><td className="text-xs text-[var(--muted)]">{tenant.subscription ? <>{new Date(tenant.subscription.endAt).toLocaleDateString('vi-VN')}<div className={tenant.subscription.daysRemaining <= 7 ? 'text-amber-300' : ''}>Còn {tenant.subscription.daysRemaining} ngày</div></> : '—'}</td><td className="text-xs text-[var(--muted)]">{tenant._count.accounts} OA · {tenant._count.contacts} contacts · {tenant._count.messages} msg</td><td><Status tone={tenant.suspendedAt || tenant.subscription?.status === 'EXPIRED' ? 'danger' : tenant.subscription?.status === 'EXPIRING' ? 'warning' : 'success'}>{tenant.suspendedAt ? 'SUSPENDED' : tenant.subscription?.status ?? tenant.status}</Status></td><td><div className="flex min-w-64 flex-wrap gap-1"><button className="button-ghost !px-3 !py-2 text-xs" disabled={action.isPending} onClick={() => action.mutate({ id: tenant.id, operation: tenant.suspendedAt ? 'activate' : 'suspend' })}>{tenant.suspendedAt ? <Radio className="mr-1 inline" size={13} /> : <Ban className="mr-1 inline" size={13} />}{tenant.suspendedAt ? 'Kích hoạt' : 'Khóa'}</button>{([['plan', 'Đổi plan'], ['quota', 'Quota'], ['extend', 'Gia hạn'], ['reset', 'Reset MK'], ['support', 'Support']] as const).map(([operation, label]) => <button key={operation} className="button-ghost !px-3 !py-2 text-xs" disabled={manage.isPending} onClick={() => manage.mutate({ tenant, operation })}>{label}</button>)}</div></td></tr>)}</tbody></table>
      </div>
      <form className="panel grid content-start gap-3 p-5" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}><div><div className="eyebrow">Provisioning</div><h2 className="mt-2 font-semibold">Tạo tenant</h2></div><input className="input" placeholder="Tên công ty" required value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value, tenantSlug: form.tenantSlug || event.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') })} /><input className="input" placeholder="tenant-slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={form.tenantSlug} onChange={(event) => setForm({ ...form, tenantSlug: event.target.value })} /><div className="grid gap-3 sm:grid-cols-2"><input className="input" placeholder="Tên owner" required value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} /><input className="input" type="email" placeholder="Email owner" required value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} /></div><input className="input" type="password" minLength={12} placeholder="Mật khẩu tạm (12+ ký tự mạnh)" required value={form.temporaryPassword} onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })} /><select className="input" value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value })}>{['FREE', 'BASIC', 'PRO', 'BUSINESS', 'ENTERPRISE'].map((plan) => <option key={plan}>{plan}</option>)}</select><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-[var(--muted)]">Bắt đầu<input className="input mt-1" type="date" required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label className="text-xs text-[var(--muted)]">Hết hạn<input className="input mt-1" type="date" required value={form.expirationDate} onChange={(event) => setForm({ ...form, expirationDate: event.target.value })} /></label></div><button className="button-primary" disabled={create.isPending}>{create.isPending ? 'Đang tạo...' : 'Tạo tenant + owner + subscription'}</button></form>
    </div>
    <div className="mt-5 panel p-5"><div className="flex items-center gap-2"><Activity className="text-teal-300" size={17} /><h2 className="font-semibold">Queue & worker</h2></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{Object.entries(data?.queue ?? {}).map(([name, counts]) => <div className="rounded-xl border border-[var(--border)] p-4" key={name}><div className="text-xs font-semibold text-teal-300">{name}</div><div className="mt-3 text-xs leading-6 text-[var(--muted)]">Waiting {String(counts.waiting ?? 0)} · Active {String(counts.active ?? 0)}<br />Failed {String(counts.failed ?? 0)} · Delayed {String(counts.delayed ?? 0)}<br />{counts.paused ? 'PAUSED' : 'RUNNING'}</div></div>)}</div></div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2"><div className="panel overflow-x-auto"><div className="border-b border-[var(--border)] p-5"><div className="eyebrow">Subscription catalogue</div><h2 className="mt-2 font-semibold">Plans & quota</h2></div><table className="data-table"><thead><tr><th>Plan</th><th>OA</th><th>Contact</th><th>Message/tháng</th><th></th></tr></thead><tbody>{plans.data?.map((plan) => <tr key={plan.id}><td className="font-medium">{plan.code}<div className="text-xs text-[var(--muted)]">{plan.name}</div></td><td>{plan.maxZaloAccounts}</td><td>{plan.maxContacts.toLocaleString('vi-VN')}</td><td>{plan.maxMessagesPerMonth.toLocaleString('vi-VN')}</td><td><button className="button-ghost !px-3 !py-2 text-xs" disabled={editPlan.isPending} onClick={() => editPlan.mutate(plan)}>Sửa</button></td></tr>)}</tbody></table></div><div className="panel p-5"><div className="eyebrow">Compliance</div><h2 className="mt-2 font-semibold">Global suppression</h2><form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); suppress.mutate(); }}><input className="input" required placeholder="Số điện thoại" value={suppression.phone} onChange={(event) => setSuppression({ ...suppression, phone: event.target.value })} /><input className="input" required placeholder="Lý do" value={suppression.reason} onChange={(event) => setSuppression({ ...suppression, reason: event.target.value })} /><button className="button-primary">Chặn</button></form><div className="mt-4 max-h-56 space-y-2 overflow-auto">{suppressions.data?.map((entry) => <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm" key={entry.id}><span className="flex-1">{entry.normalizedPhone ?? `${entry.platform}:${entry.platformUserId}`}</span><span className="text-xs text-[var(--muted)]">{entry.reason}</span><button className="text-xs text-rose-300" onClick={() => unsuppress.mutate(entry.id)}>Xóa</button></div>)}</div></div></div>
    <div className="panel mt-5 overflow-x-auto"><div className="border-b border-[var(--border)] p-5"><div className="eyebrow">Immutable trail</div><h2 className="mt-2 font-semibold">Admin audit gần nhất</h2></div><table className="data-table"><thead><tr><th>Thời gian</th><th>Hành động</th><th>Tenant</th><th>Người thực hiện</th><th>Kết quả</th></tr></thead><tbody>{logs.data?.slice(0, 30).map((item) => <tr key={item.id}><td className="text-xs">{new Date(item.createdAt).toLocaleString('vi-VN')}</td><td className="font-medium">{item.action}<div className="text-xs text-[var(--muted)]">{item.resource}</div></td><td>{item.workspace?.name ?? 'SYSTEM'}</td><td>{item.user?.email ?? 'System'}</td><td><Status tone={item.result === 'SUCCESS' ? 'success' : 'danger'}>{item.result}</Status></td></tr>)}</tbody></table></div>
  </AppShell>;
}
