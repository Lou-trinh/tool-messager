'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { Status } from '@/components/ui';
import { api } from '@/lib/api';

interface Matrix { platform: string; configured: boolean; capabilities: Record<string, string> }
export default function PlatformsPage() { const query = useQuery({ queryKey: ['platform-capabilities'], queryFn: () => api<Matrix[]>('/platforms/capabilities') }); return <AppShell title="Platform Capability Matrix" subtitle="Nguồn sự thật duy nhất về các hành động API hỗ trợ, yêu cầu quyền hoặc bị chặn."><div className="space-y-5">{query.data?.map((entry) => <div className="panel overflow-hidden" key={entry.platform}><div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4"><div><div className="font-semibold">{entry.platform}</div><div className="mt-1 text-xs text-[var(--muted)]">Official adapter</div></div><Status tone={entry.configured ? 'success' : 'warning'}>{entry.configured ? 'CONFIGURED' : 'NOT_CONFIGURED'}</Status></div><div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">{Object.entries(entry.capabilities).map(([name, status]) => <div className="bg-[var(--panel)] p-4" key={name}><div className="text-xs font-semibold">{name}</div><div className="mt-2 text-[11px] text-[var(--muted)]">{status}</div></div>)}</div></div>)}</div></AppShell>; }
