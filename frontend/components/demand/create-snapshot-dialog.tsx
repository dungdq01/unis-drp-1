'use client';

import { useState } from 'react';
import { createSnapshot, type Snapshot } from '@/lib/api/demand';

// Auto-suggest: "DS-YYYY-MM-DD"
function defaultName() {
  return `DS-${new Date().toISOString().slice(0, 10)}`;
}

// Default horizon: đầu tuần hiện tại + 12 tuần
function defaultHorizonStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + 1); // Monday
  return d.toISOString().slice(0, 10);
}
function defaultHorizonEnd() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + 1 + 84); // +12 weeks
  return d.toISOString().slice(0, 10);
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (snapshot: Snapshot) => void;
}

export function CreateSnapshotDialog({ open, onClose, onCreated }: Props) {
  const [snapshotName, setSnapshotName] = useState(defaultName);
  const [horizonStart, setHorizonStart] = useState(defaultHorizonStart);
  const [horizonEnd, setHorizonEnd] = useState(defaultHorizonEnd);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleClose = () => {
    setSnapshotName(defaultName());
    setHorizonStart(defaultHorizonStart());
    setHorizonEnd(defaultHorizonEnd());
    setNotes('');
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!snapshotName.trim()) {
      setError('Tên snapshot là bắt buộc');
      return;
    }
    if (horizonStart && horizonEnd && horizonEnd < horizonStart) {
      setError('Horizon End phải >= Horizon Start');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const snap = await createSnapshot({
        snapshotName: snapshotName.trim(),
        horizonStart: horizonStart || undefined,
        horizonEnd: horizonEnd || undefined,
        notes: notes.trim() || undefined,
      });
      onCreated(snap);
      handleClose();
    } catch (e: any) {
      setError(e.message ?? 'Lỗi tạo snapshot');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-sm font-bold text-slate-800">Tạo Demand Snapshot mới</h2>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              Tên snapshot <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-50"
              value={snapshotName}
              onChange={e => setSnapshotName(e.target.value)}
              disabled={loading}
              placeholder="DS-2026-04-14"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Horizon Start</label>
              <input
                type="date"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-50"
                value={horizonStart}
                onChange={e => setHorizonStart(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Horizon End</label>
              <input
                type="date"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-50"
                value={horizonEnd}
                onChange={e => setHorizonEnd(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Ghi chú (tuỳ chọn)</label>
            <textarea
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none disabled:opacity-50"
              placeholder="VD: Forecast Q1 2026 sau khi điều chỉnh Tết..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <div className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2">
          <p className="text-xs text-sky-700">
            Snapshot sẽ ở trạng thái <span className="font-semibold">DRAFT rỗng</span>.
            Upload CSV để thêm dữ liệu sau.
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !snapshotName.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 text-white shadow-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading && (
              <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            )}
            Tạo Draft
          </button>
        </div>
      </div>
    </div>
  );
}
