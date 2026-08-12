'use client';

import { ShieldCheck, Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface TokenPair { accessToken: string; refreshToken: string; }

export default function LoginPage() {
  const router = useRouter();
  const setTokens = useSession((state) => state.setTokens);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    setSlow(false);
    const slowTimer = window.setTimeout(() => setSlow(true), 2_500);
    const form = new FormData(event.currentTarget);
    try {
      const tokens = await api<TokenPair>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
          sessionName: 'Web dashboard',
        }),
      });
      setTokens(tokens.accessToken, tokens.refreshToken);
      router.push('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đăng nhập.');
    } finally {
      window.clearTimeout(slowTimer);
      setSlow(false);
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center justify-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-teal-300 to-green-500 text-black"><Zap /></div>
          <div><div className="text-lg font-bold">OmniSocial</div><div className="text-[10px] tracking-[.16em] text-[var(--muted)]">SECURE CONTROL PLANE</div></div>
        </div>
        <form className="panel space-y-5 p-7" onSubmit={submit}>
          <div><div className="eyebrow">Welcome back</div><h1 className="mt-2 text-2xl font-bold">Đăng nhập workspace</h1><p className="mt-2 text-sm text-[var(--muted)]">Quản lý social operations trong một giao diện thống nhất.</p></div>
          <label className="block text-xs font-semibold">Email<input className="input mt-2" name="email" type="email" required defaultValue="owner@demo.local" /></label>
          <label className="block text-xs font-semibold">Mật khẩu<input className="input mt-2" name="password" type="password" required defaultValue="DemoPass!2026" /></label>
          {error && <div className="rounded-lg border border-rose-400/30 bg-rose-400/5 p-3 text-sm text-rose-300">{error}</div>}
          <button className="button-primary w-full" disabled={loading}>{loading ? (slow ? 'Đang khởi động máy chủ...' : 'Đang xác thực...') : 'Đăng nhập'}</button>
          {slow && <p className="text-center text-xs leading-5 text-[var(--muted)]">Gói Render Free có thể cần tới 60 giây để khởi động sau thời gian không hoạt động.</p>}
          <div className="flex items-center justify-center gap-2 text-xs text-[var(--muted)]"><ShieldCheck size={14} className="text-teal-300" /> Refresh token rotation · RBAC · Audit log</div>
        </form>
        <p className="mt-5 text-center text-sm text-[var(--muted)]">Chưa có tài khoản? <Link className="font-semibold text-teal-300" href="/register">Tạo workspace</Link></p>
      </div>
    </div>
  );
}
