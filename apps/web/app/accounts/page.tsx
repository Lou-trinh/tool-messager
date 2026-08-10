'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface Account {
  id: string;
  platform: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  status: string;
  tokenExpiresAt?: string;
  lastSyncAt?: string;
  lastErrorCode?: string;
}

interface OAuthStart {
  authorizationUrl: string;
  callbackUrl: string;
  expiresAt: string;
}

interface Notice {
  tone: 'success' | 'danger';
  text: string;
}

export default function AccountsPage() {
  const workspaceId = useSession((state) => state.workspaceId);
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<Notice | null>(null);

  const query = useQuery({
    queryKey: ['accounts', workspaceId],
    queryFn: () => api<Account[]>(`/workspaces/${workspaceId}/accounts`),
    enabled: Boolean(workspaceId),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connection') !== 'zalo') return;
    if (params.get('status') === 'success') {
      setNotice({ tone: 'success', text: 'Đã kết nối Zalo Official Account thành công.' });
      void queryClient.invalidateQueries({ queryKey: ['accounts', workspaceId] });
    } else {
      setNotice({ tone: 'danger', text: params.get('reason') ?? 'Kết nối Zalo OA thất bại.' });
    }
    window.history.replaceState({}, '', window.location.pathname);
  }, [queryClient, workspaceId]);

  const connect = useMutation({
    mutationFn: () => api<OAuthStart>(`/workspaces/${workspaceId}/accounts/zalo/oauth/start`, { method: 'POST' }),
    onSuccess: ({ authorizationUrl }) => { window.location.assign(authorizationUrl); },
    onError: (error: Error) => setNotice({ tone: 'danger', text: error.message }),
  });

  const refresh = useMutation({
    mutationFn: (accountId: string) => api<{ refreshed: true }>(`/workspaces/${workspaceId}/accounts/${accountId}/zalo/refresh`, { method: 'POST' }),
    onSuccess: async () => {
      setNotice({ tone: 'success', text: 'Đã làm mới Zalo access token.' });
      await queryClient.invalidateQueries({ queryKey: ['accounts', workspaceId] });
    },
    onError: (error: Error) => setNotice({ tone: 'danger', text: error.message }),
  });

  const disconnect = useMutation({
    mutationFn: (accountId: string) => api<Account>(`/workspaces/${workspaceId}/accounts/${accountId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setNotice({ tone: 'success', text: 'Đã ngắt kết nối tài khoản.' });
      await queryClient.invalidateQueries({ queryKey: ['accounts', workspaceId] });
    },
    onError: (error: Error) => setNotice({ tone: 'danger', text: error.message }),
  });

  const busy = connect.isPending || refresh.isPending || disconnect.isPending;

  return (
    <AppShell
      title="Tài khoản social"
      subtitle="Kết nối qua OAuth chính thức, theo dõi token expiry và trạng thái đồng bộ."
      action={(
        <button className="button-primary disabled:cursor-not-allowed disabled:opacity-60" disabled={busy || !workspaceId} onClick={() => connect.mutate()}>
          {!workspaceId ? 'Đang tải workspace…' : connect.isPending ? 'Đang mở Zalo…' : 'Kết nối Zalo OA'}
        </button>
      )}
    >
      {notice ? (
        <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${notice.tone === 'success' ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-rose-400/40 bg-rose-400/10 text-rose-300'}`}>
          {notice.text}
        </div>
      ) : null}
      {query.isError ? (
        <div className="mb-4 rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">{query.error.message}</div>
      ) : null}
      {query.data?.length ? (
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Tài khoản</th><th>Nền tảng</th><th>Trạng thái</th><th>Token hết hạn</th><th>Capability</th><th>Thao tác</th></tr></thead>
            <tbody>
              {query.data.map((account) => (
                <tr key={account.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      {account.avatarUrl ? <img alt="" className="h-9 w-9 rounded-lg object-cover" src={account.avatarUrl} /> : null}
                      <div><div className="font-medium">{account.displayName}</div><div className="mt-1 text-xs text-[var(--muted)]">@{account.username ?? 'not-set'}</div></div>
                    </div>
                  </td>
                  <td>{account.platform}</td>
                  <td><Status tone={account.status === 'CONNECTED' ? 'success' : account.status === 'ERROR' || account.status === 'REAUTH_REQUIRED' ? 'danger' : 'warning'}>{account.status}</Status></td>
                  <td className="text-sm text-[var(--muted)]">{account.tokenExpiresAt ? new Date(account.tokenExpiresAt).toLocaleString('vi-VN') : 'Chưa có token'}</td>
                  <td className="text-xs text-[var(--muted)]">{account.lastErrorCode ?? 'API-dependent'}</td>
                  <td>
                    {account.platform === 'ZALO' && account.status === 'CONNECTED' ? (
                      <div className="flex gap-2">
                        <button className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-slate-300 hover:border-teal-400/50" disabled={busy} onClick={() => refresh.mutate(account.id)}>Làm mới token</button>
                        <button className="rounded-lg border border-rose-400/30 px-3 py-2 text-xs text-rose-300 hover:border-rose-400/70" disabled={busy} onClick={() => disconnect.mutate(account.id)}>Ngắt kết nối</button>
                      </div>
                    ) : <span className="text-xs text-[var(--muted)]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Chưa kết nối tài khoản" description="Bấm Kết nối Zalo OA để cấp quyền qua OAuth v4. Hệ thống không lưu mật khẩu Zalo." />
      )}
      <div className="mt-4 rounded-xl border border-[var(--border)] bg-white/[.02] px-4 py-3 text-xs leading-5 text-[var(--muted)]">
        Zalo OAuth dùng PKCE. Access token và refresh token được mã hóa AES-256-GCM; refresh token được xoay sau mỗi lần làm mới.
      </div>
    </AppShell>
  );
}
