'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchEligibleRuns, createTransportPlan, fetchTransportPlans, fetchTrips, fetchTripLines,
  confirmPlan, upsertCarrier, fetchCarriers, upsertLane, fetchLanes,
  uploadCarriersCsv, uploadLanesCsv,
  type EligibleRun, type TransportPlan, type TransportTrip, type TransportTripLine,
  type Carrier, type TransportLane,
} from '@/lib/api/transport';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v: number | string | null | undefined, dec = 0) {
  if (v == null) return '—';
  return Number(v).toLocaleString('vi-VN', { maximumFractionDigits: dec });
}
function vnd(v: number | string | null | undefined) {
  if (v == null) return '—';
  return (Number(v) / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + 'M ₫';
}
function pct(v: number | string | null | undefined) {
  if (v == null) return '—';
  return (Number(v) * 100).toFixed(1) + '%';
}

// ─── Status badge (dùng đúng system palette) ─────────────────────────────────

function statusBadge(s: string) {
  const map: Record<string, string> = {
    DRAFT:      'bg-slate-100 text-slate-600',
    CONFIRMED:  'bg-emerald-100 text-emerald-700',
    CANCELLED:  'bg-red-100 text-red-600',
    PLANNED:    'bg-sky-100 text-sky-700',
    NO_CARRIER: 'bg-amber-100 text-amber-700',
    DISPATCHED: 'bg-violet-100 text-violet-700',
    DELIVERED:  'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${map[s] ?? 'bg-slate-100 text-slate-500'}`}>
      {s}
    </span>
  );
}

function vehicleBadge(v: string) {
  return v === 'CRANE_TRUCK'
    ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700">CRANE</span>
    : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">FLATBED</span>;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="kpi-card">
      <p className="text-[11px] text-amber-700/60 uppercase tracking-wide font-semibold mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${warn ? 'text-amber-600' : 'text-[#111827]'}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}

// ─── Input / Select shared style ─────────────────────────────────────────────

const inp = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white/80';

// ─── Trip Lines Drawer ────────────────────────────────────────────────────────

function TripLinesDrawer({ trip, onClose }: { trip: TransportTrip; onClose: () => void }) {
  const [lines, setLines] = useState<TransportTripLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTripLines(trip.id)
      .then(setLines)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [trip.id]);

  const totalWeight = lines.reduce((s, l) => s + Number(l.weightKg), 0);
  const totalQty    = lines.reduce((s, l) => s + Number(l.allocatedQty), 0);

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      {/* Backdrop */}
      <div className="flex-1 bg-black/30 backdrop-blur-[2px]" />

      {/* Drawer panel */}
      <div
        className="w-full max-w-xl bg-[#fffdf4] h-full overflow-y-auto shadow-2xl border-l border-[rgba(253,224,71,0.3)] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[rgba(148,173,215,0.15)] flex items-start justify-between sticky top-0 bg-[#fffdf4]/95 backdrop-blur z-10">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Trip #{trip.id} · Lines</span>
            </div>
            <p className="text-sm font-semibold text-[#111827] font-mono">
              {trip.sourceLocationCode} → {trip.destLocationCode}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {trip.vehicleTypeCode} · {trip.carrierCode ?? 'no carrier'} · {trip.status}
            </p>
          </div>
          <button onClick={onClose}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors text-lg leading-none">
            ✕
          </button>
        </div>

        {/* Summary pills */}
        <div className="px-6 py-3 flex gap-3 border-b border-[rgba(148,173,215,0.1)]">
          <div className="kpi-card flex-1 !py-2.5">
            <p className="text-[10px] text-amber-700/60 uppercase tracking-wide font-semibold">Items</p>
            <p className="text-lg font-bold font-mono text-[#111827]">{lines.length}</p>
          </div>
          <div className="kpi-card flex-1 !py-2.5">
            <p className="text-[10px] text-amber-700/60 uppercase tracking-wide font-semibold">Total Qty</p>
            <p className="text-lg font-bold font-mono text-[#111827]">{Number(totalQty).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}</p>
          </div>
          <div className="kpi-card flex-1 !py-2.5">
            <p className="text-[10px] text-amber-700/60 uppercase tracking-wide font-semibold">Total Weight</p>
            <p className="text-lg font-bold font-mono text-[#111827]">{Number(totalWeight).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} kg</p>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-300 text-sm">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#fef9c3]/90 backdrop-blur">
                <tr className="border-b border-[rgba(234,179,8,0.3)] text-left">
                  {[['Item Code',''],['Qty','text-right'],['Weight (kg)','text-right'],['Alloc ID','text-right']].map(([h,c]) => (
                    <th key={h} className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-[#431407] ${c}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.id} className={`border-b border-[rgba(148,173,215,0.08)] ${i % 2 === 0 ? 'bg-[rgba(254,249,195,0.35)]' : 'bg-[rgba(255,255,255,0.5)]'} hover:bg-[rgba(253,230,138,0.55)]`}>
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-700">{l.itemCode}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums">{Number(l.allocatedQty).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums">{Number(l.weightKg).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-400">#{l.allocationResultId}</td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-300">Không có line</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CSV Dropzone ─────────────────────────────────────────────────────────────

function CsvDropzone({
  label, accept, onUpload,
}: {
  label: string;
  accept: string;
  onUpload: (file: File) => Promise<{ upserted: number; errors: string[] }>;
}) {
  const [dragging, setDragging] = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [result,   setResult]   = useState<{ upserted: number; errors: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const process = async (file: File) => {
    setBusy(true); setResult(null);
    try {
      const res = await onUpload(file);
      setResult(res);
    } catch (e: any) {
      setResult({ upserted: 0, errors: [e.message] });
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) process(file);
  };

  return (
    <div className="space-y-2">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        className={`rounded-xl border-2 border-dashed px-5 py-6 flex flex-col items-center gap-2 cursor-pointer transition-colors ${
          dragging ? 'border-violet-400 bg-violet-50/60' : 'border-slate-200 hover:border-violet-300 hover:bg-violet-50/30'
        } ${busy ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <input ref={inputRef} type="file" accept={accept} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) process(f); e.target.value = ''; }} />

        {busy ? (
          <>
            <Spinner />
            <p className="text-xs text-slate-400">Đang upload…</p>
          </>
        ) : (
          <>
            <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 text-lg">↑</div>
            <p className="text-xs font-medium text-slate-600">{label}</p>
            <p className="text-[11px] text-slate-400">Kéo thả hoặc click để chọn file .xlsx / .csv</p>
          </>
        )}
      </div>

      {result && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${result.errors.length === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          <p className="font-semibold">✓ {result.upserted} rows upserted{result.errors.length > 0 ? ` · ${result.errors.length} errors` : ''}</p>
          {result.errors.slice(0, 3).map((e, i) => <p key={i} className="text-[11px] mt-0.5 opacity-80">{e}</p>)}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function TransportPage() {
  const [tab, setTab] = useState<'plans' | 'carriers' | 'lanes'>('plans');

  // data
  const [plans,    setPlans]    = useState<TransportPlan[]>([]);
  const [eligible, setEligible] = useState<EligibleRun[]>([]);
  const [sel,      setSel]      = useState<TransportPlan | null>(null);
  const [trips,    setTrips]    = useState<TransportTrip[]>([]);
  const [tripsTotal, setTripsTotal] = useState(0);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [lanes,    setLanes]    = useState<TransportLane[]>([]);
  const [drawerTrip, setDrawerTrip] = useState<TransportTrip | null>(null);

  // ui
  const [busy,  setBusy]  = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  // forms
  const [runId,   setRunId]   = useState('');
  const [creator, setCreator] = useState('');
  const [cf, setCf] = useState({ carrierCode: '', carrierName: '', historicalOtdPct: '0.9', supportedVehicles: 'FLATBED,CRANE_TRUCK' });
  const [lf, setLf] = useState({ sourceLocationCode: '', destLocationCode: '', distanceKm: '', leadTimeDays: '1', rateVndPerKm: '15000', carrierCodes: '' });

  const flash = (msg: string, type: 'ok' | 'err') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  // loaders
  const loadPlans = useCallback(async () => {
    try { const r = await fetchTransportPlans(1, 50); setPlans(r.data); }
    catch (e: any) { flash(e.message, 'err'); }
  }, []);

  const loadEligible = useCallback(async () => {
    try {
      const r = await fetchEligibleRuns();
      setEligible(r);
      if (r.length > 0) setRunId(id => id || r[0].id);
    } catch (e: any) { flash(e.message, 'err'); }
  }, []);

  const loadCarriers = useCallback(async () => {
    try { setCarriers(await fetchCarriers()); }
    catch (e: any) { flash(e.message, 'err'); }
  }, []);

  const loadLanes = useCallback(async () => {
    try { const r = await fetchLanes(1, 200); setLanes(r.data); }
    catch (e: any) { flash(e.message, 'err'); }
  }, []);

  useEffect(() => { loadPlans(); loadEligible(); }, []);
  useEffect(() => {
    if (tab === 'carriers') loadCarriers();
    if (tab === 'lanes')    loadLanes();
  }, [tab]);

  const selectPlan = async (p: TransportPlan) => {
    setSel(p);
    try {
      const r = await fetchTrips(p.id, { pageSize: 200 });
      setTrips(r.data);
      setTripsTotal(r.meta.total);
    } catch (e: any) { flash(e.message, 'err'); }
  };

  // actions
  const handleCreate = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      const p = await createTransportPlan(runId, creator || undefined);
      flash(`Plan #${p.id} tạo thành công — ${p.totalTrips} trips, ${vnd(p.totalCostVnd)} est.`, 'ok');
      await loadPlans(); await loadEligible();
      await selectPlan(p);
      setTab('plans');
    } catch (e: any) { flash(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const handleConfirm = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      const updated = await confirmPlan(sel.id, 'planner');
      flash(`Plan #${sel.id} đã CONFIRMED`, 'ok');
      setSel(updated);
      await loadPlans();
    } catch (e: any) { flash(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const handleSaveCarrier = async () => {
    setBusy(true);
    try {
      await upsertCarrier({ ...cf, historicalOtdPct: parseFloat(cf.historicalOtdPct) });
      flash(`Carrier ${cf.carrierCode} đã lưu`, 'ok');
      setCf({ carrierCode: '', carrierName: '', historicalOtdPct: '0.9', supportedVehicles: 'FLATBED,CRANE_TRUCK' });
      loadCarriers();
    } catch (e: any) { flash(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const handleSaveLane = async () => {
    setBusy(true);
    try {
      await upsertLane({
        sourceLocationCode: lf.sourceLocationCode, destLocationCode: lf.destLocationCode,
        distanceKm: parseFloat(lf.distanceKm), leadTimeDays: parseInt(lf.leadTimeDays, 10),
        rateVndPerKm: parseFloat(lf.rateVndPerKm), carrierCodes: lf.carrierCodes,
      });
      flash(`Lane ${lf.sourceLocationCode}→${lf.destLocationCode} đã lưu`, 'ok');
      setLf({ sourceLocationCode: '', destLocationCode: '', distanceKm: '', leadTimeDays: '1', rateVndPerKm: '15000', carrierCodes: '' });
      loadLanes();
    } catch (e: any) { flash(e.message, 'err'); }
    finally { setBusy(false); }
  };

  // derived
  const noCarrierCount = trips.filter(t => t.status === 'NO_CARRIER').length;
  const plannedCount   = trips.filter(t => t.status === 'PLANNED').length;

  return (
    <div className="flex flex-col min-h-0 p-6 gap-5">
      {/* Trip Lines Drawer */}
      {drawerTrip && <TripLinesDrawer trip={drawerTrip} onClose={() => setDrawerTrip(null)} />}

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 border border-blue-100">
            <span className="font-mono text-[13px] font-bold text-[#2563eb]">06</span>
          </div>
          <div>
            <div className="flex items-center gap-3 mb-0.5">
              <h1 className="text-lg font-semibold text-[#111827]">Transport Planning</h1>
              <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wide bg-blue-50 text-blue-600 border-blue-200">
                MODULE 6
              </span>
            </div>
            <p className="text-sm text-[#6b7280]">FFD bin-pack · BEST_SLA carrier · Cost = rate × distance × multiplier · ETA = departure + lead_time</p>
          </div>
        </div>
        {/* eligible runs pill */}
        <div className="flex-shrink-0 text-right">
          <span className="font-mono text-[11px] text-[#6b7280] bg-[#f0f2f5] border border-[#e4e8ef] rounded px-2 py-1">
            {eligible.length} eligible run{eligible.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
          toast.type === 'ok'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <span className="flex-1">{toast.msg}</span>
          <button onClick={() => setToast(null)} className="opacity-40 hover:opacity-70">✕</button>
        </div>
      )}

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      <div className="flex gap-0 border-b border-slate-200">
        {([
          { key: 'plans',    label: `Plans (${plans.length})` },
          { key: 'carriers', label: `Carriers (${carriers.length})` },
          { key: 'lanes',    label: `Lanes (${lanes.length})` },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-violet-600 text-violet-700'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          PLANS TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'plans' && (
        <div className="grid grid-cols-12 gap-5 min-h-0">

          {/* Left panel */}
          <div className="col-span-12 lg:col-span-3 space-y-4">

            {/* Create form */}
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-[rgba(148,173,215,0.15)]">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">New Transport Plan</p>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Allocation Run</label>
                  <select value={runId} onChange={e => setRunId(e.target.value)} className={inp}>
                    {eligible.length === 0 && <option value="">— không có eligible run —</option>}
                    {eligible.map(r => (
                      <option key={r.id} value={r.id}>Run #{r.id} · {n(r.totalAllocated)}/{n(r.totalDemandLines)} lines</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Created By</label>
                  <input value={creator} onChange={e => setCreator(e.target.value)}
                    placeholder="optional" className={inp} />
                </div>
                <button onClick={handleCreate} disabled={busy || !runId}
                  className="w-full rounded-lg px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                  {busy && <Spinner />}
                  Create Plan
                </button>
              </div>
            </div>

            {/* Plan history */}
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-[rgba(148,173,215,0.15)] flex items-center gap-2">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">History</p>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5">{plans.length}</span>
              </div>
              <div className="divide-y divide-[rgba(148,173,215,0.1)] max-h-[440px] overflow-y-auto">
                {plans.map(p => (
                  <button key={p.id} onClick={() => selectPlan(p)}
                    className={`w-full text-left px-5 py-3.5 transition-colors hover:bg-amber-50/50 ${
                      sel?.id === p.id ? 'bg-amber-50/80 border-l-[3px] border-l-violet-500' : ''
                    }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-[#111827]">Plan #{p.id}</span>
                      {statusBadge(p.status)}
                    </div>
                    <div className="text-[11px] text-slate-400 flex gap-2">
                      <span>Run #{p.allocationRunId}</span>
                      <span>·</span>
                      <span>{p.totalTrips} trips</span>
                      <span>·</span>
                      <span>{vnd(p.totalCostVnd)}</span>
                    </div>
                  </button>
                ))}
                {plans.length === 0 && (
                  <div className="px-5 py-10 text-center text-sm text-slate-300">Chưa có plan nào</div>
                )}
              </div>
            </div>
          </div>

          {/* Right panel — plan detail */}
          <div className="col-span-12 lg:col-span-9 space-y-4">
            {sel ? (
              <>
                {/* KPI row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <KpiCard label="Trips" value={String(sel.totalTrips)} />
                  <KpiCard label="Total Weight" value={n(sel.totalWeightKg) + ' kg'} />
                  <KpiCard label="Est. Cost" value={vnd(sel.totalCostVnd)} />
                  <KpiCard
                    label="Carrier Coverage"
                    value={tripsTotal > 0 ? pct(plannedCount / tripsTotal) : '—'}
                    sub={noCarrierCount > 0 ? `${noCarrierCount} trip chưa có carrier` : 'Tất cả trips có carrier'}
                    warn={noCarrierCount > 0}
                  />
                </div>

                {/* Trips table */}
                <div className="glass-card overflow-hidden">
                  {/* Table header */}
                  <div className="px-5 py-3 border-b border-[rgba(148,173,215,0.15)] flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Trips</p>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5">{tripsTotal}</span>
                      {statusBadge(sel.status)}
                      {sel.confirmedBy && (
                        <span className="text-[11px] text-slate-400">· confirmed by <b className="text-slate-600">{sel.confirmedBy}</b></span>
                      )}
                    </div>
                    <div className="flex-1" />
                    <span className="text-[11px] text-slate-400 italic">↖ click row to view items</span>
                    {sel.status === 'DRAFT' && (
                      <button onClick={handleConfirm} disabled={busy}
                        className="rounded-lg px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 transition-colors">
                        {busy && <Spinner />}
                        Confirm Plan
                      </button>
                    )}
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0">
                        <tr className="text-left border-b border-[rgba(148,173,215,0.12)]">
                          {[
                            ['Trip', ''], ['Route', ''], ['Vehicle', ''], ['Carrier', ''],
                            ['Weight (kg)', 'text-right'], ['Pallets', 'text-right'],
                            ['Est. Cost', 'text-right'], ['Departure', ''], ['ETA', ''], ['Status', ''],
                          ].map(([h, cls]) => (
                            <th key={h} className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${cls}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {trips.map(t => (
                          <tr key={t.id}
                            className="border-b border-[rgba(148,173,215,0.08)] cursor-pointer"
                            onClick={() => setDrawerTrip(t)}
                          >
                            <td className="px-4 py-2.5 font-semibold text-slate-500 text-xs">#{t.id}</td>
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{t.sourceLocationCode} → {t.destLocationCode}</td>
                            <td className="px-4 py-2.5">{vehicleBadge(t.vehicleTypeCode)}</td>
                            <td className="px-4 py-2.5">
                              {t.carrierCode
                                ? <span className="text-xs font-medium text-slate-700">{t.carrierCode}</span>
                                : <span className="text-slate-300 text-xs italic">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs tabular-nums">{n(t.totalWeightKg)}</td>
                            <td className="px-4 py-2.5 text-right text-xs tabular-nums">{t.totalPallets}</td>
                            <td className="px-4 py-2.5 text-right text-xs tabular-nums">{n(t.estimatedCostVnd)}</td>
                            <td className="px-4 py-2.5 font-mono text-xs">{t.departureDate ?? '—'}</td>
                            <td className="px-4 py-2.5 font-mono text-xs">{t.etaDate ?? '—'}</td>
                            <td className="px-4 py-2.5">
                              {statusBadge(t.status)}
                              {t.exceptionNote && (
                                <p className="text-[10px] text-amber-600 mt-0.5 max-w-[180px] truncate" title={t.exceptionNote}>
                                  {t.exceptionNote}
                                </p>
                              )}
                            </td>
                          </tr>
                        ))}
                        {trips.length === 0 && (
                          <tr>
                            <td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-300">Không có trip</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="glass-card flex flex-col items-center justify-center h-72 gap-3">
                <div className="h-14 w-14 rounded-2xl border border-[#e4e8ef] bg-white flex items-center justify-center">
                  <span className="font-mono text-xl font-bold text-[#2563eb] opacity-30">06</span>
                </div>
                <p className="text-sm text-slate-400">Chọn một plan để xem trips</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          CARRIERS TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'carriers' && (
        <div className="grid grid-cols-12 gap-5">

          {/* Form */}
          <div className="col-span-12 lg:col-span-4">
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-[rgba(148,173,215,0.15)]">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Add / Update Carrier</p>
              </div>
              <div className="p-5 space-y-3">
                {([
                  { label: 'Carrier Code *', key: 'carrierCode',       ph: 'VTA-001' },
                  { label: 'Carrier Name *', key: 'carrierName',       ph: 'Vận Tải An Phát' },
                  { label: 'OTD Rate (0–1)', key: 'historicalOtdPct',  ph: '0.94' },
                  { label: 'Vehicles',       key: 'supportedVehicles', ph: 'FLATBED,CRANE_TRUCK' },
                ] as const).map(({ label, key, ph }) => (
                  <div key={key}>
                    <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
                    <input value={cf[key]} onChange={e => setCf(p => ({ ...p, [key]: e.target.value }))}
                      placeholder={ph} className={inp} />
                  </div>
                ))}
                <button onClick={handleSaveCarrier} disabled={busy || !cf.carrierCode || !cf.carrierName}
                  className="w-full rounded-lg px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors mt-1">
                  {busy && <Spinner />} Save Carrier
                </button>

                <div className="pt-2 border-t border-[rgba(148,173,215,0.15)]">
                  <p className="text-xs font-medium text-slate-500 mb-2">Bulk Upload (CSV / Excel)</p>
                  <CsvDropzone
                    label="Upload Carriers CSV"
                    accept=".csv,.xlsx,.xls"
                    onUpload={async (file) => { const r = await uploadCarriersCsv(file); loadCarriers(); return r; }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="col-span-12 lg:col-span-8">
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-[rgba(148,173,215,0.15)] flex items-center gap-2">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Carriers</p>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5">{carriers.length}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-[rgba(148,173,215,0.12)]">
                    {[['Code',''],['Name',''],['Phone',''],['OTD %','text-right'],['Vehicles','']].map(([h,c]) => (
                      <th key={h} className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${c}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {carriers.map(c => (
                    <tr key={c.id} className="border-b border-[rgba(148,173,215,0.08)]">
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-700">{c.carrierCode}</td>
                      <td className="px-4 py-2.5 text-slate-700">{c.carrierName}</td>
                      <td className="px-4 py-2.5 text-slate-400 text-xs">{c.contactPhone ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`font-bold font-mono text-xs ${
                          Number(c.historicalOtdPct) >= 0.93 ? 'text-emerald-600'
                          : Number(c.historicalOtdPct) >= 0.88 ? 'text-amber-600'
                          : 'text-red-500'
                        }`}>{pct(c.historicalOtdPct)}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1 flex-wrap">
                          {c.supportedVehicles.split(',').map(v => (
                            <span key={v} className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-medium">{v.trim()}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {carriers.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-300">Chưa có carrier</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          LANES TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'lanes' && (
        <div className="grid grid-cols-12 gap-5">

          {/* Form */}
          <div className="col-span-12 lg:col-span-4">
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-[rgba(148,173,215,0.15)]">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Add / Update Lane</p>
              </div>
              <div className="p-5 space-y-3">
                {([
                  { label: 'Source Location *', key: 'sourceLocationCode', ph: '001' },
                  { label: 'Dest Location *',   key: 'destLocationCode',   ph: '014' },
                  { label: 'Distance (km)',      key: 'distanceKm',         ph: '110' },
                  { label: 'Lead Time (days)',   key: 'leadTimeDays',       ph: '2'   },
                  { label: 'Rate VNĐ / km',      key: 'rateVndPerKm',       ph: '15000' },
                  { label: 'Carrier Codes',      key: 'carrierCodes',       ph: 'VTA-001,VTB-002' },
                ] as const).map(({ label, key, ph }) => (
                  <div key={key}>
                    <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
                    <input value={lf[key]} onChange={e => setLf(p => ({ ...p, [key]: e.target.value }))}
                      placeholder={ph} className={inp} />
                  </div>
                ))}
                <button onClick={handleSaveLane} disabled={busy || !lf.sourceLocationCode || !lf.destLocationCode}
                  className="w-full rounded-lg px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors mt-1">
                  {busy && <Spinner />} Save Lane
                </button>

                <div className="pt-2 border-t border-[rgba(148,173,215,0.15)]">
                  <p className="text-xs font-medium text-slate-500 mb-2">Bulk Upload (CSV / Excel)</p>
                  <CsvDropzone
                    label="Upload Lanes CSV"
                    accept=".csv,.xlsx,.xls"
                    onUpload={async (file) => { const r = await uploadLanesCsv(file); loadLanes(); return r; }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="col-span-12 lg:col-span-8">
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-[rgba(148,173,215,0.15)] flex items-center gap-2">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Transport Lanes</p>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5">{lanes.length}</span>
              </div>
              <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="text-left border-b border-[rgba(148,173,215,0.12)]">
                      {[['Source',''],['Dest',''],['Distance','text-right'],['Lead','text-right'],['Rate/km','text-right'],['Carriers','']].map(([h,c]) => (
                        <th key={h} className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${c}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lanes.map(l => (
                      <tr key={l.id} className="border-b border-[rgba(148,173,215,0.08)]">
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-700">{l.sourceLocationCode}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{l.destLocationCode}</td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums">{n(l.distanceKm)} km</td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums">{l.leadTimeDays}d</td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums">{n(l.rateVndPerKm)}</td>
                        <td className="px-4 py-2.5">
                          {l.carrierCodes
                            ? <div className="flex gap-1 flex-wrap">{l.carrierCodes.split(',').map(c => (
                                <span key={c} className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-medium">{c.trim()}</span>
                              ))}</div>
                            : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                      </tr>
                    ))}
                    {lanes.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-300">Chưa có lane</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
