'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface Automation { id: string; name: string; description?: string; status: string; triggers: Array<{ type: string }>; actions: Array<{ type: string }>; updatedAt: string }

export default function AutomationsPage() {
  const workspaceId = useSession((state) => state.workspaceId);
  const client = useQueryClient();
  const [form, setForm] = useState({ name: '', triggerType: 'CONTACT_CREATED', actionType: 'SEND_MESSAGE' });
  const query = useQuery({ queryKey: ['automations', workspaceId], queryFn: () => api<Automation[]>(`/workspaces/${workspaceId}/automations`), enabled: Boolean(workspaceId) });
  const create = useMutation({ mutationFn: () => api<Automation>(`/workspaces/${workspaceId}/automations`, { method: 'POST', body: JSON.stringify(form) }), onSuccess: async () => { setForm({ name: '', triggerType: 'CONTACT_CREATED', actionType: 'SEND_MESSAGE' }); await client.invalidateQueries({ queryKey: ['automations', workspaceId] }); } });
  const status = useMutation({ mutationFn: ({ id, value }: { id: string; value: string }) => api(`/workspaces/${workspaceId}/automations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: value }) }), onSuccess: () => client.invalidateQueries({ queryKey: ['automations', workspaceId] }) });
  return <AppShell title="Automation" subtitle="Trigger và action được lưu phiên bản; chỉ workflow hợp lệ mới có thể kích hoạt.">
    <form className="panel mb-5 grid gap-3 p-5 md:grid-cols-[1fr_220px_220px_auto]" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
      <input className="input" placeholder="Tên automation" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <select className="input" value={form.triggerType} onChange={(event) => setForm({ ...form, triggerType: event.target.value })}><option>CONTACT_CREATED</option><option>CAMPAIGN_COMPLETED</option><option>SCHEDULE</option></select>
      <select className="input" value={form.actionType} onChange={(event) => setForm({ ...form, actionType: event.target.value })}><option>SEND_MESSAGE</option><option>ADD_TAG</option><option>CREATE_TASK</option></select>
      <button className="button-primary" disabled={create.isPending}>Tạo workflow</button>
    </form>
    {create.error && <p className="mb-4 text-sm text-rose-400">{create.error.message}</p>}
    {query.data?.length ? <div className="grid gap-4 md:grid-cols-2">{query.data.map((item) => <div className="panel p-5" key={item.id}><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{item.name}</h3><p className="mt-2 text-sm text-[var(--muted)]">{item.triggers[0]?.type ?? 'No trigger'} → {item.actions[0]?.type ?? 'No action'}</p></div><Status tone={item.status === 'ACTIVE' ? 'success' : 'warning'}>{item.status}</Status></div><button className="button-ghost mt-5" onClick={() => status.mutate({ id: item.id, value: item.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' })}>{item.status === 'ACTIVE' ? 'Tạm dừng' : 'Kích hoạt'}</button></div>)}</div> : <Empty title="Chưa có automation" description="Tạo workflow đầu tiên; worker chỉ thực hiện những action đã qua permission và safety gate." />}
  </AppShell>;
}
