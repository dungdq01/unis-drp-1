'use client';

import { useState } from 'react';
import type { OverrideDto } from '@/lib/api/demand';

export interface OverrideCellData {
  itemCode: string;
  segment: string;
  period?: string;          // from pivot cell click "2025-12"
  qty?: number;             // current qty from cell
  totalQty?: number;        // total across periods
  lineCount?: number;
  snapshotId?: string;
}

interface OverrideDialogProps {
  open: boolean;
  onClose: () => void;
  line: OverrideCellData | null;
  onOverride: (data: OverrideDto) => Promise<unknown>;
}

export function OverrideDialog({ open, onClose, line, onOverride }: OverrideDialogProps) {
  const [newQty, setNewQty] = useState('');
  const [reason, setReason] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [overriddenBy, setOverriddenBy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open || !line) return null;

  const handleSubmit = async () => {
    setError('');
    const qty = Number(newQty);
    if (isNaN(qty) || qty < 0) {
      setError('Quantity must be a non-negative number');
      return;
    }
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }
    if (!overriddenBy.trim()) {
      setError('Your name/email is required');
      return;
    }
    // Period: from cell click ("2025-12") → "2025-12-01"
    const periodStart = line.period
      ? (line.period.length === 7 ? line.period + '-01' : line.period)
      : '';
    if (!periodStart) {
      setError('Period not available — click a specific month cell');
      return;
    }
    setSubmitting(true);
    try {
      await onOverride({
        snapshotId: line.snapshotId || '',
        itemCode: line.itemCode,
        locationCode: locationCode.trim() || 'ALL',
        periodStart,
        newQty: qty,
        reason: reason.trim(),
        overriddenBy: overriddenBy.trim(),
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Override failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-slate-800">Override Forecast</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</div>
        )}

        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>Item: <span className="font-mono text-slate-700">{line.itemCode}</span></span>
              <span>Segment: <span className="font-mono text-slate-700">{line.segment}</span></span>
            </div>
            {line.period && (
              <div className="text-xs text-slate-500">
                Period: <span className="font-mono text-slate-700">{line.period}</span>
                {line.qty !== undefined && <> · Current qty: <span className="font-mono text-slate-700">{line.qty.toLocaleString()}</span></>}
              </div>
            )}
          </div>

          {/* Location Code */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Location Code</label>
            <input
              type="text"
              value={locationCode}
              onChange={e => setLocationCode(e.target.value)}
              placeholder="e.g. 010 (branch code) or ALL"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none"
            />
          </div>

          {/* Overridden By */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Your Name / Email <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={overriddenBy}
              onChange={e => setOverriddenBy(e.target.value)}
              placeholder="e.g. planner@unis.vn"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Current Qty</label>
            <input
              value={(line.totalQty ?? 0).toLocaleString()}
              readOnly
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 font-mono"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">New Qty</label>
            <input
              type="number"
              min={0}
              value={newQty}
              onChange={e => setNewQty(e.target.value)}
              placeholder="Enter new quantity"
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 font-mono placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Reason *</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this override needed?"
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300 resize-none focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 disabled:opacity-50 transition-all"
            >
              {submitting ? 'Saving...' : 'Apply Override'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
