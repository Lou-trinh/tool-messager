'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Database, Download, FileSpreadsheet, FileUp, Play, RefreshCw, XCircle } from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api, apiBlob } from '@/lib/api';
import { useSession } from '@/lib/store';

type Target = 'IGNORE' | 'displayName' | 'phone' | 'platformUserId' | 'username' | 'email' | 'gender' | 'source' | 'consentStatus';
type ImportJob = {
  id: string; fileName: string; format: string; sizeBytes: number; status: string; detectedColumns: string[];
  mapping: Record<string, Target>; totalRows: number; validRows: number; invalidRows: number; duplicateRows: number;
  importedRows: number; skippedRows: number; failedRows: number; progress: number; errorSummary?: { message?: string }; createdAt: string;
};
type ImportRow = { id: string; rowNumber: number; raw: Record<string, unknown>; normalized?: Record<string, unknown>; status: string; errors: string[] };
type History = { items: ImportJob[]; pagination: { total: number } };
type Preview = { items: ImportRow[]; pagination: { total: number } };

const targets: Array<{ value: Target; label: string }> = [
  { value: 'IGNORE', label: 'Bỏ qua' }, { value: 'displayName', label: 'Tên liên hệ *' },
  { value: 'phone', label: 'Số điện thoại *' }, { value: 'platformUserId', label: 'Zalo user_id *' },
  { value: 'username', label: 'Username' }, { value: 'email', label: 'Email' }, { value: 'gender', label: 'Giới tính' },
  { value: 'source', label: 'Nguồn dữ liệu' }, { value: 'consentStatus', label: 'Consent' },
];
const terminal = new Set(['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'READY']);

function tone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (['READY', 'COMPLETED', 'VALID', 'IMPORTED'].includes(status)) return 'success';
  if (['FAILED', 'INVALID', 'CANCELLED'].includes(status)) return 'danger';
  if (['PARTIAL', 'DUPLICATE'].includes(status)) return 'warning';
  return 'neutral';
}

function textValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export default function DataImportPage() {
  const workspaceId = useSession((state) => state.workspaceId);
  const client = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeId, setActiveId] = useState<string>();
  const [mapping, setMapping] = useState<Record<string, Target>>({});
  const [filter, setFilter] = useState('');
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();

  const history = useQuery({ queryKey: ['imports', workspaceId], queryFn: () => api<History>(`/workspaces/${workspaceId}/imports`), enabled: Boolean(workspaceId), refetchInterval: 5_000 });
  const detail = useQuery({
    queryKey: ['import', workspaceId, activeId], queryFn: () => api<ImportJob>(`/workspaces/${workspaceId}/imports/${activeId}`), enabled: Boolean(workspaceId && activeId),
    refetchInterval: (query) => query.state.data && !terminal.has(query.state.data.status) ? 2_000 : false,
  });
  const preview = useQuery({ queryKey: ['import-preview', workspaceId, activeId, filter], queryFn: () => api<Preview>(`/workspaces/${workspaceId}/imports/${activeId}/preview${filter ? `?status=${filter}` : ''}`), enabled: Boolean(workspaceId && activeId) });
  const job = detail.data;

  const selectJob = (item: ImportJob) => { setActiveId(item.id); setMapping(item.mapping ?? {}); setMessage(undefined); };
  const upload = useMutation({
    mutationFn: async (file: File) => { const body = new FormData(); body.append('file', file); return api<ImportJob>(`/workspaces/${workspaceId}/imports/upload`, { method: 'POST', body }); },
    onSuccess: async (result) => { setActiveId(result.id); setMapping(result.mapping ?? {}); setMessage({ kind: 'ok', text: `Đã phân tích ${result.totalRows.toLocaleString('vi-VN')} dòng. Hãy kiểm tra mapping trước khi nhập.` }); await client.invalidateQueries({ queryKey: ['imports', workspaceId] }); },
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  });
  const saveMapping = useMutation({
    mutationFn: () => api<ImportJob>(`/workspaces/${workspaceId}/imports/${activeId}/mapping`, { method: 'PATCH', body: JSON.stringify({ mapping }) }),
    onSuccess: async (result) => { setMapping(result.mapping); setMessage({ kind: 'ok', text: `Mapping hợp lệ: ${result.validRows} dòng sẵn sàng, ${result.invalidRows} lỗi, ${result.duplicateRows} trùng.` }); await Promise.all([detail.refetch(), preview.refetch(), history.refetch()]); },
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  });
  const commit = useMutation({
    mutationFn: () => api<ImportJob>(`/workspaces/${workspaceId}/imports/${activeId}/commit`, { method: 'POST' }),
    onSuccess: async () => { setMessage({ kind: 'ok', text: 'Đã đưa phiên import vào queue. Tiến độ sẽ tự cập nhật.' }); await Promise.all([detail.refetch(), history.refetch()]); },
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  });
  const columns = useMemo(() => job?.detectedColumns ?? [], [job?.detectedColumns]);

  const acceptFile = (file?: File) => { if (file) upload.mutate(file); };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); acceptFile(event.dataTransfer.files[0]); };
  const downloadErrors = async () => {
    if (!activeId) return;
    try { const blob = await apiBlob(`/workspaces/${workspaceId}/imports/${activeId}/errors.csv`); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `import-errors-${activeId}.csv`; link.click(); URL.revokeObjectURL(url); }
    catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không thể tải file lỗi.' }); }
  };

  return <AppShell title="Nhập dữ liệu" subtitle="Upload lớn an toàn, mapping cột, kiểm tra trùng, preview và xử lý nền bằng queue.">
    {message && <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.kind === 'ok' ? 'border-teal-400/40 bg-teal-400/10 text-teal-100' : 'border-rose-400/40 bg-rose-400/10 text-rose-200'}`}>{message.text}</div>}
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <div className={`panel grid min-h-52 place-items-center border-dashed p-8 text-center transition ${dragging ? '!border-teal-300 bg-teal-400/10' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          <div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal-400/10 text-teal-300"><FileUp /></div><h2 className="mt-4 text-lg font-semibold">Kéo thả tệp dữ liệu vào đây</h2><p className="mt-2 text-sm text-[var(--muted)]">CSV streaming tối đa 100 MB; XLSX 50 MB; XLS/JSON 20 MB · tối đa 1 triệu dòng</p><input ref={inputRef} className="hidden" type="file" accept=".csv,.xlsx,.xls,.json" onChange={(event) => { acceptFile(event.target.files?.[0]); event.target.value = ''; }} /><button className="button-primary mt-5" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>{upload.isPending ? <RefreshCw className="mr-2 inline animate-spin" size={16} /> : <FileSpreadsheet className="mr-2 inline" size={16} />}{upload.isPending ? 'Đang upload và phân tích…' : 'Chọn tệp'}</button></div>
        </div>

        {job && <>
          <section className="panel p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow">Mapping cột</div><h2 className="mt-2 font-semibold">{job.fileName}</h2></div><Status tone={tone(job.status)}>{job.status}</Status></div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{columns.map((column) => <label className="rounded-xl border border-[var(--border)] p-3" key={column}><span className="mb-2 block truncate text-xs text-[var(--muted)]" title={column}>{column}</span><select className="input !py-2 text-sm" value={mapping[column] ?? 'IGNORE'} disabled={!['MAPPING', 'READY', 'UPLOADED'].includes(job.status)} onChange={(event) => setMapping({ ...mapping, [column]: event.target.value as Target })}>{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>)}</div>
            <div className="mt-5 flex flex-wrap gap-3"><button className="button-ghost" disabled={saveMapping.isPending || !['MAPPING', 'READY', 'UPLOADED'].includes(job.status)} onClick={() => saveMapping.mutate()}><CheckCircle2 className="mr-2 inline" size={16} />Kiểm tra mapping</button><button className="button-primary" disabled={commit.isPending || job.status !== 'READY' || !job.validRows} onClick={() => commit.mutate()}><Play className="mr-2 inline" size={16} />Nhập {job.validRows.toLocaleString('vi-VN')} dòng hợp lệ</button>{(job.invalidRows > 0 || job.failedRows > 0) && <button className="button-ghost" onClick={() => void downloadErrors()}><Download className="mr-2 inline" size={16} />Tải CSV lỗi</button>}</div>
            <div className="mt-5"><div className="mb-2 flex justify-between text-xs text-[var(--muted)]"><span>Tiến độ</span><span>{job.progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-gradient-to-r from-teal-400 to-green-500 transition-all" style={{ width: `${job.progress}%` }} /></div></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[['Tổng', job.totalRows], ['Hợp lệ', job.validRows], ['Lỗi', job.invalidRows], ['Trùng', job.duplicateRows], ['Đã nhập', job.importedRows], ['Bỏ qua', job.skippedRows]].map(([label, value]) => <div className="rounded-xl bg-white/[.025] p-3" key={label}><div className="text-xs text-[var(--muted)]">{label}</div><div className="mt-1 text-lg font-bold">{Number(value).toLocaleString('vi-VN')}</div></div>)}</div>
          </section>
          <section className="panel overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4"><div><h2 className="font-semibold">Preview dữ liệu</h2><p className="text-xs text-[var(--muted)]">Dữ liệu được chuẩn hóa và kiểm tra trên server.</p></div><select className="input !w-auto !py-2 text-xs" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">Tất cả trạng thái</option>{['VALID', 'INVALID', 'DUPLICATE', 'IMPORTED', 'FAILED'].map((value) => <option key={value}>{value}</option>)}</select></div>
            <div className="overflow-x-auto">{preview.data?.items.length ? <table className="data-table"><thead><tr><th>Dòng</th><th>Trạng thái</th><th>Tên</th><th>Điện thoại / Zalo ID</th><th>Nguồn</th><th>Chi tiết</th></tr></thead><tbody>{preview.data.items.map((row) => <tr key={row.id}><td>{row.rowNumber}</td><td><Status tone={tone(row.status)}>{row.status}</Status></td><td>{textValue(row.normalized?.displayName ?? row.raw.name ?? row.raw.displayName)}</td><td className="text-xs text-[var(--muted)]">{textValue(row.normalized?.normalizedPhone ?? row.normalized?.platformUserId)}</td><td className="text-xs">{textValue(row.normalized?.source)}</td><td className="max-w-xs text-xs text-rose-200">{Array.isArray(row.errors) ? row.errors.join('; ') : ''}</td></tr>)}</tbody></table> : <div className="p-6"><Empty title="Chưa có dữ liệu preview" description="Upload một tệp để bắt đầu quy trình nhập dữ liệu." /></div>}</div>
          </section>
        </>}
      </div>

      <aside className="panel h-fit p-4 xl:sticky xl:top-20"><div className="flex items-center gap-2"><Database size={18} className="text-teal-300" /><h2 className="font-semibold">Lịch sử import</h2></div><div className="mt-4 space-y-2">{history.data?.items.length ? history.data.items.map((item) => <button key={item.id} className={`w-full rounded-xl border p-3 text-left transition ${activeId === item.id ? 'border-teal-400/60 bg-teal-400/10' : 'border-[var(--border)] hover:bg-white/[.025]'}`} onClick={() => selectJob(item)}><div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-medium" title={item.fileName}>{item.fileName}</span>{item.status === 'FAILED' ? <XCircle size={15} className="shrink-0 text-rose-300" /> : <Status tone={tone(item.status)}>{item.status}</Status>}</div><div className="mt-2 flex justify-between text-[11px] text-[var(--muted)]"><span>{item.totalRows.toLocaleString('vi-VN')} dòng</span><span>{new Date(item.createdAt).toLocaleString('vi-VN')}</span></div></button>) : <p className="py-8 text-center text-sm text-[var(--muted)]">Chưa có phiên import.</p>}</div></aside>
    </div>
  </AppShell>;
}
