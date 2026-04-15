'use client';

import { useState, useEffect } from 'react';
import { type SupplySnapshotLine } from '@/lib/api/supply';

interface Props {
  open: boolean;
  line: SupplySnapshotLine | null;
  onClose: () => void;
  onOverride: (lineId: string, qty: number, reason: string) => Promise<void>;
}

export function LineOverrideDialog({ open, line, onClose, onOverride }: Props) {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && line) {
      const current = line.overrideQty !== null ? Number(line.overrideQty) : Number(line.allocatableQty);
      setQty(String(current));
      setReason('');
      setError(null);
    }
  }, [open, line]);

  if (!open || !line) return null;

  const handleSubmit = async () => {
    const parsedQty = Number(qty);
    if (qty === '' || isNaN(parsedQty) || parsedQty < 0) {
      setError('Vui lòng nhập số lượng hợp lệ (>= 0)');
      return;
    }
    if (!reason.trim()) {
      setError('Vui lòng nhập lý do override');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onOverride(line.id, parsedQty, reason.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={!loading ? onClose : undefined} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-1">Override Tồn kho</h2>
        <p className="text-xs text-slate-500 mb-4 font-mono">
          {line.itemCode} × {line.locationCode}
        </p>

        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 mb-4 text-xs text-slate-600">
          {line.overrideQty !== null ? (
            <span>Override hiện tại: <strong className="text-sky-700">{Number(line.overrideQty).toLocaleString()}</strong> (gốc: {Number(line.allocatableQty).toLocaleString()})</span>
          ) : (
            <span>Allocatable hiện tại: <strong>{Number(line.allocatableQty).toLocaleString()}</strong></span>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Qty mới <span className="text-red-500">*</span></label>
            <input
              type="number"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              disabled={loading}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent disabled:opacity-50 tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Lý do <span className="text-red-500">*</span></label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading}
              rows={3}
              placeholder="Nhập lý do override..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent disabled:opacity-50 resize-none"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 shadow-sm transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {loading && (
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            )}
            Lưu Override
          </button>
        </div>
      </div>
    </div>
  );
}
