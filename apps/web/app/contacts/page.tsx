'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, UserPlus } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { Empty, Status } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/store';

type Contact = { id: string; displayName: string; platform: string; platformUserId?: string; email?: string; normalizedPhone?: string; source?: string; consentStatus: string; suppressed: boolean };
type ContactsResponse = { items: Contact[]; pagination: { total: number } };
type ImportContact = { platform: 'ZALO' | 'FACEBOOK' | 'TIKTOK'; platformUserId?: string; displayName: string; username?: string; phone?: string; email?: string; source: string; consentStatus: 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT'; consentSource?: string };

const emptyForm: ImportContact = { platform: 'ZALO', displayName: '', platformUserId: '', phone: '', email: '', source: 'MANUAL', consentStatus: 'UNKNOWN', consentSource: '' };

function scalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).trim() : '';
}

function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') { if (quoted && text[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted; }
    else if (character === ',' && !quoted) { row.push(value); value = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) { if (character === '\r' && text[index + 1] === '\n') index += 1; row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); row = []; value = ''; }
    else value += character;
  }
  row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); return rows;
}

function contactsFromRows(rows: Array<Record<string, unknown>>, source: string): ImportContact[] {
  return rows.map((raw, index) => {
    const values = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key.trim().toLowerCase().replaceAll(' ', ''), scalar(value)]));
    const displayName = values.displayname || values.name || values.ten;
    if (!displayName) throw new Error(`Dòng ${index + 2}: thiếu displayName/name.`);
    const platform = (values.platform || 'ZALO').toUpperCase();
    if (!['ZALO', 'FACEBOOK', 'TIKTOK'].includes(platform)) throw new Error(`Dòng ${index + 2}: platform không hợp lệ.`);
    const consentStatus = (values.consentstatus || values.consent || 'UNKNOWN').toUpperCase();
    if (!['UNKNOWN', 'OPTED_IN', 'OPTED_OUT'].includes(consentStatus)) throw new Error(`Dòng ${index + 2}: consentStatus không hợp lệ.`);
    return { platform: platform as ImportContact['platform'], displayName, source: values.source || source, consentStatus: consentStatus as ImportContact['consentStatus'], ...(values.platformuserid ? { platformUserId: values.platformuserid } : {}), ...(values.username ? { username: values.username } : {}), ...(values.phone ? { phone: values.phone } : {}), ...(values.email ? { email: values.email } : {}), ...(values.consentsource ? { consentSource: values.consentsource } : {}) };
  });
}

async function unzipXml(archive: Uint8Array, targetName: string): Promise<string | undefined> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = archive.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('Tệp XLSX không có ZIP directory hợp lệ.');
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('XLSX central directory bị hỏng.');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(archive.slice(offset + 46, offset + 46 + nameLength));
    if (name === targetName) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('XLSX local entry bị hỏng.');
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.slice(start, start + compressedSize);
      if (method === 0) return decoder.decode(compressed);
      if (method !== 8) throw new Error(`XLSX compression method ${method} chưa được hỗ trợ.`);
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return decoder.decode(await new Response(stream).arrayBuffer());
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A';
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

async function xlsxRows(file: File): Promise<Array<Record<string, unknown>>> {
  const archive = new Uint8Array(await file.arrayBuffer());
  const [sharedXml, sheetXml] = await Promise.all([unzipXml(archive, 'xl/sharedStrings.xml'), unzipXml(archive, 'xl/worksheets/sheet1.xml')]);
  if (!sheetXml) throw new Error('Không tìm thấy worksheet đầu tiên trong XLSX.');
  const parser = new DOMParser();
  const shared = sharedXml ? Array.from(parser.parseFromString(sharedXml, 'application/xml').getElementsByTagName('si')).map((item) => item.textContent ?? '') : [];
  const rows = Array.from(parser.parseFromString(sheetXml, 'application/xml').getElementsByTagName('row')).map((row) => {
    const values: string[] = [];
    for (const cell of Array.from(row.getElementsByTagName('c'))) {
      const index = columnIndex(cell.getAttribute('r') ?? 'A1');
      const type = cell.getAttribute('t');
      const raw = cell.getElementsByTagName('v')[0]?.textContent ?? cell.getElementsByTagName('is')[0]?.textContent ?? '';
      values[index] = type === 's' ? shared[Number(raw)] ?? '' : raw;
    }
    return values;
  });
  const [headers, ...data] = rows;
  if (!headers) throw new Error('Worksheet trống.');
  return data.filter((row) => row.some((value) => value?.trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

async function readImport(file: File): Promise<ImportContact[]> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'json') {
    const parsed = JSON.parse(await file.text()) as unknown;
    const nested = typeof parsed === 'object' && parsed && 'contacts' in parsed ? parsed.contacts : undefined;
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(nested) ? nested : null;
    if (!rows) throw new Error('JSON phải là mảng hoặc object có trường contacts[].');
    return contactsFromRows(rows as Array<Record<string, unknown>>, `FILE:${file.name}`);
  }
  if (extension === 'csv') {
    const [headers, ...data] = csvRows(await file.text());
    if (!headers) throw new Error('CSV trống.');
    return contactsFromRows(data.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))), `FILE:${file.name}`);
  }
  if (extension === 'xlsx') return contactsFromRows(await xlsxRows(file), `FILE:${file.name}`);
  throw new Error('Chỉ hỗ trợ CSV, JSON hoặc Excel XLSX. Hãy lưu tệp XLS cũ thành XLSX.');
}

