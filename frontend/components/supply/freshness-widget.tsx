'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchFreshnessStatus, type FreshnessStatus } from '@/lib/api/supply';

const POLL_MS = 5 * 60 * 1000; // 5 minutes

export function FreshnessWidget() {
  const [status, setStatus] = useState<FreshnessStatus | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchFreshnessStatus();
      setStatus(data);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (error || !status) {
    return (
      <div className="glass-card px-4 py-2 flex items-center gap-2">
        <span className="text-xs text-slate-400">
          {error ? 'Không thể tải trạng thái freshness' : 'Đang tải...'}
        </span>
      </div>
    );
  }

  const { overallFreshness, ageMinutes, thresholdMinutes, staleLocations } = status;

  if (overallFreshness === 'NO_DATA') {
    return (
      <div className="glass-card px-4 py-2 flex items-center gap-2">
        <div className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        <span className="text-xs text-slate-500">Chưa có dữ liệu tồn kho</span>
      </div>
    );
  }

  if (overallFreshness === 'PASS') {
    return (
      <div className="glass-card px-4 py-2 flex items-center gap-2 border-l-4 border-emerald-400">
        <span className="text-xs text-emerald-700 font-medium">
          ✅ Data fresh — {ageMinutes} phút trước
        </span>
      </div>
    );
  }

  // STALE
  return (
    <div className="glass-card px-4 py-2 flex items-center gap-2 border-l-4 border-amber-400">
      <span className="text-xs text-amber-700 font-medium">
        ⚠️ Data cũ — {ageMinutes} phút (threshold: {thresholdMinutes} phút)
        {staleLocations.length > 0 && (
          <> · {staleLocations.length} kho chưa sync</>
        )}
      </span>
    </div>
  );
}
