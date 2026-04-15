'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchOrderStats, fetchOrderBatches, fetchOrderLines,
  createOrderBatch, submitBatch, approveBatch, rejectBatch,
  cancelBatch, exportBatchCsv, updateOrderLine,
  type OrderBatch, type OrderLine, type OrderStats, type BatchStatus,
} from '@/lib/api/order';
import { fetchTransportPlans, type TransportPlan } from '@/lib/api/transport';

// ─── helpers ─────────────────────────────────────────────────────────────────

const n = (v: string | number | undefined) =>
  Number(v ?? 0).toLocaleString('vi-VN');

const fmtDate = (d: string | null) => (d ? d.slice(0, 10) : '—');

const STATUS_BADGE: Record<BatchStatus, string> = {
  DRAFT:     'bg-slate-100 text-slate-600 border-slate-200',
  SUBMITTED: 'bg-amber-50  text-amber-700 border-amber-200',
  APPROVED:  'bg-green-50  text-green-700 border-green-200',
  EXPORTED:  'bg-blue-50   text-blue-700  border-blue-200',
  CANCELLED: 'bg-red-50    text-red-600   border-red-200',
};

function StatusPill({ status }: { status: BatchStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${STATUS_BADGE[status]}`}>
      {status}
    </span>
  );
}

// ─── Reject Modal ─────────────────────────────────────────────────────────────

function RejectModal({
  batchId,
  onClose,
  onDone,
}: {
  batchId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const handleSubmit = async () => {
    if (!reason.trim()) { setErr('Lý do reject không được để trống.'); return; }
    setLoading(true);
    try {
      await rejectBatch(batchId, reason.trim(), 'manager');
      onDone();
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md p-6 space-y-4">
        <h3 className="font-semibold text-slate-800">Reject Batch</h3>
        <p className="text-xs text-slate-500">Lý do reject sẽ được lưu lại và batch trả về DRAFT để chỉnh sửa.</p>
        <textarea
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm resize-none h-24"
          placeholder="Nhập lý do reject (bắt buộc)…"
          value={reason}
          onChange={e => { setReason(e.target.value); setErr(''); }}
        />
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-slate-200 hover:bg-slate-50">
            Huỷ
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
          >
            {loading ? 'Đang xử lý…' : 'Confirm Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Lines Table ──────────────────────────────────────────────────────────────

function LinesPanel({ batch }: { batch: OrderBatch }) {
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [editErpRef, setEditErpRef] = useState<{ [id: string]: string }>({});
  const [saving, setSaving] = useState<string | null>(null);

  const loadLines = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchOrderLines(batch.id, { page, pageSize: 50 });
      setLines(r.data);
      setTotal(r.meta.total);
    } finally { setLoading(false); }
  }, [batch.id, page]);

  useEffect(() => { loadLines(); }, [loadLines]);

  const saveErpRef = async (line: OrderLine) => {
    const val = editErpRef[line.id];
    if (val === undefined || val === (line.erpRef ?? '')) return;
    setSaving(line.id);
    try {
      await updateOrderLine(line.id, { erpRef: val });
      await loadLines();
    } finally { setSaving(null); }
  };

  const cancelLine = async (line: OrderLine) => {
    if (!confirm(`Cancel line ${line.orderNo}?`)) return;
    await updateOrderLine(line.id, { status: 'CANCELLED' });
    loadLines();
  };

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-3 border-b border-[rgba(148,173,215,0.15)] flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Order Lines</span>
        <span className="ml-auto text-xs text-slate-400">{total.toLocaleString()} lines</span>
      </div>

      <div className="overflow-x-auto max-h-[420px] overflow-y-auto relative">
        {loading && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10">
            <p className="text-xs text-slate-400">Loading…</p>
          </div>
        )}
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-[rgba(148,173,215,0.12)] text-left">
              {['Order No', 'Src → Dest', 'Item Code', 'Item Name', 'Qty', 'Departure', 'ETA', 'Carrier', 'ERP Ref', 'Status', ''].map(h => (
                <th key={h} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && !loading && (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-400">No lines</td></tr>
            )}
            {lines.map(l => (
              <tr key={l.id} className={`border-b border-[rgba(148,173,215,0.08)] ${l.status === 'CANCELLED' ? 'opacity-40 line-through' : ''}`}>
                <td className="px-3 py-2 font-mono text-[10px] text-slate-700 whitespace-nowrap">{l.orderNo}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{l.sourceLocationCode} → {l.destLocationCode}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-slate-600">{l.itemCode}</td>
                <td className="px-3 py-2 text-slate-600 max-w-[180px] truncate" title={l.itemName ?? ''}>{l.itemName ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{n(l.qty)}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDate(l.departureDate)}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDate(l.etaDate)}</td>
                <td className="px-3 py-2 text-slate-500">{l.carrierCode ?? '—'}</td>
                <td className="px-3 py-2">
                  <input
                    className="w-24 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-mono"
                    placeholder="erp_ref"
                    defaultValue={l.erpRef ?? ''}
                    onChange={e => setEditErpRef(prev => ({ ...prev, [l.id]: e.target.value }))}
                    onBlur={() => saveErpRef(l)}
                    disabled={saving === l.id}
                  />
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold border ${l.status === 'ACTIVE' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                    {l.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {l.status === 'ACTIVE' && ['DRAFT', 'SUBMITTED'].includes(batch.status) && (
                    <button onClick={() => cancelLine(l)} className="text-[10px] text-red-400 hover:text-red-600">Cancel</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-5 py-2 border-t border-[rgba(148,173,215,0.12)] flex items-center justify-between text-xs">
          <span className="text-slate-500">Page {page} / {totalPages}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">◀</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">▶</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ExecutionPage() {
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [batches, setBatches] = useState<OrderBatch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<OrderBatch | null>(null);
  const [confirmedPlans, setConfirmedPlans] = useState<TransportPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [creatingBy, setCreatingBy] = useState('planner');
  const [creating, setCreating] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [toast, setToast] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [batchPage, setBatchPage] = useState(1);
  const [batchTotal, setBatchTotal] = useState(0);
  const [linesKey, setLinesKey] = useState(0);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const loadAll = useCallback(async () => {
    const [statsRes, batchesRes] = await Promise.all([
      fetchOrderStats().catch(() => null),
      fetchOrderBatches(batchPage, 20, statusFilter || undefined).catch(() => ({ data: [], meta: { total: 0 } })),
    ]);
    if (statsRes) setStats(statsRes);
    setBatches(batchesRes.data);
    setBatchTotal(batchesRes.meta.total);
  }, [batchPage, statusFilter]);

  // Load confirmed transport plans for create dropdown
  const loadPlans = useCallback(async () => {
    const r = await fetchTransportPlans(1, 50).catch(() => ({ data: [] }));
    setConfirmedPlans(r.data.filter(p => p.status === 'CONFIRMED'));
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadPlans(); }, [loadPlans]);

  // Sync selectedBatch with latest data
  useEffect(() => {
    if (!selectedBatch) return;
    const updated = batches.find(b => b.id === selectedBatch.id);
    if (updated) setSelectedBatch(updated);
  }, [batches]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (!selectedPlanId) { showToast('Chọn Transport Plan trước'); return; }
    setCreating(true);
    try {
      const batch = await createOrderBatch(selectedPlanId, creatingBy || undefined);
      showToast(`✅ Tạo batch ${batch.batchCode} thành công — ${batch.totalLines} lines`);
      setSelectedPlanId('');
      await loadAll();
      await loadPlans();
    } catch (e: any) {
      showToast(`❌ ${e.message}`);
    } finally { setCreating(false); }
  };

  const action = async (fn: () => Promise<OrderBatch>, msg: string) => {
    setActioning(true);
    try {
      const updated = await fn();
      setSelectedBatch(updated);
      showToast(msg);
      await loadAll();
      setLinesKey(k => k + 1);
    } catch (e: any) {
      showToast(`❌ ${e.message}`);
    } finally { setActioning(false); }
  };

  const handleExport = async () => {
    if (!selectedBatch) return;
    setActioning(true);
    try {
      await exportBatchCsv(selectedBatch.id, 'planner');
      showToast('✅ Đã export CSV — batch chuyển sang EXPORTED');
      await loadAll();
      // re-fetch selected batch
      const r = await fetchOrderBatches(1, 50).catch(() => ({ data: [] }));
      const found = r.data.find(b => b.id === selectedBatch.id);
      if (found) setSelectedBatch(found);
    } catch (e: any) {
      showToast(`❌ ${e.message}`);
    } finally { setActioning(false); }
  };

  const totalBatchPages = Math.max(1, Math.ceil(batchTotal / 20));

  return (
    <div className="flex flex-col h-full min-h-0 p-5 gap-4 overflow-auto">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 glass-card px-4 py-3 text-sm text-slate-700 shadow-lg max-w-sm">
          {toast}
        </div>
      )}

      {/* Reject Modal */}
      {showReject && selectedBatch && (
        <RejectModal
          batchId={selectedBatch.id}
          onClose={() => setShowReject(false)}
          onDone={async () => {
            setShowReject(false);
            showToast('Batch rejected → trả về DRAFT');
            await loadAll();
            const r = await fetchOrderBatches(1, 50).catch(() => ({ data: [] }));
            const found = r.data.find(b => b.id === selectedBatch.id);
            if (found) setSelectedBatch(found);
          }}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 border border-violet-100">
          <span className="font-mono text-[13px] font-bold text-violet-700">07</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Order Bridge</h1>
          <p className="text-xs text-slate-500">Transport Plan → Transfer Order → ERP CSV Export</p>
        </div>
      </div>

      {/* ── KPI Row ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Total Batches', val: stats?.total_batches ?? '—', color: 'text-slate-700' },
          { label: 'Draft',        val: stats?.draft ?? '—',          color: 'text-slate-500' },
          { label: 'Submitted',    val: stats?.submitted ?? '—',      color: 'text-amber-600' },
          { label: 'Approved',     val: stats?.approved ?? '—',       color: 'text-green-600' },
          { label: 'Exported',     val: stats?.exported ?? '—',       color: 'text-blue-600'  },
        ].map(k => (
          <div key={k.label} className="kpi-card">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">{k.label}</p>
            <p className={`text-2xl font-bold font-mono ${k.color}`}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* ── Main Layout: left list + right detail ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 flex-1 min-h-0">

        {/* LEFT: Create form + Batch list */}
        <div className="flex flex-col gap-3">

          {/* Create form */}
          <div className="glass-card p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Generate Order Batch</p>
            <select
              value={selectedPlanId}
              onChange={e => setSelectedPlanId(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">— chọn Transport Plan (CONFIRMED) —</option>
              {confirmedPlans.map(p => (
                <option key={p.id} value={p.id}>
                  Plan #{p.id} · {n(p.totalTrips)} trips · {n(p.totalWeightKg)} kg
                </option>
              ))}
            </select>
            <input
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              placeholder="Created by (optional)"
              value={creatingBy}
              onChange={e => setCreatingBy(e.target.value)}
            />
            <button
              onClick={handleCreate}
              disabled={creating || !selectedPlanId}
              className="w-full rounded-md bg-violet-600 text-white py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-40"
            >
              {creating ? 'Đang tạo…' : 'Generate Batch'}
            </button>
          </div>

          {/* Batch list */}
          <div className="glass-card overflow-hidden flex-1">
            <div className="px-4 py-3 border-b border-[rgba(148,173,215,0.15)] flex items-center gap-2">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Batch History</p>
              <select
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setBatchPage(1); }}
                className="ml-auto text-xs rounded border border-slate-200 px-2 py-0.5"
              >
                <option value="">All</option>
                {['DRAFT','SUBMITTED','APPROVED','EXPORTED','CANCELLED'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="divide-y divide-[rgba(148,173,215,0.1)] overflow-y-auto max-h-[480px]">
              {batches.length === 0 && (
                <p className="px-4 py-8 text-center text-xs text-slate-400">No batches yet</p>
              )}
              {batches.map(b => (
                <div
                  key={b.id}
                  onClick={() => setSelectedBatch(b)}
                  className={`px-4 py-3 cursor-pointer transition-colors hover:bg-amber-50/60
                    ${selectedBatch?.id === b.id ? 'bg-amber-50/80 border-l-2 border-violet-500' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs font-bold text-slate-700">{b.batchCode}</span>
                    <StatusPill status={b.status} />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {b.totalLines} lines · {n(b.totalQty)} units
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{fmtDate(b.createdAt)}</p>
                </div>
              ))}
            </div>
            {/* batch pagination */}
            {totalBatchPages > 1 && (
              <div className="px-4 py-2 border-t border-[rgba(148,173,215,0.12)] flex items-center justify-between text-xs">
                <span className="text-slate-500">Page {batchPage} / {totalBatchPages}</span>
                <div className="flex gap-1">
                  <button onClick={() => setBatchPage(p => Math.max(1, p-1))} disabled={batchPage <= 1}
                    className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">◀</button>
                  <button onClick={() => setBatchPage(p => Math.min(totalBatchPages, p+1))} disabled={batchPage >= totalBatchPages}
                    className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">▶</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Batch detail + actions + lines */}
        <div className="flex flex-col gap-3">
          {!selectedBatch ? (
            <div className="glass-card flex-1 flex items-center justify-center">
              <p className="text-sm text-slate-400">Chọn một batch để xem chi tiết</p>
            </div>
          ) : (
            <>
              {/* Batch detail header */}
              <div className="glass-card p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-mono text-base font-bold text-slate-800">{selectedBatch.batchCode}</span>
                      <StatusPill status={selectedBatch.status} />
                    </div>
                    <p className="text-xs text-slate-500">Transport Plan #{selectedBatch.transportPlanId}</p>
                  </div>
                  {/* Cancel button */}
                  {!['EXPORTED','CANCELLED'].includes(selectedBatch.status) && (
                    <button
                      onClick={() => action(() => cancelBatch(selectedBatch.id, 'planner'), 'Batch cancelled')}
                      disabled={actioning}
                      className="text-xs text-red-400 hover:text-red-600 border border-red-200 rounded px-2 py-1"
                    >
                      Cancel Batch
                    </button>
                  )}
                </div>

                {/* KPI pills */}
                <div className="flex gap-4 flex-wrap">
                  {[
                    { label: 'Lines',   val: n(selectedBatch.totalLines) },
                    { label: 'Qty',     val: n(selectedBatch.totalQty) + ' units' },
                    { label: 'Plan ID', val: `#${selectedBatch.transportPlanId}` },
                    { label: 'Created', val: fmtDate(selectedBatch.createdAt) },
                  ].map(k => (
                    <div key={k.label} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 min-w-[90px]">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide">{k.label}</p>
                      <p className="text-sm font-semibold text-slate-700 font-mono">{k.val}</p>
                    </div>
                  ))}
                </div>

                {/* Rejection note */}
                {selectedBatch.rejectReason && (
                  <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2">
                    <p className="text-[10px] text-red-500 font-semibold mb-0.5">REJECT REASON</p>
                    <p className="text-xs text-red-700">{selectedBatch.rejectReason}</p>
                    <p className="text-[10px] text-red-400 mt-1">by {selectedBatch.rejectedBy ?? '—'} · {fmtDate(selectedBatch.rejectedAt)}</p>
                  </div>
                )}

                {/* Approval action bar */}
                <div className="flex gap-2 flex-wrap pt-1">
                  {selectedBatch.status === 'DRAFT' && (
                    <button
                      onClick={() => action(() => submitBatch(selectedBatch.id, 'planner'), '✅ Batch submitted → SUBMITTED')}
                      disabled={actioning}
                      className="rounded-md bg-amber-500 text-white px-4 py-2 text-sm font-medium hover:bg-amber-600 disabled:opacity-40"
                    >
                      Submit for Approval
                    </button>
                  )}
                  {selectedBatch.status === 'SUBMITTED' && (
                    <>
                      <button
                        onClick={() => action(() => approveBatch(selectedBatch.id, 'manager'), '✅ Batch approved → APPROVED')}
                        disabled={actioning}
                        className="rounded-md bg-green-600 text-white px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-40"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => setShowReject(true)}
                        disabled={actioning}
                        className="rounded-md border border-red-300 text-red-600 px-4 py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-40"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {selectedBatch.status === 'APPROVED' && (
                    <button
                      onClick={handleExport}
                      disabled={actioning}
                      className="rounded-md bg-violet-600 text-white px-4 py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-40"
                    >
                      Export CSV ⬇
                    </button>
                  )}
                  {selectedBatch.status === 'EXPORTED' && (
                    <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-700">
                      Exported · {fmtDate(selectedBatch.exportedAt)} by {selectedBatch.exportedBy ?? '—'}
                    </div>
                  )}
                </div>
              </div>

              {/* Lines table */}
              <LinesPanel key={linesKey} batch={selectedBatch} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
