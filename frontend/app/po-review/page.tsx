'use client';

import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  listPo, getPoDetail, confirmPo, cancelPo, transitionPo, editPoLine,
  listTo, confirmTo, cancelTo,
  type PoHeader, type PoLine, type PoEditLog, type ToHeader,
} from '@/lib/api/po-review';

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT:     'bg-slate-100 text-slate-600',
    CONFIRMED: 'bg-blue-100 text-blue-700',
    SHIPPED:   'bg-amber-100 text-amber-700',
    RECEIVED:  'bg-purple-100 text-purple-700',
    CLOSED:    'bg-green-100 text-green-700',
    CANCELLED: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${map[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status}
    </span>
  );
}

// ─── Edit qty dialog ─────────────────────────────────────────────────────────

function EditLineDialog({
  poId, line, onClose, onSaved,
}: {
  poId: string; line: PoLine;
  onClose: () => void;
  onSaved: (warning?: string) => void;
}) {
  const [qty, setQty] = useState(String(line.confirmedQty));
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!reason.trim()) { setError('Reason is required (R7)'); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await editPoLine(poId, line.id, { confirmedQty: Number(qty), reason });
      onSaved(r.warning);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-[400px] space-y-4">
        <h3 className="font-semibold">Edit Line — SKU #{line.skuId}</h3>
        {line.isTopUp && (
          <p className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
            ⚡ Top-up line — Ship sớm 1 tuần so với forecast (source: {line.sourcePeriodStart})
          </p>
        )}
        {line.requiresVariantReview && (
          <p className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
            ⚠ Variant review required (M24 planner_review_required)
          </p>
        )}
        <div className="space-y-2">
          <label className="text-sm font-medium">Confirmed Qty</label>
          <input
            type="number" min="0"
            className="border rounded px-3 py-1.5 w-full text-sm"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <p className="text-xs text-slate-400">Requested: {line.requestedQty}</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Reason <span className="text-red-500">*</span></label>
          <textarea
            className="border rounded px-3 py-1.5 w-full text-sm h-16"
            placeholder="Mandatory reason for audit log (R7)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 border text-sm rounded">Cancel</button>
          <button onClick={save} disabled={loading} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded disabled:opacity-50">
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({
  poId, poNumber, onClose, onConfirmed,
}: {
  poId: string; poNumber: string; onClose: () => void; onConfirmed: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      const idemKey = uuidv4();
      await confirmPo(poId, idemKey);
      onConfirmed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-[360px] space-y-4">
        <h3 className="font-semibold">Confirm PO {poNumber}</h3>
        <p className="text-sm text-slate-600">
          Thao tác này chuyển PO sang CONFIRMED. Idempotency-key tự động sinh UUID (R13).
          Sau CONFIRMED, chỉ có thể chuyển SHIPPED hoặc CANCEL.
        </p>
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 border text-sm rounded">Back</button>
          <button onClick={doConfirm} disabled={loading} className="px-3 py-1.5 bg-green-600 text-white text-sm rounded disabled:opacity-50">
            {loading ? 'Confirming…' : 'Confirm PO'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cancel dialog ────────────────────────────────────────────────────────────

function CancelDialog({
  poId, poNumber, isTo, onClose, onCancelled,
}: {
  poId: string; poNumber: string; isTo?: boolean; onClose: () => void; onCancelled: () => void;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doCancel = async () => {
    if (reason.trim().length < 20) { setError('Reason phải ≥ 20 ký tự (R11)'); return; }
    setLoading(true);
    setError(null);
    try {
      if (isTo) {
        await cancelTo(poId, reason);
      } else {
        await cancelPo(poId, reason);
      }
      onCancelled();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-[400px] space-y-4">
        <h3 className="font-semibold text-red-700">Cancel {isTo ? 'TO' : 'PO'} {poNumber}</h3>
        <div className="space-y-2">
          <label className="text-sm font-medium">Cancel reason <span className="text-red-500">*</span> (≥ 20 chars)</label>
          <textarea
            className="border rounded px-3 py-1.5 w-full text-sm h-20"
            placeholder="Ghi rõ lý do cancel (mandatory audit R11)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className={`text-xs ${reason.length < 20 ? 'text-red-400' : 'text-green-600'}`}>
            {reason.length}/20 chars minimum
          </p>
        </div>
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 border text-sm rounded">Back</button>
          <button onClick={doCancel} disabled={loading} className="px-3 py-1.5 bg-red-600 text-white text-sm rounded disabled:opacity-50">
            {loading ? 'Cancelling…' : 'Cancel PO'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PO detail panel ──────────────────────────────────────────────────────────

function PoDetailPanel({
  po, onClose, onAction,
}: {
  po: PoHeader; onClose: () => void; onAction: () => void;
}) {
  const [detail, setDetail] = useState<(PoHeader & { lines: PoLine[]; editLog: PoEditLog[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [editLine, setEditLine] = useState<PoLine | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setDetail(await getPoDetail(po.id)); }
    catch { /* ignored */ }
    finally { setLoading(false); }
  }, [po.id]);

  useEffect(() => { load(); }, [load]);

  const handleShip = async () => {
    const vehicleNo = prompt('Số xe (vehicle_no):');
    const carrierCode = prompt('Carrier code:');
    const containerNo = prompt('Số container:');
    if (!vehicleNo || !carrierCode || !containerNo) return;
    try {
      await transitionPo(po.id, { toStatus: 'SHIPPED', vehicleNo, carrierCode, containerNo });
      onAction();
    } catch (e) { alert((e as Error).message); }
  };

  const handleReceive = async () => {
    const qtyStr = prompt('Actual received qty:');
    if (!qtyStr) return;
    const actualQty = Number(qtyStr);
    const confirmedTotal = detail?.lines.reduce((s, l) => s + l.confirmedQty, 0) ?? 0;
    let note = '';
    if (actualQty < confirmedTotal) {
      note = prompt('Note (mandatory khi thực nhận < xác nhận):') ?? '';
      if (!note) { alert('Note bắt buộc khi nhận thiếu (R10)'); return; }
    }
    try {
      await transitionPo(po.id, { toStatus: 'RECEIVED', actualReceivedQty: actualQty, note: note || undefined });
      onAction();
    } catch (e) { alert((e as Error).message); }
  };

  return (
    <div className="fixed inset-0 bg-black/20 flex items-start justify-end z-40">
      <div className="bg-white h-full w-[600px] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-start justify-between">
          <div>
            <h2 className="font-semibold">{po.poNumber}</h2>
            <p className="text-xs text-slate-500 mt-0.5">NM #{po.nmId} → CN #{po.cnId}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={po.status} />
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">×</button>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-3 border-b flex gap-2 flex-wrap">
          {po.status === 'DRAFT' && (
            <button onClick={() => setShowConfirm(true)} className="px-3 py-1 bg-green-600 text-white text-xs rounded">
              Confirm PO
            </button>
          )}
          {po.status === 'CONFIRMED' && (
            <button onClick={handleShip} className="px-3 py-1 bg-amber-600 text-white text-xs rounded">
              Mark SHIPPED
            </button>
          )}
          {po.status === 'SHIPPED' && (
            <button onClick={handleReceive} className="px-3 py-1 bg-purple-600 text-white text-xs rounded">
              Mark RECEIVED
            </button>
          )}
          {po.status === 'RECEIVED' && (
            <button onClick={async () => { try { await transitionPo(po.id, { toStatus: 'CLOSED' }); onAction(); } catch (e) { alert((e as Error).message); } }}
              className="px-3 py-1 bg-slate-600 text-white text-xs rounded">
              Close PO
            </button>
          )}
          {['DRAFT', 'CONFIRMED'].includes(po.status) && (
            <button onClick={() => setShowCancel(true)} className="px-3 py-1 bg-red-100 text-red-700 text-xs rounded">
              Cancel
            </button>
          )}
        </div>

        {warning && (
          <div className="px-5 py-2 bg-amber-50 text-amber-700 text-xs border-b">⚠ {warning}</div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <p className="text-sm text-slate-400 text-center mt-8">Loading…</p>
          ) : detail ? (
            <>
              {/* Lines */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">Lines</h3>
                <div className="border rounded overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1.5 text-left">SKU</th>
                        <th className="px-2 py-1.5 text-right">Req</th>
                        <th className="px-2 py-1.5 text-right">Confirmed</th>
                        <th className="px-2 py-1.5 text-right">Received</th>
                        <th className="px-2 py-1.5 text-center">Flags</th>
                        <th className="px-2 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.filter((l) => l.status === 'ACTIVE').map((l) => (
                        <tr key={l.id} className="border-t hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-mono">{l.skuId}</td>
                          <td className="px-2 py-1.5 text-right">{l.requestedQty}</td>
                          <td className="px-2 py-1.5 text-right font-medium">
                            {l.confirmedQty}
                            {l.qtyExceedsAtp && <span className="ml-1 text-amber-600 text-[9px]">⚠ATP</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right">{l.actualReceivedQty ?? '—'}</td>
                          <td className="px-2 py-1.5 text-center space-x-0.5">
                            {l.isTopUp && <span className="text-amber-500" title={`Top-up: ship sớm (source: ${l.sourcePeriodStart})`}>⚡</span>}
                            {l.requiresVariantReview && <span className="text-orange-500" title="Variant review required">V</span>}
                            {l.deliveryIncomplete && <span className="text-red-500" title={l.deliveryNote ?? ''}>!</span>}
                          </td>
                          <td className="px-2 py-1.5">
                            {po.status === 'DRAFT' && (
                              <button onClick={() => setEditLine(l)} className="text-blue-600 hover:underline text-[10px]">Edit</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Edit log */}
              {detail.editLog.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">Audit Log</h3>
                  <div className="space-y-1">
                    {detail.editLog.map((log) => (
                      <div key={log.id} className="text-xs border-l-2 border-slate-200 pl-2">
                        <span className="font-medium">{log.fieldChanged}</span>
                        {log.oldValue && <span className="text-slate-400"> {log.oldValue} → {log.newValue}</span>}
                        <span className="text-slate-400"> — {log.reason}</span>
                        <span className="text-slate-300 ml-1">by {log.changedBy} at {new Date(log.changedAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      {editLine && (
        <EditLineDialog
          poId={po.id} line={editLine}
          onClose={() => setEditLine(null)}
          onSaved={(w) => { setEditLine(null); setWarning(w ?? null); load(); }}
        />
      )}
      {showConfirm && (
        <ConfirmDialog
          poId={po.id} poNumber={po.poNumber}
          onClose={() => setShowConfirm(false)}
          onConfirmed={() => { setShowConfirm(false); onAction(); }}
        />
      )}
      {showCancel && (
        <CancelDialog
          poId={po.id} poNumber={po.poNumber}
          onClose={() => setShowCancel(false)}
          onCancelled={() => { setShowCancel(false); onAction(); }}
        />
      )}
    </div>
  );
}

// ─── Tab 1: PO List ────────────────────────────────────────────────────────────

function PoTab() {
  const [pos, setPos] = useState<PoHeader[]>([]);
  const [selected, setSelected] = useState<PoHeader | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPo({ status: filterStatus || undefined, limit: 50 });
      setPos(res.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        {['', 'DRAFT', 'CONFIRMED', 'SHIPPED', 'RECEIVED', 'CLOSED', 'CANCELLED'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-2 py-1 text-xs rounded border ${filterStatus === s ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-300'}`}
          >
            {s || 'ALL'}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-3 py-1 border text-xs rounded">Refresh</button>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="border rounded overflow-auto max-h-[520px]">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="px-2 py-2 text-left">PO Number</th>
              <th className="px-2 py-2 text-left">NM</th>
              <th className="px-2 py-2 text-left">CN</th>
              <th className="px-2 py-2 text-right">Total Qty</th>
              <th className="px-2 py-2 text-center">Status</th>
              <th className="px-2 py-2 text-left">ETA</th>
              <th className="px-2 py-2 text-left">Carrier</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-2 py-4 text-center text-slate-400">Loading…</td></tr>}
            {pos.map((p) => (
              <tr key={p.id} className="border-t hover:bg-slate-50">
                <td className="px-2 py-1.5 font-mono font-medium">{p.poNumber}</td>
                <td className="px-2 py-1.5">{p.nmId}</td>
                <td className="px-2 py-1.5">{p.cnId}</td>
                <td className="px-2 py-1.5 text-right">{p.totalQty.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-center"><StatusBadge status={p.status} /></td>
                <td className="px-2 py-1.5">{p.actualEtaDate ?? p.requestedEta ?? '—'}</td>
                <td className="px-2 py-1.5">{p.carrierCode ?? '—'}</td>
                <td className="px-2 py-1.5">
                  <button onClick={() => setSelected(p)} className="text-blue-600 hover:underline text-[10px]">
                    Detail →
                  </button>
                </td>
              </tr>
            ))}
            {!loading && pos.length === 0 && (
              <tr><td colSpan={8} className="px-2 py-4 text-center text-slate-400">No POs found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <PoDetailPanel
          po={selected}
          onClose={() => setSelected(null)}
          onAction={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Tab 2: TO List ────────────────────────────────────────────────────────────

function ToTab() {
  const [tos, setTos] = useState<ToHeader[]>([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCancelId, setShowCancelId] = useState<ToHeader | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listTo({ status: filterStatus || undefined, limit: 50 });
      setTos(res.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  const handleConfirmTo = async (to: ToHeader) => {
    try {
      await confirmTo(to.id, uuidv4());
      load();
    } catch (e) { alert((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        {['', 'DRAFT', 'CONFIRMED', 'SHIPPED', 'RECEIVED', 'CLOSED', 'CANCELLED'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-2 py-1 text-xs rounded border ${filterStatus === s ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-300'}`}
          >
            {s || 'ALL'}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-3 py-1 border text-xs rounded">Refresh</button>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="border rounded overflow-auto max-h-[520px]">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="px-2 py-2 text-left">TO Number</th>
              <th className="px-2 py-2 text-left">Donor CN</th>
              <th className="px-2 py-2 text-left">Receiver CN</th>
              <th className="px-2 py-2 text-right">Total Qty</th>
              <th className="px-2 py-2 text-center">Status</th>
              <th className="px-2 py-2 text-left">Created</th>
              <th className="px-2 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-2 py-4 text-center text-slate-400">Loading…</td></tr>}
            {tos.map((t) => (
              <tr key={t.id} className="border-t hover:bg-slate-50">
                <td className="px-2 py-1.5 font-mono font-medium">{t.toNumber}</td>
                <td className="px-2 py-1.5">{t.donorCnId}</td>
                <td className="px-2 py-1.5">{t.receiverCnId}</td>
                <td className="px-2 py-1.5 text-right">{t.totalQty.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-center"><StatusBadge status={t.status} /></td>
                <td className="px-2 py-1.5 text-slate-500">{new Date(t.createdAt).toLocaleDateString()}</td>
                <td className="px-2 py-1.5 text-center space-x-2">
                  {t.status === 'DRAFT' && (
                    <button onClick={() => handleConfirmTo(t)} className="text-green-700 hover:underline text-[10px]">Confirm</button>
                  )}
                  {['DRAFT', 'CONFIRMED'].includes(t.status) && (
                    <button onClick={() => setShowCancelId(t)} className="text-red-600 hover:underline text-[10px]">Cancel</button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && tos.length === 0 && (
              <tr><td colSpan={7} className="px-2 py-4 text-center text-slate-400">No TOs found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showCancelId && (
        <CancelDialog
          poId={showCancelId.id} poNumber={showCancelId.toNumber} isTo
          onClose={() => setShowCancelId(null)}
          onCancelled={() => { setShowCancelId(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'po', label: 'Purchase Orders (PO)' },
  { id: 'to', label: 'Transfer Orders (TO)' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function PoReviewPage() {
  const [tab, setTab] = useState<TabId>('po');

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">PO / TO Review</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          M27 · Draft Review → Confirm → Ship → Receive · Human decision point
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'po' && <PoTab />}
        {tab === 'to' && <ToTab />}
      </div>
    </div>
  );
}
