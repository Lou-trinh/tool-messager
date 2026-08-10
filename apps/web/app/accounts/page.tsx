'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface Account { id: string; platform: string; displayName: string; username?: string; status: string; lastSyncAt?: string; lastErrorCode?: string }
export default function AccountsPage() {
  const workspaceId = useSession((state) => state.workspaceId); const query = useQuery({ queryKey: ['accounts', workspaceId], queryFn: () => api<Account[]>(`/workspaces/${workspaceId}/accounts`), enabled: Boolean(workspaceId) });
  return <AppShell title="Tài khoản social" subtitle="Kết nối và theo dõi quyền API, token expiry, trạng thái đồng bộ." action={<button className="button-primary">Kết nối tài khoản</button>}>{query.data?.length ? <div className="panel overflow-x-auto"><table className="data-table"><thead><tr><th>Tài khoản</th><th>Nền tảng</th><th>Trạng thái</th><th>Đồng bộ cuối</th><th>Capability</th></tr></thead><tbody>{query.data.map((account) => <tr key={account.id}><td><div className="font-medium">{account.displayName}</div><div className="mt-1 text-xs text-[var(--muted)]">@{account.username ?? 'not-set'}</div></td><td>{account.platform}</td><td><Status tone={account.status === 'CONNECTED' ? 'success' : 'warning'}>{account.status}</Status></td><td className="text-sm text-[var(--muted)]">{account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString('vi-VN') : 'Chưa đồng bộ'}</td><td className="text-xs text-[var(--muted)]">{account.lastErrorCode ?? 'API-dependent'}</td></tr>)}</tbody></table></div> : <Empty title="Chưa kết nối tài khoản" description="Chỉ OAuth và API chính thức được chấp nhận. Credential được mã hóa và không lưu mật khẩu social." />}</AppShell>;
}
