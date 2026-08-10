import type { ReactNode } from 'react';

export function Metric({ label, value, detail, icon }: { label: string; value: string | number; detail: string; icon: ReactNode }) {
  return <div className="panel p-5"><div className="flex items-start justify-between"><div><div className="text-xs font-semibold uppercase tracking-[.08em] text-[var(--muted)]">{label}</div><div className="mt-3 text-3xl font-bold tracking-tight">{value}</div></div><div className="grid h-9 w-9 place-items-center rounded-lg bg-teal-400/10 text-teal-300">{icon}</div></div><div className="mt-4 text-xs text-[var(--muted)]">{detail}</div></div>;
}

export function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'neutral' }) {
  const colors = { success: 'text-green-400 bg-green-400/5', warning: 'text-amber-300 bg-amber-300/5', danger: 'text-rose-400 bg-rose-400/5', neutral: 'text-slate-400 bg-slate-400/5' };
  return <span className={`status ${colors[tone]}`}>{children}</span>;
}

export function Empty({ title, description }: { title: string; description: string }) {
  return <div className="panel grid min-h-56 place-items-center p-8 text-center"><div><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-white/[.04] text-2xl">◎</div><h3 className="font-semibold">{title}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">{description}</p></div></div>;
}
