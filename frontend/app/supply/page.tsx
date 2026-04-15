'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  fetchSnapshots,
  fetchSnapshot,
  fetchFreshnessStatus,
  captureSnapshot,
  uploadBravo,
  freezeSnapshot,
  acknowledgeStale,
  type SupplySnapshot,
  type FreshnessStatus,
  type BravoUploadResult,
} from '@/lib/api/supply';

import { FreshnessWidget } from '@/components/supply/freshness-widget';
import { StaleWarningBanner } from '@/components/supply/stale-warning-banner';
import { SupplyKpiCards } from '@/components/supply/supply-kpi-cards';
import { SnapshotListTable } from '@/components/supply/snapshot-list-table';
import { CaptureDialog } from '@/components/supply/capture-dialog';
import { BravoUploadDialog } from '@/components/supply/bravo-upload-dialog';
import { InventoryLinesTable } from '@/components/supply/inventory-lines-table';
import { SnapshotDetailPanel } from '@/components/supply/snapshot-detail-panel';
import { SupplyDashboard } from '@/components/supply/supply-dashboard';

export default function SupplyPage() {
  const searchParams = useSearchParams();
  const [snapshots, setSnapshots] = useState<SupplySnapshot[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | undefined>(
    searchParams.get('snapshot') ?? undefined
  );
  const [selectedSnapshot, setSelectedSnapshot] = useState<SupplySnapshot | null>(null);
  const [freshness, setFreshness] = useState<FreshnessStatus | null>(null);
  const [tab, setTab] = useState<'dashboard' | 'list' | 'inventory' | 'detail'>('dashboard');
  const [showCapture, setShowCapture] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showAcknowledge, setShowAcknowledge] = useState(false);
  const [acknowledgeReason, setAcknowledgeReason] = useState('');
  const [acknowledgeLoading, setAcknowledgeLoading] = useState(false);
  const [acknowledgeError, setAcknowledgeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSnapshots = useCallback(async (): Promise<SupplySnapshot[]> => {
    try {
      const data = await fetchSnapshots();
      setSnapshots(data);
      // Auto-select the latest snapshot for inventory view
      if (data.length > 0) {
        const targetId = selectedSnapshotId ?? data[0].id;
        const target = data.find(s => s.id === targetId) ?? data[0];
        setSelectedSnapshotId(target.id);
        setSelectedSnapshot(target);
      }
      return data;
    } catch {
      return [];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFreshness = useCallback(async () => {
    try {
      const data = await fetchFreshnessStatus();
      setFreshness(data);
    } catch {
      // silent fail
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadSnapshots(), loadFreshness()]);
      setLoading(false);
    };
    init();
  }, [loadSnapshots, loadFreshness]);

  // The latest DRAFT snapshot (for stale banner)
  const latestDraft = snapshots.find((s) => s.status === 'DRAFT') ?? null;
  const showStaleBanner = latestDraft !== null && latestDraft.freshness === 'STALE' && !latestDraft.staleAcknowledged;

  const handleCapture = async (name: string, includeInTransit: boolean, locationCodes?: string[]) => {
    await captureSnapshot({ snapshotName: name, includeInTransit, locationCodes });
    await loadSnapshots();
    await loadFreshness();
  };

  const handleUpload = async (file: File): Promise<BravoUploadResult> => {
    const result = await uploadBravo(file);
    await loadFreshness();
    await loadSnapshots();
    return result;
  };

  const handleFreeze = async (id: string) => {
    try {
      await freezeSnapshot(id);
      const updated = await loadSnapshots();
      if (selectedSnapshotId === id) {
        const found = updated.find((s) => s.id === id) ?? null;
        setSelectedSnapshot(found);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Freeze thất bại');
    }
  };

  const handleSelect = async (id: string) => {
    setSelectedSnapshotId(id);
    setTab('detail');
    try {
      const detail = await fetchSnapshot(id);
      setSelectedSnapshot(detail);
    } catch {
      const fallback = snapshots.find((s) => s.id === id) ?? null;
      setSelectedSnapshot(fallback);
    }
  };

  const handleAcknowledge = async () => {
    const targetId = selectedSnapshotId ?? latestDraft?.id;
    if (!targetId) return;
    if (!acknowledgeReason.trim()) {
      setAcknowledgeError('Vui lòng nhập lý do');
      return;
    }
    setAcknowledgeLoading(true);
    setAcknowledgeError(null);
    try {
      await acknowledgeStale(targetId, acknowledgeReason.trim());
      setShowAcknowledge(false);
      setAcknowledgeReason('');
      const updated = await loadSnapshots();
      if (selectedSnapshotId) {
        const found = updated.find((s) => s.id === selectedSnapshotId) ?? null;
        setSelectedSnapshot(found);
      }
    } catch (e) {
      setAcknowledgeError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setAcknowledgeLoading(false);
    }
  };

  const kpiSnapshot = selectedSnapshot ?? snapshots[0] ?? null;

  return (
    <div className="p-6 space-y-5">
      {/* ─── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100">
            <span className="font-mono text-sm font-bold text-orange-600">02</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Supply Snapshot</h1>
            <p className="text-sm text-slate-500">Tồn kho · Capture · Freeze</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowUpload(true)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 shadow-sm transition-all"
          >
            Upload Bravo
          </button>
          <button
            onClick={() => setShowCapture(true)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 shadow-sm transition-all"
          >
            Capture Snapshot
          </button>
        </div>
      </div>

      {/* ─── Tab Switcher ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab('dashboard')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'dashboard'
              ? 'text-orange-600 border-b-2 border-orange-500 -mb-px'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setTab('list')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'list'
              ? 'text-orange-600 border-b-2 border-orange-500 -mb-px'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Snapshot List
          {snapshots.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-600">
              {snapshots.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('inventory')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'inventory'
              ? 'text-orange-600 border-b-2 border-orange-500 -mb-px'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Tồn kho
          {selectedSnapshot && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded bg-orange-100 text-orange-600">
              {selectedSnapshot.totalLines.toLocaleString()}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('detail')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'detail'
              ? 'text-orange-600 border-b-2 border-orange-500 -mb-px'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Detail &amp; Lines
        </button>
      </div>

      {/* ─── Freshness Widget ──────────────────────────────────────────────── */}
      <FreshnessWidget />

      {/* ─── Stale Warning Banner ──────────────────────────────────────────── */}
      {showStaleBanner && latestDraft && (
        <>
          <StaleWarningBanner
            snapshot={latestDraft}
            onAcknowledge={() => {
              setShowAcknowledge(true);
              setAcknowledgeError(null);
              setAcknowledgeReason('');
            }}
            onCapture={() => setShowCapture(true)}
            onOverride={() => setTab('detail')}
          />

          {/* Inline acknowledge form */}
          {showAcknowledge && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
              <p className="text-xs font-medium text-amber-800">Nhập lý do để acknowledge STALE:</p>
              <div className="flex gap-2 items-start">
                <input
                  type="text"
                  value={acknowledgeReason}
                  onChange={(e) => setAcknowledgeReason(e.target.value)}
                  placeholder="VD: Đã xác nhận tồn kho không thay đổi đáng kể..."
                  disabled={acknowledgeLoading}
                  className="flex-1 rounded-lg border border-amber-200 px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
                />
                <button
                  onClick={handleAcknowledge}
                  disabled={acknowledgeLoading || !acknowledgeReason.trim()}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {acknowledgeLoading && (
                    <svg className="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  )}
                  Xác nhận
                </button>
                <button
                  onClick={() => {
                    setShowAcknowledge(false);
                    setAcknowledgeReason('');
                    setAcknowledgeError(null);
                  }}
                  disabled={acknowledgeLoading}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-amber-700 bg-white border border-amber-200 hover:bg-amber-50 transition-colors disabled:opacity-50"
                >
                  Hủy
                </button>
              </div>
              {acknowledgeError && (
                <p className="text-xs text-red-600">{acknowledgeError}</p>
              )}
            </div>
          )}
        </>
      )}

      {/* ─── KPI Cards ─────────────────────────────────────────────────────── */}
      <SupplyKpiCards snapshot={kpiSnapshot} freshness={freshness} />

      {/* ─── TAB: DASHBOARD ───────────────────────────────────────────────── */}
      {tab === 'dashboard' && (
        <SupplyDashboard snapshots={snapshots} freshness={freshness} />
      )}

      {/* ─── TAB: LIST ─────────────────────────────────────────────────────── */}
      {tab === 'list' && (
        <>
          {loading ? (
            <div className="glass-card py-12 flex items-center justify-center">
              <div className="flex items-center gap-3 text-slate-400">
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span className="text-sm">Đang tải snapshots...</span>
              </div>
            </div>
          ) : (
            <SnapshotListTable
              snapshots={snapshots}
              onSelect={handleSelect}
              onFreeze={handleFreeze}
              selectedId={selectedSnapshotId}
            />
          )}
        </>
      )}

      {/* ─── TAB: TỒN KHO ─────────────────────────────────────────────────── */}
      {tab === 'inventory' && (
        <div className="space-y-2">
          {selectedSnapshot && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Snapshot:</span>
              <span className="font-medium text-slate-700">{selectedSnapshot.snapshotName}</span>
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                {new Date(selectedSnapshot.captureAt).toLocaleString('vi-VN')}
              </span>
              <button
                onClick={() => setTab('list')}
                className="underline text-orange-500 hover:text-orange-600"
              >
                Đổi snapshot
              </button>
            </div>
          )}
          {selectedSnapshotId ? (
            <InventoryLinesTable snapshotId={selectedSnapshotId} />
          ) : (
            <div className="glass-card flex items-center justify-center py-16">
              <p className="text-sm text-slate-400">Chưa có snapshot. Hãy Capture Snapshot trước.</p>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: DETAIL ───────────────────────────────────────────────────── */}
      {tab === 'detail' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch min-h-[600px]">
          {/* Left: Snapshot detail panel */}
          <div className="lg:col-span-1 flex flex-col">
            <SnapshotDetailPanel snapshot={selectedSnapshot} />
          </div>

          {/* Right: Inventory lines */}
          <div className="lg:col-span-2 flex flex-col">
            {selectedSnapshotId ? (
              <InventoryLinesTable snapshotId={selectedSnapshotId} />
            ) : (
              <div className="glass-card flex-1 flex items-center justify-center min-h-[500px]">
                <p className="text-sm text-slate-400">
                  Chọn snapshot từ tab List để xem inventory lines
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Dialogs ───────────────────────────────────────────────────────── */}
      <CaptureDialog
        open={showCapture}
        onClose={() => setShowCapture(false)}
        onCapture={handleCapture}
      />
      <BravoUploadDialog
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onUpload={handleUpload}
        onCaptureNow={() => setShowCapture(true)}
      />
    </div>
  );
}
