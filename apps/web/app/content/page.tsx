'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface Account { id: string; platform: 'ZALO' | 'FACEBOOK' | 'TIKTOK'; displayName: string }
interface PostRecord { id: string; title?: string; content: string; platform: string; status: string; scheduledAt?: string; account: { displayName: string } }

export default function ContentPage() {
  const workspaceId = useSession((state) => state.workspaceId);
  const client = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts', workspaceId], queryFn: () => api<Account[]>(`/workspaces/${workspaceId}/accounts`), enabled: Boolean(workspaceId) });
  const posts = useQuery({ queryKey: ['posts', workspaceId], queryFn: () => api<PostRecord[]>(`/workspaces/${workspaceId}/posts`), enabled: Boolean(workspaceId) });
  const [form, setForm] = useState({ accountId: '', title: '', content: '', scheduledAt: '' });
  const create = useMutation({ mutationFn: async () => { const account = accounts.data?.find((item) => item.id === form.accountId); if (!account) throw new Error('Chọn tài khoản trước.'); const post = await api<PostRecord>(`/workspaces/${workspaceId}/posts`, { method: 'POST', body: JSON.stringify({ accountId: account.id, platform: account.platform, title: form.title || undefined, content: form.content }) }); if (form.scheduledAt) await api(`/workspaces/${workspaceId}/posts/${post.id}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt: new Date(form.scheduledAt).toISOString(), timezone: 'Asia/Ho_Chi_Minh' }) }); return post; }, onSuccess: async () => { setForm({ accountId: '', title: '', content: '', scheduledAt: '' }); await client.invalidateQueries({ queryKey: ['posts', workspaceId] }); } });
  const publish = useMutation({ mutationFn: (postId: string) => api(`/workspaces/${workspaceId}/posts/${postId}/publish`, { method: 'POST' }), onSuccess: () => client.invalidateQueries({ queryKey: ['posts', workspaceId] }) });
  return <AppShell title="Content Studio" subtitle="Soạn, phê duyệt, lên lịch và publish qua official platform adapter.">
    <form className="panel mb-5 grid gap-3 p-5 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
      <select className="input" required value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}><option value="">Chọn tài khoản</option>{accounts.data?.map((item) => <option value={item.id} key={item.id}>{item.displayName} · {item.platform}</option>)}</select>
      <input className="input" placeholder="Tiêu đề nội bộ" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
      <textarea className="input min-h-28 md:col-span-2" required placeholder="Nội dung bài đăng" value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} />
      <input className="input" type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })} />
      <button className="button-primary" disabled={create.isPending}>{form.scheduledAt ? 'Tạo và lên lịch' : 'Lưu bản nháp'}</button>
    </form>
    {(create.error || publish.error) && <p className="mb-4 text-sm text-rose-400">{(create.error ?? publish.error)?.message}</p>}
    {posts.data?.length ? <div className="panel overflow-x-auto"><table className="data-table"><thead><tr><th>Bài đăng</th><th>Tài khoản</th><th>Platform</th><th>Lịch</th><th>Trạng thái</th><th></th></tr></thead><tbody>{posts.data.map((post) => <tr key={post.id}><td><div className="font-medium">{post.title ?? post.content.slice(0, 48)}</div><div className="mt-1 max-w-md truncate text-xs text-[var(--muted)]">{post.content}</div></td><td>{post.account.displayName}</td><td>{post.platform}</td><td>{post.scheduledAt ? new Date(post.scheduledAt).toLocaleString('vi-VN') : '—'}</td><td><Status tone={post.status === 'PUBLISHED' ? 'success' : post.status === 'FAILED' ? 'danger' : 'warning'}>{post.status}</Status></td><td>{post.status === 'DRAFT' && <button className="button-ghost" onClick={() => publish.mutate(post.id)}>Publish</button>}</td></tr>)}</tbody></table></div> : <Empty title="Chưa có bài đăng" description="Kết nối tài khoản API chính thức, sau đó tạo bản nháp hoặc lên lịch nội dung." />}
  </AppShell>;
}
