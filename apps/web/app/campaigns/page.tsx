'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pause, Play, Send, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

type Campaign = { id: string; name: string; platform: string; status: string; promotional: boolean; scheduledAt?: string; statistics: Record<string, number>; account?: { displayName: string }; template?: { name: string; version: number }; _count: { audience: number; messages: number } };
type CampaignDetail = Campaign & { audience: Array<{ id: string; status: string; excludedReason?: string; contact: { id: string; displayName: string; consentStatus: string; suppressed: boolean } }>; messages: unknown[] };
type Account = { id: string; displayName: string; platform: string; status: string };
type Template = { id: string; name: string; version: number; status: string };
type Contact = { id: string; displayName: string; platform: string; consentStatus: string; suppressed: boolean; platformUserId?: string; source: string };
type ContactsResponse = { items: Contact[]; pagination: { total: number } };
type Segment = { id: string; name: string; estimatedSize: number };

export default function CampaignsPage() {
  const workspaceId = useSession((state) => state.workspaceId);
  const client = useQueryClient();
  const [selectedCampaign, setSelectedCampaign] = useState<string>();
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', accountId: '', templateId: '', contactIds: [] as string[], segmentId: '', promotional: true });
  const campaigns = useQuery({ queryKey: ['campaigns', workspaceId], queryFn: () => api<Campaign[]>(`/workspaces/${workspaceId}/campaigns`), enabled: Boolean(workspaceId), refetchInterval: 15_000 });
  const accounts = useQuery({ queryKey: ['accounts', workspaceId], queryFn: () => api<Account[]>(`/workspaces/${workspaceId}/accounts`), enabled: Boolean(workspaceId) });
  const templates = useQuery({ queryKey: ['templates', workspaceId], queryFn: () => api<Template[]>(`/workspaces/${workspaceId}/templates`), enabled: Boolean(workspaceId) });
  const contacts = useQuery({ queryKey: ['campaign-contacts', workspaceId], queryFn: () => api<ContactsResponse>(`/workspaces/${workspaceId}/contacts?limit=100`), enabled: Boolean(workspaceId) });
  const segments = useQuery({ queryKey: ['segments', workspaceId], queryFn: () => api<Segment[]>(`/workspaces/${workspaceId}/segments`), enabled: Boolean(workspaceId) });
  const detail = useQuery({ queryKey: ['campaign-detail', workspaceId, selectedCampaign], queryFn: () => api<CampaignDetail>(`/workspaces/${workspaceId}/campaigns/${selectedCampaign}`), enabled: Boolean(workspaceId && selectedCampaign) });
  const refresh = async () => { await client.invalidateQueries({ queryKey: ['campaigns', workspaceId] }); if (selectedCampaign) await client.invalidateQueries({ queryKey: ['campaign-detail', workspaceId, selectedCampaign] }); };
  const create = useMutation({ mutationFn: () => api<Campaign>(`/workspaces/${workspaceId}/campaigns`, { method: 'POST', body: JSON.stringify({ ...form, ...(form.segmentId ? { contactIds: undefined } : { segmentId: undefined }) }) }), onSuccess: async (created) => { setForm({ name: '', accountId: '', templateId: '', contactIds: [], segmentId: '', promotional: true }); setSelectedCampaign(created.id); setError(''); await refresh(); }, onError: (cause: Error) => setError(cause.message) });
  const workflow = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'approve' | 'launch' | 'schedule' | 'pause' | 'resume' | 'cancel' }) => {
      if (action === 'schedule') {
        const value = window.prompt('Thời gian gửi (YYYY-MM-DD HH:mm theo giờ máy của bạn)');
        if (!value) return;
        return api(`/workspaces/${workspaceId}/campaigns/${id}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt: new Date(value).toISOString() }) });
      }
      return api(`/workspaces/${workspaceId}/campaigns/${id}/${action}`, { method: 'POST' });
    },
    onSuccess: async () => { setError(''); await refresh(); },
    onError: (cause: Error) => setError(cause.message),
  });
  const selectedAccount = accounts.data?.find((account) => account.id === form.accountId);
  const eligible = contacts.data?.items.filter((contact) => selectedAccount
    && contact.platform === selectedAccount.platform
    && Boolean(contact.platformUserId?.trim())
    && contact.source !== 'SYNTHETIC_SEED'
    && !contact.suppressed
    && (!form.promotional || contact.consentStatus === 'OPTED_IN')) ?? [];
  const toggleContact = (id: string) => setForm((current) => ({ ...current, contactIds: current.contactIds.includes(id) ? current.contactIds.filter((value) => value !== id) : [...current.contactIds, id] }));

  return <AppShell title="Chiến dịch tin nhắn" subtitle="Tạo → preview consent → phê duyệt → queue → worker. Không có gửi đồng bộ trong request API.">
    {error && <div className="mb-5 rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
    <form className="panel mb-5 grid gap-4 p-5" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}>
      <div><div className="eyebrow">Campaign builder</div><h2 className="mt-2 font-semibold">Tạo bản nháp chiến dịch</h2></div>
      <div className="grid gap-3 md:grid-cols-3"><input className="input" required placeholder="Tên chiến dịch" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><select className="input" required value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value, contactIds: [] })}><option value="">Chọn Zalo OA đã kết nối</option>{accounts.data?.filter((account) => account.status === 'CONNECTED').map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select><select className="input" required value={form.templateId} onChange={(event) => setForm({ ...form, templateId: event.target.value })}><option value="">Chọn template</option>{templates.data?.filter((template) => template.status === 'ACTIVE').map((template) => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}</select></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.promotional} onChange={(event) => setForm({ ...form, promotional: event.target.checked, contactIds: [] })} /> Nội dung quảng bá (chỉ contact OPTED_IN)</label>
      <select className="input" value={form.segmentId} onChange={(event) => setForm({ ...form, segmentId: event.target.value, contactIds: [] })}><option value="">Chọn thủ công từ 100 contact gần nhất</option>{segments.data?.map((segment) => <option key={segment.id} value={segment.id}>{segment.name} · khoảng {segment.estimatedSize.toLocaleString('vi-VN')} contact</option>)}</select>
      {!form.segmentId && <div className="max-h-52 overflow-auto rounded-xl border border-[var(--border)] p-3"><div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--muted)]"><span>{selectedAccount ? `${eligible.length} contact ${selectedAccount.platform} có user_id hợp lệ và đủ điều kiện` : 'Chọn tài khoản gửi để lọc đúng người nhận'}</span><button type="button" className="shrink-0 text-teal-300 disabled:cursor-not-allowed disabled:opacity-40" disabled={!eligible.length} onClick={() => setForm({ ...form, contactIds: eligible.map((contact) => contact.id) })}>Chọn tất cả</button></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{eligible.map((contact) => <label className="flex items-center gap-2 rounded-lg bg-white/[.025] px-3 py-2 text-sm" key={contact.id}><input type="checkbox" checked={form.contactIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} /><span className="truncate">{contact.displayName}</span><span className="ml-auto text-[10px] text-[var(--muted)]">{contact.consentStatus}</span></label>)}</div>{selectedAccount && eligible.length === 0 && <div className="py-5 text-center text-sm text-[var(--muted)]">Chưa có contact {selectedAccount.platform} thật với user_id và consent phù hợp.</div>}</div>}
      <button className="button-primary justify-self-start" disabled={create.isPending || (!form.contactIds.length && !form.segmentId)}>{create.isPending ? 'Đang tạo…' : form.segmentId ? 'Tạo bản nháp từ segment' : `Tạo bản nháp (${form.contactIds.length} contact)`}</button>
    </form>
    {campaigns.data?.length ? <div className="panel overflow-x-auto"><table className="data-table"><thead><tr><th>Chiến dịch</th><th>Audience</th><th>Trạng thái</th><th>Kết quả</th><th>Điều khiển</th></tr></thead><tbody>{campaigns.data.map((campaign) => <tr key={campaign.id}><td><div className="font-medium">{campaign.name}</div><div className="mt-1 text-xs text-[var(--muted)]">{campaign.account?.displayName ?? 'No account'} · {campaign.template?.name ?? 'No template'}</div></td><td>{campaign._count.audience.toLocaleString('vi-VN')}<div className="text-xs text-[var(--muted)]">{campaign.promotional ? 'Promotional' : 'Transactional'}</div></td><td><Status tone={campaign.status === 'RUNNING' || campaign.status === 'COMPLETED' ? 'success' : campaign.status === 'FAILED' || campaign.status === 'CANCELLED' ? 'danger' : 'warning'}>{campaign.status}</Status></td><td className="text-xs text-[var(--muted)]">{JSON.stringify(campaign.statistics)}</td><td><div className="flex min-w-60 flex-wrap gap-1"><button className="button-ghost !px-3 !py-2 text-xs" onClick={() => setSelectedCampaign(campaign.id)}><Eye className="mr-1 inline" size={13} />Preview</button>{['DRAFT', 'PENDING_APPROVAL'].includes(campaign.status) && <button className="button-ghost !px-3 !py-2 text-xs" onClick={() => workflow.mutate({ id: campaign.id, action: 'approve' })}>Duyệt</button>}{campaign.status === 'APPROVED' && <><button className="button-ghost !px-3 !py-2 text-xs" onClick={() => workflow.mutate({ id: campaign.id, action: 'schedule' })}>Hẹn giờ</button><button className="button-ghost !px-3 !py-2 text-xs" onClick={() => workflow.mutate({ id: campaign.id, action: 'launch' })}><Send className="mr-1 inline" size={13} />Queue ngay</button></>}{['RUNNING', 'SCHEDULED'].includes(campaign.status) && <button className="button-ghost !px-3 !py-2 text-xs" onClick={() => workflow.mutate({ id: campaign.id, action: 'pause' })}><Pause className="mr-1 inline" size={13} />Pause</button>}{campaign.status === 'PAUSED' && <button className="button-ghost !px-3 !py-2 text-xs" onClick={() => workflow.mutate({ id: campaign.id, action: 'resume' })}><Play className="mr-1 inline" size={13} />Resume</button>}{!['COMPLETED', 'FAILED', 'CANCELLED'].includes(campaign.status) && <button className="button-ghost !px-3 !py-2 text-xs" onClick={() => workflow.mutate({ id: campaign.id, action: 'cancel' })}><XCircle className="mr-1 inline" size={13} />Hủy</button>}</div></td></tr>)}</tbody></table></div> : <Empty title="Chưa có chiến dịch" description="Hãy kết nối Zalo OA, tạo template và import contact có consent trước." />}
    {detail.data && <div className="panel mt-5 p-5"><div className="flex items-center justify-between"><div><div className="eyebrow">Consent preview</div><h2 className="mt-2 font-semibold">{detail.data.name}</h2></div><button className="button-ghost" onClick={() => setSelectedCampaign(undefined)}>Đóng</button></div><div className="mt-4 grid gap-2 md:grid-cols-2">{detail.data.audience.map((member) => <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm" key={member.id}><span className="min-w-0 flex-1 truncate">{member.contact.displayName}</span><Status tone={member.status === 'INCLUDED' ? 'success' : 'danger'}>{member.status}</Status><span className="text-xs text-[var(--muted)]">{member.excludedReason ?? member.contact.consentStatus}</span></div>)}</div></div>}
  </AppShell>;
}
