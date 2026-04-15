const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
function apiUrl(p: string) { return `${BASE_URL}/api/v1${p}`; }

async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`API ${res.status}: ${t}`); }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type BatchStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'EXPORTED' | 'CANCELLED';
export type LineStatus  = 'ACTIVE' | 'CANCELLED';
export type OrderType   = 'TO' | 'SO' | 'PO';

export interface OrderBatch {
  id: string;
  transportPlanId: string;
  batchCode: string;
  status: BatchStatus;
  totalLines: number;
  totalQty: number;
  totalValueVnd: number;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  exportedBy: string | null;
  exportedAt: string | null;
  createdBy: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderLine {
  id: string;
  orderBatchId: string;
  orderNo: string;
  orderType: OrderType;
  sourceLocationCode: string;
  destLocationCode: string;
  itemCode: string;
  itemName: string | null;
  baseUom: string;
  qty: number;
  unitPriceVnd: number;
  totalValueVnd: number;
  departureDate: string | null;
  etaDate: string | null;
  carrierCode: string | null;
  transportTripId: string | null;
  allocationResultId: string | null;
  status: LineStatus;
  erpRef: string | null;
  note: string | null;
  createdAt: string;
}

export interface OrderStats {
  total_batches: string;
  draft: string;
  submitted: string;
  approved: string;
  exported: string;
  cancelled: string;
  total_lines: string;
  total_qty: string;
  total_value_vnd: string;
}

export interface PageMeta { page: number; pageSize: number; total: number; totalPages: number; }

// ─── API ──────────────────────────────────────────────────────────────────────

export const fetchOrderStats = () =>
  fetch(apiUrl('/orders/stats'), { cache: 'no-store' })
    .then(r => handleRes<OrderStats>(r));

export const createOrderBatch = (transportPlanId: string, createdBy?: string) =>
  fetch(apiUrl('/orders/batches'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transportPlanId, createdBy }),
  }).then(r => handleRes<OrderBatch>(r));

export const fetchOrderBatches = (page = 1, pageSize = 20, status?: string) => {
  const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) q.set('status', status);
  return fetch(apiUrl(`/orders/batches?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: OrderBatch[]; meta: PageMeta }>(r));
};

export const fetchOrderBatch = (id: string) =>
  fetch(apiUrl(`/orders/batches/${id}`), { cache: 'no-store' })
    .then(r => handleRes<OrderBatch>(r));

export const fetchOrderLines = (batchId: string, params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetch(apiUrl(`/orders/batches/${batchId}/lines?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: OrderLine[]; meta: PageMeta }>(r));
};

export const submitBatch = (id: string, submittedBy?: string) =>
  fetch(apiUrl(`/orders/batches/${id}/submit`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ submittedBy }),
  }).then(r => handleRes<OrderBatch>(r));

export const approveBatch = (id: string, approvedBy?: string) =>
  fetch(apiUrl(`/orders/batches/${id}/approve`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvedBy }),
  }).then(r => handleRes<OrderBatch>(r));

export const rejectBatch = (id: string, rejectReason: string, rejectedBy?: string) =>
  fetch(apiUrl(`/orders/batches/${id}/reject`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rejectReason, rejectedBy }),
  }).then(r => handleRes<OrderBatch>(r));

export const cancelBatch = (id: string, cancelledBy?: string) => {
  const q = cancelledBy ? `?cancelledBy=${encodeURIComponent(cancelledBy)}` : '';
  return fetch(apiUrl(`/orders/batches/${id}${q}`), { method: 'DELETE' })
    .then(r => handleRes<OrderBatch>(r));
};

export const updateOrderLine = (lineId: string, body: {
  unitPriceVnd?: number; erpRef?: string; note?: string; status?: LineStatus;
}) =>
  fetch(apiUrl(`/orders/lines/${lineId}`), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => handleRes<OrderLine>(r));

export const exportBatchCsv = async (id: string, exportedBy?: string): Promise<void> => {
  const q = exportedBy ? `?exportedBy=${encodeURIComponent(exportedBy)}` : '';
  const res = await fetch(apiUrl(`/orders/batches/${id}/export${q}`), { method: 'POST' });
  if (!res.ok) { const t = await res.text(); throw new Error(`Export failed: ${t}`); }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const filenameMatch = cd.match(/filename="([^"]+)"/);
  const filename = filenameMatch?.[1] ?? `orders_${id}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};
