'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface CalendarPost { id: string; title?: string; content: string; platform: string; status: string; scheduledAt?: string; account: { displayName: string } }
export default function CalendarPage() { const workspaceId = useSession((state) => state.workspaceId); const range = { from: new Date(Date.now() - 7 * 86_400_000).toISOString(), to: new Date(Date.now() + 90 * 86_400_000).toISOString() }; const query = useQuery({ queryKey: ['calendar', workspaceId], queryFn: () => api<CalendarPost[]>(`/workspaces/${workspaceId}/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`), enabled: Boolean(workspaceId) }); return <AppShell title="Lịch nội dung" subtitle="Lịch publish 90 ngày, đồng bộ trực tiếp từ scheduler.">{query.data?.length ? <div className="grid gap-3">{query.data.map((post) => <div className="panel flex flex-wrap items-center gap-4 p-5" key={post.id}><div className="min-w-40"><div className="text-xs uppercase text-[var(--muted)]">{post.scheduledAt ? new Date(post.scheduledAt).toLocaleString('vi-VN') : 'Chưa lên lịch'}</div><div className="mt-1 font-semibold">{post.title ?? post.content.slice(0, 64)}</div></div><div className="ml-auto text-sm text-[var(--muted)]">{post.account.displayName} · {post.platform}</div><Status tone={post.status === 'PUBLISHED' ? 'success' : 'warning'}>{post.status}</Status></div>)}</div> : <Empty title="Lịch đang trống" description="Các bài được schedule trong Content Studio sẽ xuất hiện tại đây." />}</AppShell>; }
