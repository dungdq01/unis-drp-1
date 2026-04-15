'use client';

import { type SupplySnapshot } from '@/lib/api/supply';

interface Props {
  snapshot: SupplySnapshot;
  onAcknowledge: () => void;
  onCapture: () => void;
  onOverride?: () => void;
}

export function StaleWarningBanner({ snapshot, onAcknowledge, onCapture, onOverride }: Props) {
  if (snapshot.freshness !== 'STALE' || snapshot.staleAcknowledged) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="text-red-500 text-base leading-none mt-0.5">⚠️</span>
        <p className="text-sm text-red-800">
          <span className="font-semibold">Dữ liệu tồn kho cũ {snapshot.freshnessAgeMinutes} phút</span>{' '}
          (threshold: 240 phút). Khuyến nghị re-sync trước khi chạy DRP.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onAcknowledge}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 border border-amber-200 transition-colors"
        >
          Acknowledge và tiếp tục
        </button>
        <button
          onClick={onCapture}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 shadow-sm transition-all"
        >
          Capture lại
        </button>
        {onOverride && (
          <button
            onClick={onOverride}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors"
          >
            Override thủ công
          </button>
        )}
      </div>
    </div>
  );
}
