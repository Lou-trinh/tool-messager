'use client';

import { Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

interface TokenPair { accessToken: string; refreshToken: string; }

export default function RegisterPage() {
  const router = useRouter(); const setTokens = useSession((state) => state.setTokens); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setLoading(true); setError(''); const form = new FormData(event.currentTarget); try { const tokens = await api<TokenPair>('/auth/register', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password'), displayName: form.get('displayName'), workspaceName: form.get('workspaceName') }) }); setTokens(tokens.accessToken, tokens.refreshToken); router.push('/'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể đăng ký.'); } finally { setLoading(false); } }
  return <div className="grid min-h-screen place-items-center px-5 py-10"><div className="w-full max-w-lg"><div className="mb-7 flex items-center justify-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-teal-300 to-green-500 text-black"><Zap /></div><div><div className="text-lg font-bold">OmniSocial</div><div className="text-[10px] tracking-[.16em] text-[var(--muted)]">CREATE YOUR CONTROL PLANE</div></div></div><form className="panel grid gap-5 p-7 sm:grid-cols-2" onSubmit={submit}><div className="sm:col-span-2"><div className="eyebrow">Get started</div><h1 className="mt-2 text-2xl font-bold">Tạo workspace mới</h1></div><label className="block text-xs font-semibold">Tên của bạn<input className="input mt-2" name="displayName" required /></label><label className="block text-xs font-semibold">Tên workspace<input className="input mt-2" name="workspaceName" required /></label><label className="block text-xs font-semibold sm:col-span-2">Email<input className="input mt-2" name="email" type="email" required /></label><label className="block text-xs font-semibold sm:col-span-2">Mật khẩu<input className="input mt-2" name="password" type="password" minLength={12} required placeholder="Ít nhất 12 ký tự, gồm hoa/thường/số/ký hiệu" /></label>{error && <div className="rounded-lg border border-rose-400/30 bg-rose-400/5 p-3 text-sm text-rose-300 sm:col-span-2">{error}</div>}<button className="button-primary sm:col-span-2" disabled={loading}>{loading ? 'Đang khởi tạo...' : 'Tạo tài khoản và workspace'}</button></form><p className="mt-5 text-center text-sm text-[var(--muted)]">Đã có tài khoản? <Link className="font-semibold text-teal-300" href="/login">Đăng nhập</Link></p></div></div>;
}
