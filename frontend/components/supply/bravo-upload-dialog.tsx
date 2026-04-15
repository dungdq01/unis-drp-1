'use client';

import { useState, useRef } from 'react';
import { type BravoUploadResult, type ManualEntryRow, manualBravoEntry } from '@/lib/api/supply';

type DialogTab = 'file' | 'manual';

interface ManualRow {
  id: number;
  item_code: string;
  location_code: string;
  on_hand_qty: string;
  reserved_qty: string;
  in_transit_qty: string;
  source_type: string;
}

function newRow(id: number): ManualRow {
  return { id, item_code: '', location_code: '', on_hand_qty: '0', reserved_qty: '0', in_transit_qty: '0', source_type: 'OEM' };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<BravoUploadResult>;
  onCaptureNow: () => void;
}

export function BravoUploadDialog({ open, onClose, onUpload, onCaptureNow }: Props) {
  const [tab, setTab] = useState<DialogTab>('file');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BravoUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Manual entry state
  const [rows, setRows] = useState<ManualRow[]>([newRow(1)]);
  const nextId = useRef(2);

  if (!open) return null;

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setRows([newRow(1)]);
    nextId.current = 2;
    setTab('file');
    setLoading(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleCaptureNow = () => { reset(); onClose(); onCaptureNow(); };

  // ─── File tab ───────────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setResult(null);
    setError(null);
  };

  const handleUploadFile = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await onUpload(file);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload thất bại');
    } finally {
      setLoading(false);
    }
  };

  // ─── Manual tab ─────────────────────────────────────────────────────────────

  const addRow = () => {
    setRows((prev) => [...prev, newRow(nextId.current++)]);
  };

  const removeRow = (id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const updateRow = (id: number, field: keyof ManualRow, value: string) => {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleManualSubmit = async () => {
    const payload: ManualEntryRow[] = rows.map((r) => ({
      item_code: r.item_code.trim(),
      location_code: r.location_code.trim(),
      on_hand_qty: parseFloat(r.on_hand_qty) || 0,
      reserved_qty: parseFloat(r.reserved_qty) || 0,
      in_transit_qty: parseFloat(r.in_transit_qty) || 0,
      source_type: r.source_type || 'OEM',
    }));

    const valid = payload.filter((r) => r.item_code && r.location_code);
    if (valid.length === 0) {
      setError('Vui lòng nhập ít nhất 1 dòng có item_code và location_code');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await manualBravoEntry(valid);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nhập thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={!loading ? handleClose : undefined} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">

        {/* ─── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-5 pb-0 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-800">Cập nhật tồn kho Bravo</h2>
          <button onClick={handleClose} disabled={loading} className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ─── Tab bar ────────────────────────────────────────────────────── */}
        {!result && (
          <div className="flex gap-0 border-b border-slate-200 px-6 mt-4 flex-shrink-0">
            {(['file', 'manual'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(null); }}
                disabled={loading}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  tab === t
                    ? 'text-sky-600 border-sky-500'
                    : 'text-slate-500 border-transparent hover:text-slate-700'
                }`}
              >
                {t === 'file' ? 'Upload File' : 'Nhập thủ công'}
              </button>
            ))}
          </div>
        )}

        {/* ─── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── POST-UPLOAD: Success + capture prompt ── */}
          {result && (
            <div className="space-y-4">
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 space-y-3">
                <p className="text-sm font-semibold text-emerald-800">✅ Upload xong. Bạn có muốn Capture Snapshot ngay không?</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center rounded-lg bg-white border border-emerald-100 py-2">
                    <p className="text-xl font-bold text-emerald-700 tabular-nums">{result.rowsInserted.toLocaleString()}</p>
                    <p className="text-xs text-emerald-600">Inserted</p>
                  </div>
                  <div className="text-center rounded-lg bg-white border border-sky-100 py-2">
                    <p className="text-xl font-bold text-sky-700 tabular-nums">{result.rowsUpdated.toLocaleString()}</p>
                    <p className="text-xs text-sky-600">Updated</p>
                  </div>
                  <div className="text-center rounded-lg bg-white border border-slate-100 py-2">
                    <p className="text-xl font-bold text-slate-500 tabular-nums">{result.rowsSkipped.toLocaleString()}</p>
                    <p className="text-xs text-slate-400">Skipped</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500">Tổng: {result.rowsParsed.toLocaleString()} dòng · Sync lúc {new Date(result.syncTimestamp).toLocaleString('vi-VN')}</p>
              </div>

              {result.unmappedItems.length > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                  <p className="text-xs font-medium text-amber-700 mb-1">Mã hàng không tìm thấy ({result.unmappedItems.length}):</p>
                  <p className="text-xs text-amber-600 font-mono leading-relaxed">
                    {result.unmappedItems.slice(0, 8).join(', ')}
                    {result.unmappedItems.length > 8 && ` ... +${result.unmappedItems.length - 8} khác`}
                  </p>
                </div>
              )}

              {result.unmappedLocations.length > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                  <p className="text-xs font-medium text-amber-700 mb-1">Mã kho không tìm thấy ({result.unmappedLocations.length}):</p>
                  <p className="text-xs text-amber-600 font-mono">{result.unmappedLocations.join(', ')}</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={handleClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  Để sau
                </button>
                <button
                  onClick={handleCaptureNow}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 shadow-sm transition-all"
                >
                  Capture Now
                </button>
              </div>
            </div>
          )}

          {/* ── TAB: Upload File ── */}
          {!result && tab === 'file' && (
            <div className="space-y-4">
              <div
                onClick={() => inputRef.current?.click()}
                className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-sky-400 hover:bg-sky-50/30 transition-colors"
              >
                <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
                {file ? (
                  <div>
                    <p className="text-sm font-medium text-slate-700">{file.name}</p>
                    <p className="text-xs text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                    <p className="text-xs text-sky-500 mt-2">Click để đổi file</p>
                  </div>
                ) : (
                  <div>
                    <svg className="mx-auto h-10 w-10 text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <p className="text-sm text-slate-500">Chọn file CSV, XLSX, hoặc XLS</p>
                    <p className="text-xs text-slate-400 mt-1">Click để chọn file · Max 50 MB</p>
                  </div>
                )}
              </div>

              {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>}

              <div className="flex justify-end gap-2">
                <button onClick={handleClose} disabled={loading} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50">Đóng</button>
                <button
                  onClick={handleUploadFile}
                  disabled={!file || loading}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 shadow-sm transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {loading && <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>}
                  {loading ? 'Đang upload...' : 'Upload'}
                </button>
              </div>
            </div>
          )}

          {/* ── TAB: Nhập thủ công ── */}
          {!result && tab === 'manual' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">Nhập trực tiếp tồn kho theo từng mã hàng × mã kho. Sau khi lưu sẽ upsert vào lot_attribute.</p>

              {/* Table header */}
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-1.5 text-xs font-medium text-slate-500 px-1">
                <span>Item Code <span className="text-red-400">*</span></span>
                <span>Mã kho <span className="text-red-400">*</span></span>
                <span>On-Hand</span>
                <span>Reserved</span>
                <span>In-Transit</span>
                <span></span>
              </div>

              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {rows.map((row) => (
                  <div key={row.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-1.5 items-center">
                    <input
                      type="text"
                      value={row.item_code}
                      onChange={(e) => updateRow(row.id, 'item_code', e.target.value)}
                      placeholder="03.L1.6060.8000"
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400 font-mono"
                    />
                    <input
                      type="text"
                      value={row.location_code}
                      onChange={(e) => updateRow(row.id, 'location_code', e.target.value)}
                      placeholder="008"
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400 font-mono"
                    />
                    <input
                      type="number"
                      min={0}
                      value={row.on_hand_qty}
                      onChange={(e) => updateRow(row.id, 'on_hand_qty', e.target.value)}
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400 tabular-nums"
                    />
                    <input
                      type="number"
                      min={0}
                      value={row.reserved_qty}
                      onChange={(e) => updateRow(row.id, 'reserved_qty', e.target.value)}
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400 tabular-nums"
                    />
                    <input
                      type="number"
                      min={0}
                      value={row.in_transit_qty}
                      onChange={(e) => updateRow(row.id, 'in_transit_qty', e.target.value)}
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400 tabular-nums"
                    />
                    <button
                      onClick={() => removeRow(row.id)}
                      disabled={rows.length === 1}
                      className="text-slate-300 hover:text-red-400 transition-colors disabled:opacity-20"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={addRow}
                className="flex items-center gap-1.5 text-xs text-sky-500 hover:text-sky-700 transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Thêm dòng
              </button>

              {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>}

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={handleClose} disabled={loading} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50">Đóng</button>
                <button
                  onClick={handleManualSubmit}
                  disabled={loading}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 shadow-sm transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {loading && <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>}
                  {loading ? 'Đang lưu...' : 'Lưu tồn kho'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
