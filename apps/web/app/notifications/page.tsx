'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

type NotificationItem = {
  id: string;
  channel: string;
  event: string;
  title: string;
  body: string;
  readAt?: string;
  createdAt: string;
};

export default function NotificationsPage() {
  const workspaceId = useSession((state) => state.workspaceId);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['notifications', workspaceId], queryFn: () => api<NotificationItem[]>(`/workspaces/${workspaceId}/notifications`), enabled: Boolean(workspaceId), refetchInterval: 30_000 });
  const read = useMutation({ mutationFn: (id: string) => api(`/workspaces/${workspaceId}/notifications/${id}/read`, { method: 'PATCH' }), onSuccess: () => client.invalidateQueries({ queryKey: ['notifications', workspaceId] }) });

  return <AppShell title="Thông báo" subtitle="Cảnh báo subscription, campaign và vận hành được lưu theo từng tenant.">
    {query.data?.length ? <div className="grid gap-3">{query.data.map((item) => <article className={`panel flex flex-wrap items-start gap-4 p-5 ${item.readAt ? 'opacity-70' : ''}`} key={item.id}>
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-400/10 text-teal-300"><Bell size={18} /></div>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{item.title}</h2><Status tone={item.readAt ? 'neutral' : 'warning'}>{item.readAt ? 'ĐÃ ĐỌC' : 'MỚI'}</Status></div><p className="mt-2 text-sm text-[var(--muted)]">{item.body}</p><div className="mt-2 text-xs text-[var(--muted)]">{item.event} · {item.channel} · {new Date(item.createdAt).toLocaleString('vi-VN')}</div></div>
      {!item.readAt && <button className="button-ghost text-xs" disabled={read.isPending} onClick={() => read.mutate(item.id)}><Check className="mr-1 inline" size={14} />Đánh dấu đã đọc</button>}
    </article>)}</div> : <Empty title="Chưa có thông báo" description="Các cảnh báo vận hành và subscription sẽ xuất hiện tại đây." />}
  </AppShell>;
}
