'use client';

import { useState } from 'react';
import type { SnapshotStatus } from '@/lib/api/demand';

interface FreezeButtonProps {
  snapshotId: string;
  status: SnapshotStatus;
  totalLines: number;
  onFreeze: (id: string) => Promise<void>;
}

export function FreezeButton({ snapshotId, status, totalLines, onFreeze }: FreezeButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  if (status === 'FROZEN') {
    return (
      <span className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold tracking-wide badge-sky">
        Already Frozen
      </span>
    );
  }

  const disabled = totalLines === 0;

  const handleClick = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setLoading(true);
    try {
      await onFreeze(snapshotId);
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={disabled || loading}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
          confirming
            ? 'text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600'
            : 'text-white bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600'
        } disabled:opacity-40`}
      >
        {loading ? 'Freezing...' : confirming ? 'Confirm Freeze?' : 'Freeze Snapshot'}
      </button>
      {confirming && !loading && (
        <button
          onClick={() => setConfirming(false)}
          className="text-[11px] text-slate-400 hover:text-slate-600"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
