'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface GroupRecord { id: string; name: string; platform: string; memberCount: number; status: string; lastSyncAt?: string; account?: { displayName: string }; _count: { members: number } }
export default function GroupsPage() { const workspaceId = useSession((state) => state.workspaceId); const query = useQuery({ queryKey: ['groups', workspaceId], queryFn: () => api<GroupRecord[]>(`/workspaces/${workspaceId}/groups`), enabled: Boolean(workspaceId) }); return <AppShell title="Nhóm và thành viên" subtitle="Dữ liệu nhóm được đồng bộ qua capability chính thức của từng nền tảng.">{query.data?.length ? <div className="panel overflow-x-auto"><table className="data-table"><thead><tr><th>Nhóm</th><th>Nền tảng</th><th>Tài khoản</th><th>Thành viên</th><th>Đồng bộ</th><th>Trạng thái</th></tr></thead><tbody>{query.data.map((item) => <tr key={item.id}><td className="font-medium">{item.name}</td><td>{item.platform}</td><td>{item.account?.displayName ?? '—'}</td><td>{item._count.members || item.memberCount}</td><td>{item.lastSyncAt ? new Date(item.lastSyncAt).toLocaleString('vi-VN') : 'Chưa sync'}</td><td><Status tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>{item.status}</Status></td></tr>)}</tbody></table></div> : <Empty title="Chưa có dữ liệu nhóm" description="Nút sync tài khoản sẽ trả NOT_CONFIGURED hoặc NOT_SUPPORTED khi official API chưa khả dụng; hệ thống không scraping." />}</AppShell>; }
