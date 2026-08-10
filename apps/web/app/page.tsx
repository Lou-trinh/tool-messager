'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, ContactRound, Inbox, Megaphone, UsersRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { Empty, Metric, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface WorkspaceItem { role: string; workspace: { id: string; name: string; slug: string } }
interface WorkspaceDetail { name: string; _count: { accounts: number; contacts: number; groups: number; conversations: number; campaigns: number; posts: number } }

export default function DashboardPage() {
  const router = useRouter(); const token = useSession((state) => state.accessToken); const workspaceId = useSession((state) => state.workspaceId); const setWorkspace = useSession((state) => state.setWorkspace);
  useEffect(() => { if (token === null) router.replace('/login'); }, [router, token]);
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: () => api<WorkspaceItem[]>('/workspaces'), enabled: Boolean(token) });
  useEffect(() => { const first = workspaces.data?.[0]?.workspace.id; if (!workspaceId && first) setWorkspace(first); }, [setWorkspace, workspaceId, workspaces.data]);
  const detail = useQuery({ queryKey: ['workspace', workspaceId], queryFn: () => api<WorkspaceDetail>(`/workspaces/${workspaceId}`), enabled: Boolean(workspaceId) });
  const counts = detail.data?._count;
  return <AppShell title={detail.data?.name ?? 'Tổng quan vận hành'} subtitle="Theo dõi tài khoản, dữ liệu, campaign và lớp an toàn từ một control plane."><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Tài khoản" value={counts?.accounts ?? '—'} detail="Kết nối qua OAuth/API chính thức" icon={<UsersRound size={18} />} /><Metric label="Danh bạ" value={counts?.contacts ?? '—'} detail="Consent-aware · Multi-platform" icon={<ContactRound size={18} />} /><Metric label="Hội thoại" value={counts?.conversations ?? '—'} detail="Unified inbox" icon={<Inbox size={18} />} /><Metric label="Chiến dịch" value={counts?.campaigns ?? '—'} detail="Approval + queue + rate limit" icon={<Megaphone size={18} />} /></div><div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_.65fr]"><div className="panel p-5"><div className="flex items-center justify-between"><div><div className="eyebrow">Delivery pipeline</div><h2 className="mt-2 font-semibold">Smart Safety Layer</h2></div><Status tone="success">Active</Status></div><div className="mt-6 grid gap-3 sm:grid-cols-3">{['Policy + permission', 'Consent + suppression', 'Rate limit + capability'].map((item, index) => <div className="rounded-xl border border-[var(--border)] bg-black/10 p-4" key={item}><div className="text-xs text-teal-300">0{index + 1}</div><div className="mt-2 text-sm font-semibold">{item}</div><p className="mt-2 text-xs leading-5 text-[var(--muted)]">Fail-closed trước khi tạo job gửi.</p></div>)}</div></div><div className="panel p-5"><div className="eyebrow">Platform readiness</div><div className="mt-5 space-y-4">{['Zalo', 'Facebook', 'TikTok'].map((platform) => <div className="flex items-center justify-between" key={platform}><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[.04]"><Bot size={15} /></span><span className="text-sm font-medium">{platform}</span></div><Status tone="warning">Not configured</Status></div>)}</div></div></div>{!token && <div className="mt-5"><Empty title="Đang chuyển tới trang đăng nhập" description="Dashboard yêu cầu phiên xác thực hợp lệ." /></div>}</AppShell>;
}
