'use client';

import { Activity, Bell, CalendarDays, ChevronDown, ContactRound, CreditCard, Crown, FileStack, Inbox, LayoutDashboard, Megaphone, Network, Search, Settings, ShieldCheck, UsersRound, Workflow, Zap } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface WorkspaceItem {
  role: string;
  supportSessionId?: string;
  supportExpiresAt?: string;
  workspace: { id: string; name: string };
}
interface CurrentUser { systemRole: 'SUPER_ADMIN' | 'USER' }

const nav = [
  { label: 'Tổng quan', href: '/', icon: LayoutDashboard },
  { group: 'Social' },
  { label: 'Tài khoản', href: '/accounts', icon: UsersRound },
  { label: 'Hộp thư', href: '/inbox', icon: Inbox },
  { label: 'Danh bạ', href: '/contacts', icon: ContactRound },
  { group: 'Messaging' },
  { label: 'Chiến dịch', href: '/campaigns', icon: Megaphone },
  { label: 'Mẫu tin nhắn', href: '/templates', icon: FileStack },
  { label: 'Automation', href: '/automations', icon: Workflow },
  { group: 'Content' },
  { label: 'Content Studio', href: '/content', icon: FileStack },
  { label: 'Lịch nội dung', href: '/calendar', icon: CalendarDays },
  { label: 'Nhóm', href: '/groups', icon: UsersRound },
  { group: 'Control' },
  { label: 'Phân tích', href: '/analytics', icon: Activity },
  { label: 'Proxy', href: '/proxies', icon: Network },
  { label: 'Nhật ký audit', href: '/audit', icon: ShieldCheck },
  { label: 'Nền tảng', href: '/platforms', icon: Network },
  { label: 'Cài đặt', href: '/settings', icon: Settings },
] as const;

export function AppShell({ children, title, subtitle, action }: { children: ReactNode; title: string; subtitle: string; action?: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const accessToken = useSession((state) => state.accessToken);
  const workspaceId = useSession((state) => state.workspaceId);
  const hydrated = useSession((state) => state.hydrated);
  const setWorkspace = useSession((state) => state.setWorkspace);
  const clear = useSession((state) => state.clear);
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api<WorkspaceItem[]>('/workspaces'),
    enabled: hydrated && Boolean(accessToken),
    retry: false,
  });
  const me = useQuery({ queryKey: ['auth-me'], queryFn: () => api<CurrentUser>('/auth/me'), enabled: hydrated && Boolean(accessToken), retry: false });

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) {
      router.replace('/login');
      return;
    }
    const firstWorkspaceId = workspaces.data?.[0]?.workspace.id;
    if (!workspaceId && firstWorkspaceId) setWorkspace(firstWorkspaceId);
  }, [accessToken, hydrated, router, setWorkspace, workspaceId, workspaces.data]);

  useEffect(() => {
    if (!hydrated || !workspaces.isError) return;
    clear();
    router.replace('/login');
  }, [clear, hydrated, router, workspaces.isError]);

  if (!hydrated) {
    return <div className="grid min-h-screen place-items-center text-sm text-[var(--muted)]">Đang khôi phục phiên đăng nhập...</div>;
  }

  const currentWorkspace = workspaces.data?.find((item) => item.workspace.id === workspaceId);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[244px_1fr]">
      <aside className="border-r border-[var(--border)] bg-[#090d13]/95 px-4 py-5 lg:sticky lg:top-0 lg:h-screen">
        <div className="mb-7 flex items-center gap-3 px-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-teal-300 to-green-500 text-black"><Zap size={21} strokeWidth={2.6} /></div>
          <div><div className="font-bold tracking-tight">ZaloHub SaaS</div><div className="text-[11px] text-[var(--muted)]">MULTI-TENANT CONTROL</div></div>
        </div>
        <nav className="space-y-1">
          {me.data?.systemRole === 'SUPER_ADMIN' && <Link href="/admin" className={`mb-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${pathname === '/admin' ? 'bg-amber-300/10 text-amber-200' : 'text-amber-200/80 hover:bg-white/[.035]'}`}><Crown size={17} /><span>Quản trị SaaS</span></Link>}
          <Link href="/subscription" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${pathname === '/subscription' ? 'bg-teal-400/10 text-teal-300' : 'text-[#9eabb9] hover:bg-white/[.035] hover:text-white'}`}><CreditCard size={17} /><span>Gói thuê & quota</span></Link>
          <Link href="/notifications" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${pathname === '/notifications' ? 'bg-teal-400/10 text-teal-300' : 'text-[#9eabb9] hover:bg-white/[.035] hover:text-white'}`}><Bell size={17} /><span>Thông báo</span></Link>
          {nav.map((item, index) => 'group' in item ? <div className="px-3 pb-1 pt-5 text-[10px] font-bold uppercase tracking-[.15em] text-[#536174]" key={`${item.group}-${index}`}>{item.group}</div> : (() => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return <Link href={item.href} key={item.href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${active ? 'bg-teal-400/10 text-teal-300' : 'text-[#9eabb9] hover:bg-white/[.035] hover:text-white'}`}><Icon size={17} /><span>{item.label}</span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-teal-300" />}</Link>;
          })())}
        </nav>
        <div className="mt-8 panel p-3">
          <div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} className="text-teal-300" /> Safety layer active</div>
          <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">Consent, suppression, permission và rate-limit đều được kiểm tra trước khi gửi.</p>
        </div>
      </aside>
      <main className="min-w-0">
        <header className="flex min-h-16 items-center gap-4 border-b border-[var(--border)] px-5 lg:px-8">
          <div className="relative hidden max-w-lg flex-1 md:block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#637184]" size={16} /><input className="input !py-2 !pl-9" placeholder="Tìm contact, tin nhắn, nhóm, chiến dịch..." /></div>
          <div className="ml-auto flex items-center gap-3">{workspaces.data && workspaces.data.length > 1 && <select className="input !w-auto !py-2 text-xs" value={workspaceId ?? ''} onChange={(event) => setWorkspace(event.target.value)}>{workspaces.data.map((item) => <option key={item.workspace.id} value={item.workspace.id}>{item.role === 'SUPPORT' ? '[SUPPORT] ' : ''}{item.workspace.name}</option>)}</select>}<button className="button-ghost flex items-center gap-2 text-xs"><Activity size={15} className="text-green-400" /> Hệ thống ổn định</button><button className="button-ghost flex items-center gap-2 text-xs" onClick={() => { clear(); router.push('/login'); }}><span className="grid h-6 w-6 place-items-center rounded-md bg-teal-400/15 text-teal-300">LT</span><ChevronDown size={14} /></button></div>
        </header>
        <div className="px-5 py-7 lg:px-8">
          {currentWorkspace?.role === 'SUPPORT' && <div className="mb-5 rounded-xl border border-amber-300/40 bg-amber-300/10 px-5 py-4 text-sm font-semibold text-amber-100">SUPPORT MODE đang hoạt động cho {currentWorkspace.workspace.name}. Mọi thao tác đều được audit; phiên hết hạn lúc {currentWorkspace.supportExpiresAt ? new Date(currentWorkspace.supportExpiresAt).toLocaleString('vi-VN') : 'không xác định'}.</div>}
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="eyebrow mb-2">Workspace operations</div><h1 className="text-2xl font-bold tracking-tight">{title}</h1><p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{subtitle}</p></div>{action}</div>
          {children}
        </div>
      </main>
    </div>
  );
}
