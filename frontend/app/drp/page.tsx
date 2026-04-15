'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createDrpRun, listPlanRuns,
  getPlannedOrders, getNettingDetail,
  approvePlannedOrder, cancelPlannedOrder,
  getExceptions, resolveException, getHstkSummary,
  type PlanRun, type PlannedOrder, type DrpExceptionItem, type HstkSummary,
  type OrderStatus, type ExceptionType, type ExceptionSeverity,
} from '@/lib/api/drp';
import { fetchSnapshots as fetchDemandSnapshots } from '@/lib/api/demand';
import { fetchSnapshots as fetchSupplySnapshots } from '@/lib/api/supply';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number | string | null | undefined, dec = 0) {
  if (n === null || n === undefined) return '—';
  return Number(n).toFixed(dec);
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    RUNNING:   'bg-sky-100 text-sky-700',
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    FAILED:    'bg-red-100 text-red-700',
    TIMEOUT:   'bg-amber-100 text-amber-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${map[status] ?? 'bg-slate-100 text-slate-500'} ${status === 'RUNNING' ? 'animate-pulse' : ''}`}>
      {status}
    </span>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    AUTO_RELEASE:   'bg-emerald-100 text-emerald-700',
    NEEDS_APPROVAL: 'bg-amber-100 text-amber-800',
    RELEASED:       'bg-sky-100 text-sky-700',
    CANCELLED:      'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${map[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    HIGH:   'bg-red-100 text-red-700',
    MEDIUM: 'bg-amber-100 text-amber-700',
    LOW:    'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${map[severity] ?? 'bg-slate-100 text-slate-500'}`}>
      {severity}
    </span>
  );
}

function pabColor(pab: number, ss: number) {
  if (pab < 0) return 'text-red-600 font-bold';
  if (pab < ss) return 'text-amber-600 font-semibold';
  return 'text-emerald-700';
}

// ─── Create Run Dialog ─────────────────────────────────────────────────────────

