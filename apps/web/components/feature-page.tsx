import { AppShell } from './app-shell';
import { Empty } from './ui';

export function FeaturePage({ title, subtitle, eyebrow, items }: { title: string; subtitle: string; eyebrow: string; items: Array<{ title: string; text: string; status: string }> }) {
  return <AppShell title={title} subtitle={subtitle} action={<button className="button-primary">Tạo mới</button>}><div className="grid gap-4 md:grid-cols-3">{items.map((item) => <div className="panel p-5" key={item.title}><div className="eyebrow">{eyebrow}</div><div className="mt-3 flex items-center justify-between gap-3"><h3 className="font-semibold">{item.title}</h3><span className="rounded-full border border-[var(--border)] px-2 py-1 text-[10px] uppercase text-[var(--muted)]">{item.status}</span></div><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{item.text}</p></div>)}</div><div className="mt-5"><Empty title="Chưa có dữ liệu trong workspace" description="Module đã sẵn sàng; dữ liệu chỉ xuất hiện sau khi tạo bản ghi hợp lệ hoặc kết nối API chính thức." /></div></AppShell>;
}
