'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  fetchQueue,
  fetchHistory,
  fetchTrustScores,
  fetchReasonCodes,
  approveAdjustment,
  rejectAdjustment,
  submitAdjustment,
  type CnDemandAdjustment,
  type TrustScore,
  type ReasonCode,
  type AdjustStatus,
} from '@/lib/api/cn-adjust';

// ─── Constants ──────────────────────────────────────────────────────────────

type Tab = 'queue' | 'history' | 'trust';

const STATUS_BADGE: Record<AdjustStatus, { label: string; cls: string }> = {
  PENDING:        { label: 'Chờ duyệt',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  AUTO_APPROVED:  { label: 'Tự duyệt',    cls: 'bg-green-50 text-green-700 border-green-200' },
  APPROVED:       { label: 'Đã duyệt',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  REJECTED:       { label: 'Từ chối',      cls: 'bg-red-50 text-red-700 border-red-200' },
  FORCE_APPROVED: { label: 'Force',        cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  EXPIRED:        { label: 'Hết hạn',      cls: 'bg-gray-50 text-gray-500 border-gray-200' },
};

const TRUST_BADGE = (score: number, grace: boolean) => {
  if (grace) return { label: 'Grace', cls: 'bg-gray-100 text-gray-500 border-gray-200' };
  if (score >= 85) return { label: 'Cao', cls: 'bg-green-50 text-green-700 border-green-200' };
  if (score >= 60) return { label: 'TB', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: 'Thấp', cls: 'bg-red-50 text-red-600 border-red-200' };
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function CnDemandAdjustPage() {
  const [tab, setTab] = useState<Tab>('queue');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Queue
  const [queue, setQueue] = useState<CnDemandAdjustment[]>([]);

  // History
  const [history, setHistory] = useState<CnDemandAdjustment[]>([]);
  const [histTotal, setHistTotal] = useState(0);
  const [histPage, setHistPage] = useState(1);
  const [histPageSize] = useState(20);

  // Trust
  const [trustScores, setTrustScores] = useState<TrustScore[]>([]);

  // Reason codes (for submit form)
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);

  // Review modal
  const [reviewTarget, setReviewTarget] = useState<CnDemandAdjustment | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewBy, setReviewBy] = useState('sc-manager');

  // Submit form
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitForm, setSubmitForm] = useState({
    cnId: '', skuId: '', periodDate: '', fcQty: '', adjustedQty: '',
    reasonCode: '', reasonText: '', submittedBy: '',
  });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // ── Loaders ─────────────────────────────────────────────────────────────

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchQueue();
      setQueue(data);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchHistory({ page: histPage, pageSize: histPageSize });
      setHistory(res.data);
      setHistTotal(res.total);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [histPage, histPageSize]);

  const loadTrust = useCallback(async () => {
    setLoading(true);
    try {
      setTrustScores(await fetchTrustScores());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  const loadReasonCodes = useCallback(async () => {
    try { setReasonCodes(await fetchReasonCodes()); } catch { /* silent */ }
  }, []);

  useEffect(() => {
    setError(null);
    if (tab === 'queue')   loadQueue();
    if (tab === 'history') loadHistory();
    if (tab === 'trust')   loadTrust();
  }, [tab, loadQueue, loadHistory, loadTrust]);

  useEffect(() => { loadReasonCodes(); }, [loadReasonCodes]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleReview = async () => {
    if (!reviewTarget) return;
    setLoading(true);
    try {
      const fn = reviewAction === 'approve' ? approveAdjustment : rejectAdjustment;
      await fn(reviewTarget.id, { reviewedBy: reviewBy, reviewNote: reviewNote || undefined });
      showToast(`${reviewAction === 'approve' ? 'Approved' : 'Rejected'} #${reviewTarget.id}`);
      setReviewTarget(null);
      setReviewNote('');
      loadQueue();
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await submitAdjustment({
        cnId: submitForm.cnId,
        skuId: submitForm.skuId,
        periodDate: submitForm.periodDate,
        fcQty: Number(submitForm.fcQty),
        adjustedQty: Number(submitForm.adjustedQty),
        reasonCode: submitForm.reasonCode,
        reasonText: submitForm.reasonText || undefined,
        submittedBy: submitForm.submittedBy || 'cn-user',
      });
      showToast('Adjustment submitted');
      setShowSubmit(false);
      setSubmitForm({ cnId: '', skuId: '', periodDate: '', fcQty: '', adjustedQty: '', reasonCode: '', reasonText: '', submittedBy: '' });
      if (tab === 'queue') loadQueue();
      if (tab === 'history') loadHistory();
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────

  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('vi-VN') : '—';
  const fmtDateTime = (s: string | null) => s ? new Date(s).toLocaleString('vi-VN') : '—';
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  const totalHistPages = Math.ceil(histTotal / histPageSize);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0 p-6 gap-5">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg shadow-lg text-sm animate-in fade-in">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 border border-blue-100">
            <span className="font-mono text-[13px] font-bold text-[#2563eb]">M22</span>
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-lg font-semibold text-[#111827]">CN Demand Adjustment</h1>
              <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wide bg-blue-50 text-blue-600 border-blue-200">
                ACTIVE
              </span>
            </div>
            <p className="text-sm text-[#6b7280]">D2 Demand Planning &mdash; Trust Score &middot; Tolerance &plusmn;30% &middot; Cutoff 18:00</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-[#6b7280] bg-[#f0f2f5] border border-[#e4e8ef] rounded px-2 py-1">M22 &middot; DA2 &middot; Sprint 3</span>
          <button
            onClick={() => setShowSubmit(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            + Submit Adjustment
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-xs font-bold">X</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[#f0f2f5] rounded-lg p-0.5 w-fit">
        {([
          { key: 'queue',   label: 'Review Queue',  count: queue.length },
          { key: 'history', label: 'History',        count: histTotal },
          { key: 'trust',   label: 'Trust Scores',   count: trustScores.length },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-1.5 text-xs font-medium rounded-md transition-all',
              tab === t.key
                ? 'bg-white text-[#111827] shadow-sm'
                : 'text-[#6b7280] hover:text-[#111827]',
            )}
          >
            {t.label}
            {t.key === 'queue' && t.count > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-[16px] rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-1">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-[#6b7280]">
          <div className="h-3 w-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          Loading...
        </div>
      )}

      {/* ─── Tab: Queue ──────────────────────────────────────────────────── */}
      {tab === 'queue' && (
        <div className="rounded-xl border border-[#e4e8ef] bg-white shadow-sm overflow-hidden">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#9ca3af]">
              <div className="h-12 w-12 rounded-full bg-green-50 flex items-center justify-center mb-3">
                <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="text-sm font-medium text-[#6b7280]">No pending adjustments</p>
              <p className="text-xs text-[#9ca3af] mt-1">All adjustments have been reviewed</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e4e8ef] bg-[#f8f9fb]">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">ID</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">CN</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">SKU</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Week</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">FC Qty</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Adjusted</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Delta</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Reason</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Submitted</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {queue.map(adj => (
                  <tr key={adj.id} className="border-b border-[#f0f2f5] hover:bg-[#f8f9fb] transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#6b7280]">#{adj.id}</td>
                    <td className="px-4 py-2.5 text-[13px]">{adj.cnId}</td>
                    <td className="px-4 py-2.5 text-[13px]">{adj.skuId}</td>
                    <td className="px-4 py-2.5 text-xs text-[#6b7280]">{fmtDate(adj.periodDate)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[13px]">{Number(adj.fcQty).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[13px] font-medium">{Number(adj.adjustedQty).toLocaleString()}</td>
                    <td className={cn(
                      'px-4 py-2.5 text-right font-mono text-[13px] font-medium',
                      Number(adj.deltaPct) > 0 ? 'text-green-600' : Number(adj.deltaPct) < 0 ? 'text-red-600' : 'text-[#6b7280]',
                    )}>
                      {fmtPct(Number(adj.deltaPct))}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#6b7280]">{adj.reasonCode}</td>
                    <td className="px-4 py-2.5 text-xs text-[#9ca3af]">{fmtDateTime(adj.submittedAt)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => { setReviewTarget(adj); setReviewAction('approve'); }}
                          className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => { setReviewTarget(adj); setReviewAction('reject'); }}
                          className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ─── Tab: History ────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div className="rounded-xl border border-[#e4e8ef] bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e4e8ef] bg-[#f8f9fb]">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">ID</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">CN</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">SKU</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Week</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">FC</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Adjusted</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Delta</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Status</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">By</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[#9ca3af] text-sm">No adjustments found</td></tr>
              ) : history.map(adj => {
                const badge = STATUS_BADGE[adj.status];
                return (
                  <tr key={adj.id} className="border-b border-[#f0f2f5] hover:bg-[#f8f9fb] transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#6b7280]">#{adj.id}</td>
                    <td className="px-4 py-2.5 text-[13px]">{adj.cnId}</td>
                    <td className="px-4 py-2.5 text-[13px]">{adj.skuId}</td>
                    <td className="px-4 py-2.5 text-xs text-[#6b7280]">{fmtDate(adj.periodDate)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[13px]">{Number(adj.fcQty).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[13px] font-medium">{Number(adj.adjustedQty).toLocaleString()}</td>
                    <td className={cn(
                      'px-4 py-2.5 text-right font-mono text-[13px] font-medium',
                      Number(adj.deltaPct) > 0 ? 'text-green-600' : Number(adj.deltaPct) < 0 ? 'text-red-600' : 'text-[#6b7280]',
                    )}>
                      {fmtPct(Number(adj.deltaPct))}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold', badge.cls)}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#6b7280]">{adj.submittedBy}</td>
                    <td className="px-4 py-2.5 text-xs text-[#9ca3af]">{fmtDateTime(adj.submittedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {histTotal > histPageSize && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#e4e8ef] bg-[#f8f9fb]">
              <p className="text-xs text-[#6b7280]">
                {histTotal} records &middot; Page {histPage} of {totalHistPages}
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => setHistPage(p => Math.max(1, p - 1))}
                  disabled={histPage <= 1}
                  className="px-2.5 py-1 text-[11px] rounded border border-[#e4e8ef] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <button
                  onClick={() => setHistPage(p => Math.min(totalHistPages, p + 1))}
                  disabled={histPage >= totalHistPages}
                  className="px-2.5 py-1 text-[11px] rounded border border-[#e4e8ef] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Trust Scores ───────────────────────────────────────────── */}
      {tab === 'trust' && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {trustScores.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-[#9ca3af]">
              <p className="text-sm">No trust score data</p>
              <p className="text-xs mt-1">Scores are calculated weekly (Monday 06:00 VN)</p>
            </div>
          ) : trustScores.map(ts => {
            const badge = TRUST_BADGE(ts.score, ts.isGracePeriod);
            const barWidth = Math.min(100, Math.max(0, ts.score));
            const barColor = ts.isGracePeriod
              ? 'bg-gray-300'
              : ts.score >= 85 ? 'bg-green-500' : ts.score >= 60 ? 'bg-amber-500' : 'bg-red-500';

            return (
              <div key={ts.cnId} className="rounded-xl border border-[#e4e8ef] bg-white shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs text-[#9ca3af]">CN</p>
                    <p className="text-sm font-semibold text-[#111827]">{ts.cnId}</p>
                  </div>
                  <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold', badge.cls)}>
                    {badge.label}
                  </span>
                </div>

                {/* Score bar */}
                <div className="mb-3">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-2xl font-bold font-mono text-[#111827]">{ts.score.toFixed(1)}</span>
                    <span className="text-[11px] text-[#9ca3af]">/ 100</span>
                  </div>
                  <div className="h-1.5 bg-[#f0f2f5] rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${barWidth}%` }} />
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-[#9ca3af]">Adjustments 12w</p>
                    <p className="font-medium text-[#111827]">{ts.totalAdjustments12w}</p>
                  </div>
                  <div>
                    <p className="text-[#9ca3af]">Accurate</p>
                    <p className="font-medium text-[#111827]">{ts.accurateAdjustments12w}</p>
                  </div>
                </div>

                {ts.lastCalculatedAt && (
                  <p className="mt-2 text-[10px] text-[#9ca3af]">Updated: {fmtDateTime(ts.lastCalculatedAt)}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Review Modal ────────────────────────────────────────────────── */}
      {reviewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl border border-[#e4e8ef] w-full max-w-md mx-4 p-6">
            <h3 className="text-base font-semibold text-[#111827] mb-1">
              {reviewAction === 'approve' ? 'Approve' : 'Reject'} Adjustment #{reviewTarget.id}
            </h3>
            <p className="text-xs text-[#6b7280] mb-4">
              CN {reviewTarget.cnId} &middot; SKU {reviewTarget.skuId} &middot; {fmtPct(Number(reviewTarget.deltaPct))}
            </p>

            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-[11px] font-medium text-[#6b7280] uppercase tracking-wide mb-1">Reviewed by</label>
                <input
                  value={reviewBy}
                  onChange={e => setReviewBy(e.target.value)}
                  className="w-full rounded-lg border border-[#e4e8ef] bg-[#f8f9fb] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#6b7280] uppercase tracking-wide mb-1">Note (optional)</label>
                <textarea
                  value={reviewNote}
                  onChange={e => setReviewNote(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-[#e4e8ef] bg-[#f8f9fb] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  placeholder={reviewAction === 'reject' ? 'Lý do từ chối...' : 'Ghi chú...'}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setReviewTarget(null); setReviewNote(''); }}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-[#e4e8ef] text-[#6b7280] hover:bg-[#f0f2f5] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReview}
                disabled={loading}
                className={cn(
                  'px-4 py-2 text-xs font-medium rounded-lg text-white transition-colors disabled:opacity-50',
                  reviewAction === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700',
                )}
              >
                {reviewAction === 'approve' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Submit Modal ────────────────────────────────────────────────── */}
      {showSubmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl border border-[#e4e8ef] w-full max-w-lg mx-4 p-6">
            <h3 className="text-base font-semibold text-[#111827] mb-4">Submit CN Demand Adjustment</h3>

            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { key: 'cnId',       label: 'CN ID',       type: 'text',   placeholder: 'e.g. 10' },
                { key: 'skuId',      label: 'SKU ID',      type: 'text',   placeholder: 'e.g. 20' },
                { key: 'periodDate', label: 'Period Date',  type: 'date',   placeholder: '' },
                { key: 'fcQty',      label: 'FC Qty',       type: 'number', placeholder: '1000' },
                { key: 'adjustedQty', label: 'Adjusted Qty', type: 'number', placeholder: '1200' },
                { key: 'submittedBy', label: 'Submitted By', type: 'text',  placeholder: 'cn-user' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-[11px] font-medium text-[#6b7280] uppercase tracking-wide mb-1">{f.label}</label>
                  <input
                    type={f.type}
                    value={submitForm[f.key as keyof typeof submitForm]}
                    onChange={e => setSubmitForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full rounded-lg border border-[#e4e8ef] bg-[#f8f9fb] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-[11px] font-medium text-[#6b7280] uppercase tracking-wide mb-1">Reason Code</label>
                <select
                  value={submitForm.reasonCode}
                  onChange={e => setSubmitForm(prev => ({ ...prev, reasonCode: e.target.value }))}
                  className="w-full rounded-lg border border-[#e4e8ef] bg-[#f8f9fb] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                >
                  <option value="">-- Select --</option>
                  {reasonCodes.map(rc => (
                    <option key={rc.code} value={rc.code}>{rc.code} &mdash; {rc.labelVi}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#6b7280] uppercase tracking-wide mb-1">Reason Text</label>
                <input
                  value={submitForm.reasonText}
                  onChange={e => setSubmitForm(prev => ({ ...prev, reasonText: e.target.value }))}
                  placeholder="Required when delta > tolerance"
                  className="w-full rounded-lg border border-[#e4e8ef] bg-[#f8f9fb] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSubmit(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-[#e4e8ef] text-[#6b7280] hover:bg-[#f0f2f5] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !submitForm.cnId || !submitForm.skuId || !submitForm.periodDate || !submitForm.reasonCode}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