export default function ContactsPage() {
  const workspaceId = useSession((state) => state.workspaceId);
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<ImportContact>(emptyForm);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const query = useQuery({ queryKey: ['contacts', workspaceId], queryFn: () => api<ContactsResponse>(`/workspaces/${workspaceId}/contacts?limit=100`), enabled: Boolean(workspaceId) });
  const refresh = () => client.invalidateQueries({ queryKey: ['contacts', workspaceId] });
  const create = useMutation({ mutationFn: () => api(`/workspaces/${workspaceId}/contacts`, { method: 'POST', body: JSON.stringify(Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ''))) }), onSuccess: async () => { setForm(emptyForm); setError(''); setNotice('Đã lưu contact và consent history.'); await refresh(); }, onError: (cause: Error) => setError(cause.message) });
  const importContacts = useMutation({ mutationFn: (contacts: ImportContact[]) => api<{ status: string; jobId: string; total: number }>(`/workspaces/${workspaceId}/contacts/import`, { method: 'POST', body: JSON.stringify({ contacts }) }), onSuccess: (result) => { setNotice(`Đã đưa ${result.total} contact vào queue (${result.jobId}).`); setError(''); }, onError: (cause: Error) => setError(cause.message) });
  const consent = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api(`/workspaces/${workspaceId}/contacts/${id}/consent`, { method: 'PATCH', body: JSON.stringify({ status, source: 'MANUAL_ADMIN_UPDATE' }) }), onSuccess: refresh, onError: (cause: Error) => setError(cause.message) });
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; try { const values = await readImport(file); if (!values.length) throw new Error('Tệp không có contact hợp lệ.'); importContacts.mutate(values); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể đọc tệp.'); } finally { event.target.value = ''; } };

  return <AppShell title="CRM & Consent" subtitle={`${query.data?.pagination.total ?? 0} contacts · Dedupe, import qua queue, consent history và suppression.`} action={<div className="flex gap-2"><input ref={fileRef} className="hidden" type="file" accept=".csv,.json,.xlsx" onChange={(event) => void onFile(event)} /><button className="button-ghost" disabled={importContacts.isPending} onClick={() => fileRef.current?.click()}><FileUp className="mr-2 inline" size={15} />{importContacts.isPending ? 'Đang đọc…' : 'Import CSV/Excel/JSON'}</button></div>}>
    {error && <div className="mb-5 rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div>}{notice && <div className="mb-5 rounded-xl border border-teal-400/40 bg-teal-400/10 px-4 py-3 text-sm text-teal-100">{notice}</div>}
    <form className="panel mb-5 grid gap-3 p-5 md:grid-cols-4" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}><input className="input" required placeholder="Tên contact" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /><input className="input" placeholder="Zalo user_id" value={form.platformUserId} onChange={(event) => setForm({ ...form, platformUserId: event.target.value })} /><input className="input" placeholder="Số điện thoại (không dò tìm)" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /><input className="input" type="email" placeholder="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /><select className="input" value={form.consentStatus} onChange={(event) => setForm({ ...form, consentStatus: event.target.value as ImportContact['consentStatus'] })}><option>UNKNOWN</option><option>OPTED_IN</option><option>OPTED_OUT</option></select><input className="input" required placeholder="Nguồn dữ liệu" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} /><input className="input" placeholder="Nguồn consent / legal basis" value={form.consentSource} onChange={(event) => setForm({ ...form, consentSource: event.target.value })} /><button className="button-primary" disabled={create.isPending}><UserPlus className="mr-2 inline" size={15} />Lưu contact</button></form>
    {query.data?.items.length ? <div className="panel overflow-x-auto"><table className="data-table"><thead><tr><th>Contact</th><th>Platform / user_id</th><th>Liên hệ</th><th>Nguồn</th><th>Consent</th><th>Cập nhật</th></tr></thead><tbody>{query.data.items.map((contact) => <tr key={contact.id}><td className="font-medium">{contact.displayName}</td><td>{contact.platform}<div className="text-xs text-[var(--muted)]">{contact.platformUserId ?? '—'}</div></td><td><div className="text-sm">{contact.normalizedPhone ?? contact.email ?? '—'}</div></td><td className="text-sm text-[var(--muted)]">{contact.source ?? 'Manual'}</td><td><Status tone={contact.suppressed ? 'danger' : contact.consentStatus === 'OPTED_IN' ? 'success' : 'warning'}>{contact.suppressed ? 'SUPPRESSED' : contact.consentStatus}</Status></td><td><select className="input !py-2 text-xs" value={contact.consentStatus} disabled={consent.isPending} onChange={(event) => consent.mutate({ id: contact.id, status: event.target.value })}><option>UNKNOWN</option><option>OPTED_IN</option><option>OPTED_OUT</option></select></td></tr>)}</tbody></table></div> : <Empty title="Danh bạ đang trống" description="Import phải khai báo nguồn và consent; hệ thống không dò số điện thoại hoặc scrape dữ liệu cá nhân." />}
  </AppShell>;
}
