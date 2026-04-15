'use client';

import { useCallback, useRef, useState } from 'react';
import type { Snapshot } from '@/lib/api/demand';

// FE-A2: updated signature — opts thay cho runId string đơn lẻ
export interface UploadOpts {
  runId?: string;
  snapshotName?: string;       // mode = tạo mới
  targetSnapshotId?: string;   // mode = upload vào DRAFT có sẵn
}

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  // FE-A2: page.tsx phải cập nhật theo signature này
  onUpload: (file: File, opts: UploadOpts) => Promise<{ snapshotId: string; totalLines: number; errors: string[] }>;
  // List DRAFT snapshots để chọn target (page.tsx truyền từ snapshots state)
  draftSnapshots?: Snapshot[];
}

type Step = 'drop' | 'preview' | 'result';
type UploadMode = 'new' | 'existing';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

export function UploadDialog({ open, onClose, onUpload, draftSnapshots = [] }: UploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('drop');
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<UploadMode>('new');
  const [snapshotName, setSnapshotName] = useState('');
  const [targetSnapshotId, setTargetSnapshotId] = useState('');
  const [runId, setRunId] = useState('');
  const [preview, setPreview] = useState<string[][]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ snapshotId: string; totalLines: number; errors: string[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setStep('drop');
    setFile(null);
    setMode('new');
    setSnapshotName('');
    setTargetSnapshotId('');
    setRunId('');
    setPreview([]);
    setTotalRows(0);
    setResult(null);
    setError('');
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const parsePreview = (f: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n').filter(l => l.trim());
      setTotalRows(lines.length > 0 ? lines.length - 1 : 0);
      setPreview(lines.slice(0, 6).map(l => l.split(',').map(c => c.trim())));
      setStep('preview');
    };
    reader.readAsText(f.slice(0, 1024 * 50));
  };

  const handleFile = (f: File) => {
    setError('');
    if (!f.name.endsWith('.csv')) { setError('Only .csv files are accepted'); return; }
    if (f.size > MAX_SIZE) { setError('File exceeds 50MB limit'); return; }
    setFile(f);
    parsePreview(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleConfirm = async () => {
    if (!file) return;
    if (mode === 'existing' && !targetSnapshotId) {
      setError('Vui lòng chọn snapshot đích');
      return;
    }
    setUploading(true);
    try {
      const opts: UploadOpts =
        mode === 'existing'
          ? { targetSnapshotId }
          : { snapshotName: snapshotName.trim() || undefined, runId: runId || undefined };
      const res = await onUpload(file, opts);
      setResult(res);
      setStep('result');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (!open) return null;

  // Target snapshot details (for warning about existing lines)
  const targetSnap = draftSnapshots.find(s => s.id === targetSnapshotId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-slate-800">Upload Forecast CSV</h2>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Step 1: Drop zone + options */}
        {step === 'drop' && (
          <div className="space-y-4">
            {/* Mode toggle */}
            <div className="rounded-lg border border-slate-200 p-3 space-y-2">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Upload Mode</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="upload-mode"
                  value="new"
                  checked={mode === 'new'}
                  onChange={() => setMode('new')}
                  className="accent-sky-500"
                />
                <span className="text-sm text-slate-700">Tạo snapshot mới</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="upload-mode"
                  value="existing"
                  checked={mode === 'existing'}
                  onChange={() => setMode('existing')}
                  className="accent-sky-500"
                  disabled={draftSnapshots.length === 0}
                />
                <span className={`text-sm ${draftSnapshots.length === 0 ? 'text-slate-400' : 'text-slate-700'}`}>
                  Upload vào DRAFT có sẵn
                  {draftSnapshots.length === 0 && <span className="ml-1 text-xs text-slate-400">(không có DRAFT snapshot)</span>}
                </span>
              </label>
            </div>

            {/* Mode = new: snapshot name */}
            {mode === 'new' && (
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  Tên Snapshot (tuỳ chọn)
                </label>
                <input
                  value={snapshotName}
                  onChange={e => setSnapshotName(e.target.value)}
                  placeholder={`Snapshot ${new Date().toISOString().slice(0, 10)}`}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300"
                />
              </div>
            )}

            {/* Mode = existing: dropdown */}
            {mode === 'existing' && (
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  Chọn DRAFT Snapshot đích
                </label>
                <select
                  value={targetSnapshotId}
                  onChange={e => setTargetSnapshotId(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300"
                >
                  <option value="">— Chọn snapshot —</option>
                  {draftSnapshots.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.snapshotName || s.id.slice(0, 8)} ({s.totalLines.toLocaleString()} lines)
                    </option>
                  ))}
                </select>
                {/* Warning nếu snapshot đã có lines */}
                {targetSnap && targetSnap.totalLines > 0 && (
                  <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                    <p className="text-xs text-amber-700">
                      ⚠ Snapshot này đã có <span className="font-semibold">{targetSnap.totalLines.toLocaleString()} lines</span>. Upload sẽ thay thế toàn bộ.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-colors ${
                dragOver ? 'border-sky-400 bg-sky-50/50' : 'border-slate-200 hover:border-sky-300 hover:bg-sky-50/30'
              }`}
            >
              <div className="mb-3 text-3xl text-slate-300">&#8682;</div>
              <p className="text-sm text-slate-500">Drag &amp; drop CSV file here</p>
              <p className="mt-1 text-[11px] text-slate-400">or click to browse (max 50MB)</p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
              />
            </div>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && file && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700">{file.name}</span>
              <span className="text-[11px] text-slate-400">{totalRows.toLocaleString()} rows</span>
              {mode === 'existing' && targetSnap && (
                <span className="text-[11px] text-amber-600">→ {targetSnap.snapshotName || targetSnap.id.slice(0, 8)}</span>
              )}
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200 mb-4">
              <table className="w-full text-xs">
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className={i === 0 ? 'bg-slate-50 font-semibold text-slate-500' : 'text-slate-600'}>
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-1.5 border-b border-slate-100 whitespace-nowrap">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={reset} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 transition-colors">
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={uploading}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 disabled:opacity-50 transition-all"
              >
                {uploading ? 'Uploading...' : 'Confirm Upload'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Result */}
        {step === 'result' && result && (
          <div>
            <div className="rounded-xl bg-green-50 border border-green-200 px-5 py-4 mb-4">
              <p className="text-sm font-medium text-green-700">Upload successful</p>
              <p className="mt-1 text-xs text-green-600">
                Snapshot: <span className="font-mono">{result.snapshotId}</span> · {result.totalLines.toLocaleString()} lines
              </p>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-5 py-3 mb-4">
                <p className="text-xs font-semibold text-amber-700 mb-1">Warnings ({result.errors.length})</p>
                <ul className="text-xs text-amber-600 space-y-0.5 list-disc pl-4">
                  {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                  {result.errors.length > 5 && <li>...and {result.errors.length - 5} more</li>}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={handleClose} className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 transition-all">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
