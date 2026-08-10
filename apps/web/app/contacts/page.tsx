'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface Contact { id: string; displayName: string; platform: string; email?: string; normalizedPhone?: string; source?: string; consentStatus: string; suppressed: boolean }
interface ContactsResponse { items: Contact[]; pagination: { total: number } }
export default function ContactsPage() {
  const workspaceId = useSession((state) => state.workspaceId); const query = useQuery({ queryKey: ['contacts', workspaceId], queryFn: () => api<ContactsResponse>(`/workspaces/${workspaceId}/contacts?limit=50`), enabled: Boolean(workspaceId) });
  return <AppShell title="CRM & Consent" subtitle={`${query.data?.pagination.total ?? 0} contacts · Dedupe, tagging, consent history và suppression.`} action={<div className="flex gap-2"><button className="button-ghost">Nhập dữ liệu</button><button className="button-primary">Thêm contact</button></div>}>{query.data?.items.length ? <div className="panel overflow-x-auto"><table className="data-table"><thead><tr><th>Contact</th><th>Platform</th><th>Liên hệ</th><th>Nguồn</th><th>Consent</th></tr></thead><tbody>{query.data.items.map((contact) => <tr key={contact.id}><td className="font-medium">{contact.displayName}</td><td>{contact.platform}</td><td><div className="text-sm">{contact.normalizedPhone ?? contact.email ?? '—'}</div></td><td className="text-sm text-[var(--muted)]">{contact.source ?? 'Manual'}</td><td><Status tone={contact.suppressed ? 'danger' : contact.consentStatus === 'OPTED_IN' ? 'success' : 'warning'}>{contact.suppressed ? 'SUPPRESSED' : contact.consentStatus}</Status></td></tr>)}</tbody></table></div> : <Empty title="Danh bạ đang trống" description="Import CSV/Excel/JSON phải khai báo nguồn và trạng thái consent; hệ thống không dò số điện thoại." />}</AppShell>;
}
