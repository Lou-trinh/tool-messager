'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface AuditEvent { id: string; action: string; resource: string; resourceId?: string; result: string; createdAt: string; user?: { displayName: string; email: string } }
export default function AuditPage() { const workspaceId = useSession((state) => state.workspaceId); const query = useQuery({ queryKey: ['audit', workspaceId], queryFn: () => api<{ items: AuditEvent[] }>(`/workspaces/${workspaceId}/audit`), enabled: Boolean(workspaceId) }); return <AppShell title="Nhật ký audit" subtitle="Dòng sự kiện bất biến cho các thao tác nhạy cảm trong workspace.">{query.data?.items.length ? <div className="panel overflow-x-auto"><table className="data-table"><thead><tr><th>Thời gian</th><th>Hành động</th><th>Tài nguyên</th><th>Người thực hiện</th><th>Kết quả</th></tr></thead><tbody>{query.data.items.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('vi-VN')}</td><td className="font-medium">{item.action}</td><td>{item.resource}<div className="text-xs text-[var(--muted)]">{item.resourceId}</div></td><td>{item.user?.displayName ?? 'System'}<div className="text-xs text-[var(--muted)]">{item.user?.email}</div></td><td><Status tone={item.result === 'SUCCESS' ? 'success' : 'danger'}>{item.result}</Status></td></tr>)}</tbody></table></div> : <Empty title="Chưa có audit event" description="Sự kiện sẽ xuất hiện khi tài nguyên trong workspace được thay đổi." />}</AppShell>; }