function CreateRunDialog({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (run: PlanRun) => void;
}) {
  const [demandSnapshotId, setDemandSnapshotId] = useState('');
  const [supplySnapshotId, setSupplySnapshotId] = useState('');
  const [horizonStart, setHorizonStart] = useState('');
  const [horizonWeeks, setHorizonWeeks] = useState(12);
  const [frozenZone, setFrozenZone] = useState(2);
  const [createdBy, setCreatedBy] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demandSnaps, setDemandSnaps] = useState<any[]>([]);
  const [supplySnaps, setSupplySnaps] = useState<any[]>([]);

  useEffect(() => {
    fetchDemandSnapshots().then(d => setDemandSnaps((d as any)?.data ?? d)).catch(() => {});
    fetchSupplySnapshots().then(s => setSupplySnaps((s as any)?.data ?? s)).catch(() => {});
  }, []);

  // Auto-fill horizonStart when demand snapshot changes
  const handleDemandChange = (id: string) => {
    setDemandSnapshotId(id);
    const snap = demandSnaps.find((s: any) => (s.id ?? s.snapshotId) === id);
    if (snap?.horizonStart) {
      // ISO string → date input format YYYY-MM-DD
      setHorizonStart(snap.horizonStart.slice(0, 10));
    } else {
      setHorizonStart('');
    }
  };

  const handleSubmit = async () => {
    if (!demandSnapshotId || !supplySnapshotId) {
      setError('Phải chọn demand snapshot và supply snapshot');
      return;
    }
    setLoading(true); setError(null);
    try {
      const run = await createDrpRun({
        demandSnapshotId,
        supplySnapshotId: Number(supplySnapshotId),
        horizonStart: horizonStart || undefined,
        horizonWeeks,
        frozenZone,
        createdBy: createdBy || undefined,
      });
      onCreated(run);
    } catch (e: any) {
      setError(e.message ?? 'Lỗi tạo plan run');
    } finally {
      setLoading(false);
    }
  };

  const frozenDemand = demandSnaps.filter((s: any) => s.status === 'FROZEN');
  const frozenSupply = supplySnaps.filter((s: any) => s.status === 'FROZEN');

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <h2 className="text-sm font-bold text-slate-800">Tạo DRP Plan Run</h2>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Demand Snapshot (FROZEN)</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
              value={demandSnapshotId}
              onChange={e => handleDemandChange(e.target.value)}
            >
              <option value="">— Chọn —</option>
              {frozenDemand.map((s: any) => (
                <option key={s.id ?? s.snapshotId} value={s.id ?? s.snapshotId}>
                  {s.snapshotName} ({(s.id ?? s.snapshotId ?? '').toString().slice(0, 8)}…)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Supply Snapshot (FROZEN)</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
              value={supplySnapshotId}
              onChange={e => setSupplySnapshotId(e.target.value)}
            >
              <option value="">— Chọn —</option>
              {frozenSupply.map((s: any) => (
                <option key={s.id} value={s.id}>{s.snapshotName} (ID: {s.id})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              Horizon Start <span className="text-slate-400">(tự động từ demand snapshot)</span>
            </label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
              value={horizonStart}
              onChange={e => setHorizonStart(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                Horizon (tuần) <span className="text-slate-400">4–24</span>
              </label>
              <input
                type="number"
                min={4} max={24}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                value={horizonWeeks}
                onChange={e => setHorizonWeeks(Math.min(24, Math.max(4, Number(e.target.value))))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                Frozen Zone (tuần) <span className="text-slate-400">0–8</span>
              </label>
              <input
                type="number"
                min={0} max={8}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                value={frozenZone}
                onChange={e => setFrozenZone(Math.min(8, Math.max(0, Number(e.target.value))))}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Created By (tuỳ chọn)</label>
            <input
              type="text"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="planner@unis.vn"
              value={createdBy}
              onChange={e => setCreatedBy(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}

        <div className="flex gap-3 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">
            Huỷ
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 text-white shadow-sm disabled:opacity-50"
          >
            {loading ? 'Đang chạy…' : 'Chạy DRP'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Run Dashboard ────────────────────────────────────────────────────────

function RunDetailPanel({ run, onClose }: { run: PlanRun; onClose: () => void }) {
  const cfg = run.configJson ?? {};
  const horizonStart = cfg.horizonStart ? new Date(cfg.horizonStart as string).toLocaleDateString('vi-VN') : '—';
  const horizonWeeks = cfg.horizonWeeks ?? '—';
  const frozenZone   = cfg.frozenZone   ?? '—';
  const lotSizing    = cfg.lotSizing    ?? '—';

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-sky-50 border-b border-sky-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} />
          <span className="text-sm font-semibold text-slate-800">Plan Run #{run.id}</span>
          <span className="text-xs text-slate-400">· {fmtDate(run.createdAt)}</span>
          {run.createdBy && <span className="text-xs text-slate-500">by {run.createdBy}</span>}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1">×</button>
      </div>

      <div className="p-4 grid grid-cols-2 gap-4">
        {/* Left: Stats */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Kết quả netting</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Combos processed', value: (run.combinationsProcessed ?? 0).toLocaleString() },
              { label: 'Planned orders',   value: (run.plannedOrdersCount ?? 0).toLocaleString() },
              { label: 'Exceptions',       value: run.exceptionsCount ?? 0, red: (run.exceptionsCount ?? 0) > 0 },
              { label: 'Duration',         value: run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—' },
              { label: 'Started at',       value: fmtDate(run.startedAt) },
              { label: 'Completed at',     value: fmtDate(run.completedAt) },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                <p className="text-[10px] text-slate-400">{s.label}</p>
                <p className={`text-sm font-bold mt-0.5 ${'red' in s && s.red ? 'text-red-600' : 'text-slate-800'}`}>{String(s.value)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Config + Links */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Cấu hình & Nguồn dữ liệu</p>

          {/* Config */}
          <div className="bg-white rounded-lg border border-slate-100 px-3 py-2 space-y-1.5">
            {[
              { label: 'Horizon Start', value: horizonStart },
              { label: 'Horizon Weeks', value: String(horizonWeeks) },
              { label: 'Frozen Zone',   value: `${frozenZone} weeks` },
              { label: 'Lot Sizing',    value: String(lotSizing) },
            ].map(c => (
              <div key={c.label} className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{c.label}</span>
                <span className="font-mono font-semibold text-slate-700">{c.value}</span>
              </div>
            ))}
          </div>

          {/* Snapshot links */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-slate-400 uppercase">Snapshot sources</p>

            {/* Demand snapshot */}
            <a
              href={`/demand?snapshot=${run.demandSnapshotId}`}
              className="flex items-center justify-between bg-white rounded-lg border border-emerald-200 px-3 py-2.5 hover:bg-emerald-50 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-emerald-700">01</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-700">Demand Snapshot</p>
                  <p className="text-[10px] text-slate-400 font-mono">{run.demandSnapshotId?.slice(0, 16)}…</p>
                </div>
              </div>
              <span className="text-emerald-500 group-hover:translate-x-0.5 transition-transform text-sm">→</span>
            </a>

            {/* Supply snapshot */}
            <a
              href={`/supply?snapshot=${run.supplySnapshotId}`}
              className="flex items-center justify-between bg-white rounded-lg border border-sky-200 px-3 py-2.5 hover:bg-sky-50 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-sky-100 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-sky-700">02</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-700">Supply Snapshot</p>
                  <p className="text-[10px] text-slate-400 font-mono">ID: {run.supplySnapshotId}</p>
                </div>
              </div>
              <span className="text-sky-500 group-hover:translate-x-0.5 transition-transform text-sm">→</span>
            </a>

            {/* Policy link */}
            <a
              href="/policy"
              className="flex items-center justify-between bg-white rounded-lg border border-violet-200 px-3 py-2.5 hover:bg-violet-50 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-violet-100 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-violet-700">03</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-700">Inventory &amp; Policy</p>
                  <p className="text-[10px] text-slate-400">Safety Stock · ABC · RTM</p>
                </div>
              </div>
              <span className="text-violet-500 group-hover:translate-x-0.5 transition-transform text-sm">→</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabRunDashboard({ runs, selectedRun, onSelectRun, onRefresh, onCreateRun }: {
  runs: PlanRun[];
  selectedRun: PlanRun | null;
  onSelectRun: (r: PlanRun) => void;
  onRefresh: () => void;
  onCreateRun: () => void;
}) {
  const [detailRun, setDetailRun] = useState<PlanRun | null>(null);

  const handleRowClick = (r: PlanRun) => {
    onSelectRun(r);
    setDetailRun(prev => prev?.id === r.id ? null : r); // toggle
  };

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      {selectedRun && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Status',         value: <RunStatusBadge status={selectedRun.status} />, sub: `Run #${selectedRun.id}` },
            { label: 'Combos',         value: (selectedRun.combinationsProcessed ?? 0).toLocaleString(), sub: 'combinations' },
            { label: 'Planned Orders', value: (selectedRun.plannedOrdersCount ?? 0).toLocaleString(), sub: 'order rows' },
            { label: 'Exceptions',     value: selectedRun.exceptionsCount ?? 0, sub: (selectedRun.exceptionsCount ?? 0) > 0 ? 'cần xử lý' : 'clear' },
          ].map(m => (
            <div key={m.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">{m.label}</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{m.value}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{m.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Detail panel */}
      {detailRun && (
        <RunDetailPanel run={detailRun} onClose={() => setDetailRun(null)} />
      )}

      {/* Plan runs table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-700">Plan Runs</h3>
            <span className="text-xs text-slate-400">{runs.length} runs</span>
            {detailRun && <span className="text-xs text-sky-500">· click row để xem/ẩn chi tiết</span>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onRefresh}
              className="rounded-lg px-3 py-1.5 text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              onClick={onCreateRun}
              className="rounded-lg px-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 shadow-sm"
            >
              + Tạo Plan Run
            </button>
          </div>
        </div>

        {runs.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            Chưa có plan run. Nhấn <strong>&quot;+ Tạo Plan Run&quot;</strong> để bắt đầu.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {['ID', 'Status', 'Horizon Start', 'Combos', 'Orders', 'Exceptions', 'Duration', 'Created', 'By'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map(r => (
                  <tr
                    key={r.id}
                    onClick={() => handleRowClick(r)}
                    className={`cursor-pointer hover:bg-slate-50 transition-colors ${selectedRun?.id === r.id ? 'bg-sky-50' : ''} ${detailRun?.id === r.id ? 'border-l-2 border-sky-400' : ''}`}
                  >
                    <td className="px-3 py-2.5 font-mono font-semibold text-sky-600">#{r.id}</td>
                    <td className="px-3 py-2.5"><RunStatusBadge status={r.status} /></td>
                    <td className="px-3 py-2.5 text-slate-500">
                      {r.configJson?.horizonStart
                        ? new Date(r.configJson.horizonStart as string).toLocaleDateString('vi-VN')
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{(r.combinationsProcessed ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-700">{(r.plannedOrdersCount ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2.5">
                      <span className={(r.exceptionsCount ?? 0) > 0 ? 'text-red-600 font-bold' : 'text-slate-400'}>
                        {r.exceptionsCount ?? 0}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">
                      {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">{fmtDate(r.createdAt)}</td>
                    <td className="px-3 py-2.5 text-slate-400">{r.createdBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {runs.some(r => r.status === 'RUNNING') && (
        <p className="text-xs text-sky-600 text-center animate-pulse">
          ⟳ DRP netting đang chạy… bấm Refresh để cập nhật
        </p>
      )}
    </div>
  );
}

// ─── Tab: Planned Orders ───────────────────────────────────────────────────────

function TabPlannedOrders({ planRunId }: { planRunId: string }) {
  const [orders, setOrders] = useState<PlannedOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filterItem, setFilterItem] = useState('');
  const [filterLoc, setFilterLoc] = useState('');
  const [filterStatus, setFilterStatus] = useState<OrderStatus | ''>('');
  const [filterFrozen, setFilterFrozen] = useState<'' | 'true' | 'false'>('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const LIMIT = 50;

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await getPlannedOrders(planRunId, {
        page: p, pageSize: LIMIT,
        itemCode: filterItem || undefined,
        locationCode: filterLoc || undefined,
        status: filterStatus || undefined,
        frozenZoneFlag: filterFrozen === '' ? undefined : filterFrozen === 'true',
      });
      setOrders(res.data);
      setTotal(res.meta.total);
      setPage(p);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [planRunId, filterItem, filterLoc, filterStatus, filterFrozen]);

  useEffect(() => { load(1); }, [load]);

  const handleApprove = async (id: string) => {
    setActionLoading(true); setActionError(null);
    try {
      const updated = await approvePlannedOrder(id, 'planner');
      setOrders(prev => prev.map(o => o.id === id ? updated : o));
    } catch (e: any) { setActionError(e.message); }
    finally { setActionLoading(false); }
  };

  const handleCancel = async (id: string) => {
    if (!cancelReason.trim()) { setActionError('Nhập lý do huỷ'); return; }
    setActionLoading(true); setActionError(null);
    try {
      const updated = await cancelPlannedOrder(id, cancelReason, 'planner');
      setOrders(prev => prev.map(o => o.id === id ? updated : o));
      setActionId(null); setCancelReason('');
    } catch (e: any) { setActionError(e.message); }
    finally { setActionLoading(false); }
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex flex-wrap gap-2 items-end">
          <input
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-sky-400"
            placeholder="Item Code"
            value={filterItem}
            onChange={e => setFilterItem(e.target.value)}
          />
          <input
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs w-32 focus:outline-none focus:ring-2 focus:ring-sky-400"
            placeholder="Location"
            value={filterLoc}
            onChange={e => setFilterLoc(e.target.value)}
          />
          <select
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as any)}
          >
            <option value="">All Status</option>
            <option value="AUTO_RELEASE">AUTO_RELEASE</option>
            <option value="NEEDS_APPROVAL">NEEDS_APPROVAL</option>
            <option value="RELEASED">RELEASED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
          <select
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={filterFrozen}
            onChange={e => setFilterFrozen(e.target.value as any)}
          >
            <option value="">All Zone</option>
            <option value="true">❄ Frozen Zone</option>
            <option value="false">Free Zone</option>
          </select>
          <button
            onClick={() => load(1)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-sky-500 to-blue-500 text-white hover:from-sky-600 hover:to-blue-600 shadow-sm"
          >
            Lọc
          </button>
          <span className="text-xs text-slate-400 ml-auto">{total.toLocaleString()} rows</span>
        </div>
      </div>

      {actionError && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">{actionError}</p>}

      {/* Cancel inline panel */}
      {actionId && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
          <span className="text-xs text-amber-700 font-medium">Lý do huỷ:</span>
          <input
            className="border border-amber-300 rounded-lg px-3 py-1.5 text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-amber-400"
            placeholder="Nhập lý do…"
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
          />
          <button onClick={() => handleCancel(actionId)} disabled={actionLoading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
            Xác nhận
          </button>
          <button onClick={() => { setActionId(null); setCancelReason(''); setActionError(null); }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">
            Bỏ
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                {['Item', 'Location', 'Wk', 'Week Start', 'GR', 'SR', 'PAB Before', 'NR', 'PO Qty', 'PAB After', 'SS', 'HSTK', 'Status', 'FZ', ''].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={15} className="px-3 py-8 text-center text-slate-400">Đang tải…</td></tr>}
              {!loading && orders.length === 0 && <tr><td colSpan={15} className="px-3 py-8 text-center text-slate-400">Không có dữ liệu</td></tr>}
              {orders.map(o => (
                <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-2 font-mono text-slate-700">{o.itemCode}</td>
                  <td className="px-3 py-2 text-slate-500">{o.locationCode}</td>
                  <td className="px-3 py-2 text-center font-semibold text-slate-700">{o.weekNumber}</td>
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{new Date(o.weekStartDate).toLocaleDateString('vi-VN')}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{fmtNum(o.grossRequirement)}</td>
                  <td className="px-3 py-2 text-right text-sky-600">{fmtNum(o.scheduledReceipt)}</td>
                  <td className={`px-3 py-2 text-right ${pabColor(Number(o.pabBefore), Number(o.safetyStock))}`}>{fmtNum(o.pabBefore)}</td>
                  <td className="px-3 py-2 text-right text-amber-600">{fmtNum(o.netRequirement)}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800">{fmtNum(o.plannedOrderQty)}</td>
                  <td className={`px-3 py-2 text-right ${pabColor(Number(o.pabAfter), Number(o.safetyStock))}`}>{fmtNum(o.pabAfter)}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{fmtNum(o.safetyStock)}</td>
                  <td className="px-3 py-2 text-right">
                    {o.hstk === null ? <span className="text-slate-300">—</span> : (
                      <span className={Number(o.hstk) < 1.5 ? 'text-red-600 font-bold' : Number(o.hstk) > 3.0 ? 'text-amber-600' : 'text-emerald-600'}>
                        {fmtNum(o.hstk, 1)}w
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2"><OrderStatusBadge status={o.status} /></td>
                  <td className="px-3 py-2 text-center">{o.frozenZoneFlag ? <span className="text-amber-500">❄</span> : ''}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {o.status === 'NEEDS_APPROVAL' && (
                        <button onClick={() => handleApprove(o.id)} disabled={actionLoading}
                          className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                          Approve
                        </button>
                      )}
                      {(o.status === 'AUTO_RELEASE' || o.status === 'NEEDS_APPROVAL') && (
                        <button onClick={() => { setActionId(o.id); setActionError(null); }}
                          className="px-2 py-0.5 rounded text-[10px] font-medium text-red-600 border border-red-200 hover:bg-red-50">
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
            <span>{total.toLocaleString()} rows · Trang {page} / {totalPages}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => load(1)} disabled={page === 1} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">«</button>
              <button onClick={() => load(page - 1)} disabled={page === 1} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">‹</button>
              <span className="px-3">{page}</span>
              <button onClick={() => load(page + 1)} disabled={page === totalPages} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">›</button>
              <button onClick={() => load(totalPages)} disabled={page === totalPages} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">»</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Exceptions ───────────────────────────────────────────────────────────

function TabExceptions({ planRunId }: { planRunId: string }) {
  const [items, setItems] = useState<DrpExceptionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<ExceptionType | ''>('');
  const [filterSeverity, setFilterSeverity] = useState<ExceptionSeverity | ''>('');
  const [filterResolved, setFilterResolved] = useState<'' | 'false' | 'true'>('false');
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getExceptions(planRunId, {
        pageSize: 100,
        type: filterType || undefined,
        severity: filterSeverity || undefined,
        resolved: filterResolved === '' ? undefined : filterResolved === 'true',
      });
      setItems(res.data);
      setTotal(res.meta.total);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [planRunId, filterType, filterSeverity, filterResolved]);

  useEffect(() => { load(); }, [load]);

  const highCount   = items.filter(i => i.severity === 'HIGH'   && !i.resolved).length;
  const medCount    = items.filter(i => i.severity === 'MEDIUM' && !i.resolved).length;
  const lowCount    = items.filter(i => i.severity === 'LOW'    && !i.resolved).length;

  const handleResolve = async () => {
    if (!resolveId || !resolveNote.trim()) { setActionError('Nhập ghi chú'); return; }
    setActionLoading(true); setActionError(null);
    try {
      const updated = await resolveException(planRunId, resolveId, resolveNote, 'planner');
      setItems(prev => prev.map(i => i.id === resolveId ? updated : i));
      setResolveId(null); setResolveNote('');
    } catch (e: any) { setActionError(e.message); }
    finally { setActionLoading(false); }
  };

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <p className="text-xs font-medium text-red-600">HIGH</p>
          <p className="text-2xl font-bold text-red-700 mt-1">{highCount}</p>
          <p className="text-[11px] text-red-400 mt-0.5">cần xử lý ngay</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-xs font-medium text-amber-600">MEDIUM</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{medCount}</p>
          <p className="text-[11px] text-amber-400 mt-0.5">theo dõi</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">LOW</p>
          <p className="text-2xl font-bold text-slate-700 mt-1">{lowCount}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">thông tin</p>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex flex-wrap gap-2 items-center">
          <select className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={filterType} onChange={e => setFilterType(e.target.value as any)}>
            <option value="">All Types</option>
            {['PAB_NEGATIVE','STOCKOUT_ALERT','OVERSTOCK_ALERT','FROZEN_ZONE_VIOLATION','MISSING_SS','NETTING_TIMEOUT'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={filterSeverity} onChange={e => setFilterSeverity(e.target.value as any)}>
            <option value="">All Severity</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
          <select className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={filterResolved} onChange={e => setFilterResolved(e.target.value as any)}>
            <option value="">Tất cả</option>
            <option value="false">Chưa resolved</option>
            <option value="true">Đã resolved</option>
          </select>
          <button onClick={load}
            className="rounded-lg px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-sky-500 to-blue-500 text-white hover:from-sky-600 hover:to-blue-600 shadow-sm">
            Lọc
          </button>
          <span className="text-xs text-slate-400 ml-auto">{total} exceptions</span>
        </div>
      </div>

      {actionError && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">{actionError}</p>}

      {resolveId && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 flex items-center gap-3">
          <span className="text-xs text-sky-700 font-medium">Ghi chú:</span>
          <input
            className="border border-sky-300 rounded-lg px-3 py-1.5 text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-sky-400"
            placeholder="Nhập ghi chú giải quyết…"
            value={resolveNote}
            onChange={e => setResolveNote(e.target.value)}
          />
          <button onClick={handleResolve} disabled={actionLoading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">
            Xác nhận
          </button>
          <button onClick={() => { setResolveId(null); setResolveNote(''); setActionError(null); }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">
            Bỏ
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                {['Type', 'Severity', 'Item', 'Location', 'Wk', 'Message', 'Resolved', ''].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Đang tải…</td></tr>}
              {!loading && items.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Không có exception</td></tr>}
              {items.map(exc => (
                <tr key={exc.id} className={`hover:bg-slate-50 ${exc.resolved ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{exc.type}</td>
                  <td className="px-3 py-2"><SeverityBadge severity={exc.severity} /></td>
                  <td className="px-3 py-2 text-slate-600">{exc.itemCode ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{exc.locationCode ?? '—'}</td>
                  <td className="px-3 py-2 text-center text-slate-500">{exc.weekNumber ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-700 max-w-xs truncate" title={exc.message}>{exc.message}</td>
                  <td className="px-3 py-2 text-center">
                    {exc.resolved ? <span className="text-emerald-600 font-bold">✓</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {!exc.resolved && (
                      <button onClick={() => { setResolveId(exc.id); setActionError(null); }}
                        className="px-2 py-0.5 rounded text-[10px] font-medium text-sky-700 border border-sky-200 hover:bg-sky-50">
                        Resolve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Netting Grid ─────────────────────────────────────────────────────────

function TabNettingGrid({ planRunId }: { planRunId: string }) {
  const [itemCode, setItemCode] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [rows, setRows] = useState<PlannedOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hstk, setHstk] = useState<HstkSummary | null>(null);

  useEffect(() => {
    getHstkSummary(planRunId).then(setHstk).catch(() => {});
  }, [planRunId]);

  const loadGrid = async () => {
    if (!itemCode.trim() || !locationCode.trim()) { setError('Nhập Item Code và Location Code'); return; }
    setLoading(true); setError(null);
    try {
      const data = await getNettingDetail(planRunId, itemCode.trim(), locationCode.trim());
      setRows(data);
    } catch (e: any) {
      setError(e.message ?? 'Lỗi tải netting detail');
      setRows([]);
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {/* HSTK summary */}
      {hstk && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
            <p className="text-xs font-medium text-red-600">Stockout Alerts</p>
            <p className="text-2xl font-bold text-red-700 mt-1">{hstk.stockoutCount}</p>
            <p className="text-[11px] text-red-400 mt-0.5">HSTK &lt; 1.5w · {hstk.stockoutPct}%</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <p className="text-xs font-medium text-emerald-600">OK</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{hstk.okCount}</p>
            <p className="text-[11px] text-emerald-400 mt-0.5">1.5w ≤ HSTK ≤ 3.0w · {hstk.okPct}%</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <p className="text-xs font-medium text-amber-600">Overstock Alerts</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">{hstk.overstockCount}</p>
            <p className="text-[11px] text-amber-400 mt-0.5">HSTK &gt; 3.0w · {hstk.overstockPct}%</p>
          </div>
        </div>
      )}

      {/* Lookup */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <p className="text-xs font-medium text-slate-600 mb-3">Xem 12-Week Netting Grid cho 1 SKU × Location</p>
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Item Code</label>
            <input
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs w-44 focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="VD: SKU-001"
              value={itemCode}
              onChange={e => setItemCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadGrid()}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Location Code</label>
            <input
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="VD: HAN"
              value={locationCode}
              onChange={e => setLocationCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadGrid()}
            />
          </div>
          <button
            onClick={loadGrid}
            disabled={loading}
            className="rounded-lg px-4 py-1.5 text-xs font-medium bg-gradient-to-r from-sky-500 to-blue-500 text-white hover:from-sky-600 hover:to-blue-600 shadow-sm disabled:opacity-50"
          >
            {loading ? 'Đang tải…' : 'Xem Grid'}
          </button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>

      {/* 12-week grid */}
      {rows.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">{rows[0].itemCode} × {rows[0].locationCode}</p>
            <p className="text-xs text-slate-400">12-Week DRP Netting · L4L · Frozen Zone = wk 1–2</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-500 sticky left-0 bg-slate-50 whitespace-nowrap">Row</th>
                  {rows.map(r => (
                    <th key={r.weekNumber} className={`px-3 py-2 text-center font-medium whitespace-nowrap ${r.frozenZoneFlag ? 'text-amber-700 bg-amber-50' : 'text-slate-500'}`}>
                      W{r.weekNumber}{r.frozenZoneFlag && ' ❄'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  { label: 'Beginning Inv.', fn: (r: PlannedOrder) => r.weekNumber === 1 && r.beginningInventory !== null ? fmtNum(r.beginningInventory) : '—', cls: '' },
                  { label: 'Gross Req. (GR)',  fn: (r: PlannedOrder) => fmtNum(r.grossRequirement), cls: '' },
                  { label: 'Sched. Receipt (SR)', fn: (r: PlannedOrder) => fmtNum(r.scheduledReceipt), cls: 'text-sky-600' },
                  { label: 'PAB Before',        fn: (r: PlannedOrder) => fmtNum(r.pabBefore), clsFn: (r: PlannedOrder) => pabColor(Number(r.pabBefore), Number(r.safetyStock)) },
                  { label: 'Net Req. (NR)',      fn: (r: PlannedOrder) => fmtNum(r.netRequirement), cls: 'text-amber-600' },
                  { label: 'Planned Order Qty', fn: (r: PlannedOrder) => Number(r.plannedOrderQty) > 0 ? fmtNum(r.plannedOrderQty) : '—', cls: 'font-bold text-slate-800' },
                  { label: 'PAB After',          fn: (r: PlannedOrder) => fmtNum(r.pabAfter), clsFn: (r: PlannedOrder) => pabColor(Number(r.pabAfter), Number(r.safetyStock)) },
                  { label: 'Safety Stock',       fn: (r: PlannedOrder) => fmtNum(r.safetyStock), cls: 'text-slate-400' },
                  { label: 'HSTK (weeks)', fn: (r: PlannedOrder) => r.hstk === null ? '—' : `${fmtNum(r.hstk, 1)}w`,
                    clsFn: (r: PlannedOrder) => r.hstk === null ? 'text-slate-300' : Number(r.hstk) < 1.5 ? 'text-red-600 font-bold' : Number(r.hstk) > 3.0 ? 'text-amber-600 font-semibold' : 'text-emerald-600' },
                  { label: 'Status', fn: (r: PlannedOrder) => r.status, renderFn: (r: PlannedOrder) => <OrderStatusBadge status={r.status} />, cls: '' },
                ].map((row, i) => (
                  <tr key={i} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                    <td className={`px-3 py-1.5 font-medium text-slate-600 sticky left-0 whitespace-nowrap ${i % 2 === 1 ? 'bg-slate-50' : 'bg-white'}`}>
                      {row.label}
                    </td>
                    {rows.map(r => (
                      <td key={r.weekNumber} className={`px-3 py-1.5 text-center ${'clsFn' in row ? (row as any).clsFn(r) : row.cls}`}>
                        {'renderFn' in row ? (row as any).renderFn(r) : row.fn(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-slate-100 flex gap-4 text-[11px] text-slate-400">
            <span><span className="text-red-600 font-bold">■</span> PAB &lt; 0</span>
            <span><span className="text-amber-600 font-semibold">■</span> PAB &lt; SS</span>
            <span><span className="text-emerald-600">■</span> PAB ≥ SS</span>
            <span><span className="text-amber-500">❄</span> Frozen Zone (wk 1–2)</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'runs',       label: 'Run Dashboard' },
  { key: 'orders',     label: 'Planned Orders' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'netting',    label: 'Netting Grid' },
] as const;
type TabKey = typeof TABS[number]['key'];

export default function DrpPage() {
  const [tab, setTab] = useState<TabKey>('runs');
  const [runs, setRuns] = useState<PlanRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<PlanRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const res = await listPlanRuns(1, 20);
      const data = res.data;
      setRuns(data);
      if (selectedRun) {
        const updated = data.find(r => r.id === selectedRun.id);
        if (updated) setSelectedRun(updated);
      }
      return data;
    } catch { return []; }
  }, [selectedRun]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const data = await loadRuns();
      if (data.length > 0) setSelectedRun(data[0]);
      setLoading(false);
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-poll while RUNNING
  useEffect(() => {
    const hasRunning = runs.some(r => r.status === 'RUNNING');
    if (hasRunning && !pollRef.current) {
      pollRef.current = setInterval(() => loadRuns(), 3000);
    } else if (!hasRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [runs, loadRuns]);

  const handleCreated = async (run: any) => {
    setShowCreate(false);
    setTab('runs');
    // Reload full list to get complete PlanRun entity (createDrpRun returns partial)
    const data = await loadRuns();
    const full = data.find((r: PlanRun) => r.id === run.planRunId) ?? data[0];
    if (full) setSelectedRun(full);
  };

  const exceptionCount = selectedRun?.exceptionsCount ?? 0;

  return (
    <div className="p-6 space-y-5">
      {/* Create dialog */}
      {showCreate && <CreateRunDialog onClose={() => setShowCreate(false)} onCreated={handleCreated} />}

      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-100">
            <span className="font-mono text-sm font-bold text-sky-600">04</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">DRP Netting</h1>
            <p className="text-sm text-slate-500">Net Requirements · PAB Calculation · Planned Order Releases</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedRun && (
            <span className="text-xs text-slate-400">
              Run #{selectedRun.id} · <RunStatusBadge status={selectedRun.status} />
            </span>
          )}
          {tab === 'runs' && (
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 shadow-sm transition-all"
            >
              + Tạo Plan Run
            </button>
          )}
        </div>
      </div>

      {/* ─── KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Plan Runs',      value: runs.length || (loading ? '…' : '—'), sub: 'total runs' },
          { label: 'Active Run',     value: selectedRun ? `#${selectedRun.id}` : '—', sub: selectedRun?.status ?? 'no run selected' },
          { label: 'Planned Orders', value: (selectedRun?.plannedOrdersCount ?? 0).toLocaleString(), sub: `${selectedRun?.combinationsProcessed ?? 0} combos` },
          { label: 'Exceptions',     value: selectedRun?.exceptionsCount ?? '—', sub: exceptionCount > 0 ? 'cần xử lý' : 'clear' },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{kpi.label}</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{kpi.value}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* ─── Tab Switcher ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {TABS.map(t => {
          const badges: Record<TabKey, string | number> = {
            runs:       runs.length || '',
            orders:     selectedRun?.plannedOrdersCount || '',
            exceptions: exceptionCount || '',
            netting:    '',
          };
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                tab === t.key
                  ? 'text-sky-600 border-b-2 border-sky-500 -mb-px'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
              {badges[t.key] !== '' && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded bg-sky-100 text-sky-600">
                  {badges[t.key]}
                </span>
              )}
              {t.key === 'exceptions' && exceptionCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {exceptionCount > 9 ? '9+' : exceptionCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── Tab Content ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Đang tải…</div>
      ) : (
        <>
          {tab === 'runs' && (
            <TabRunDashboard
              runs={runs}
              selectedRun={selectedRun}
              onSelectRun={setSelectedRun}
              onRefresh={loadRuns}
              onCreateRun={() => setShowCreate(true)}
            />
          )}
          {tab === 'orders' && (
            selectedRun
              ? <TabPlannedOrders planRunId={selectedRun.id} />
              : <div className="text-center py-12 text-slate-400 text-sm">Chọn một plan run để xem planned orders</div>
          )}
          {tab === 'exceptions' && (
            selectedRun
              ? <TabExceptions planRunId={selectedRun.id} />
              : <div className="text-center py-12 text-slate-400 text-sm">Chọn một plan run để xem exceptions</div>
          )}
          {tab === 'netting' && (
            selectedRun
              ? <TabNettingGrid planRunId={selectedRun.id} />
              : <div className="text-center py-12 text-slate-400 text-sm">Chọn một plan run để xem netting grid</div>
          )}
        </>
      )}
    </div>
  );
}
