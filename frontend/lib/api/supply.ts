const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FreshnessStatus {
  overallFreshness: 'PASS' | 'STALE' | 'NO_DATA';
  oldestSync: string | null;
  newestSync: string | null;
  ageMinutes: number;
  thresholdMinutes: number;
  staleLocations: string[];
}

export interface SupplySnapshot {
  id: string;
  snapshotName: string;
  status: 'DRAFT' | 'FROZEN' | 'ARCHIVED';
  freshness: 'PASS' | 'STALE';
  freshnessAgeMinutes: number;
  totalLines: number;
  totalItems: number;
  totalLocations: number;
  totalAllocatableQty: number;
  totalReservedQty: number;
  totalInTransitQty: number;
  estimatedLinesCount: number;
  staleAcknowledged: boolean;
  staleReason: string | null;
  captureAt: string;
  frozenAt: string | null;
  frozenBy: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface SupplySnapshotLine {
  id: string;
  snapshotId: string;
  itemCode: string;
  locationCode: string;
  allocatableQty: number;
  reservedQty: number;
  inTransitQty: number;
  isEstimated: boolean;
  oldestSyncAt: string | null;
  freshness: 'PASS' | 'STALE';
  overrideQty: number | null;
  overrideReason: string | null;
  overrideBy: string | null;
  overrideAt: string | null;
}

export interface BravoUploadResult {
  rowsParsed: number;
  rowsUpdated: number;
  rowsInserted: number;
  rowsSkipped: number;
  unmappedItems: string[];
  unmappedLocations: string[];
  syncTimestamp: string;
}

export interface SnapshotLinesMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function apiUrl(path: string): string {
  return `${BASE_URL}/api/v1${path}`;
}

// ─── API Functions ────────────────────────────────────────────────────────────

export async function fetchFreshnessStatus(): Promise<FreshnessStatus> {
  const res = await fetch(apiUrl('/supply/freshness'), { cache: 'no-store' });
  return handleResponse<FreshnessStatus>(res);
}

export async function fetchSnapshots(): Promise<SupplySnapshot[]> {
  const res = await fetch(apiUrl('/supply/snapshots'), { cache: 'no-store' });
  return handleResponse<SupplySnapshot[]>(res);
}

export async function captureSnapshot(body: {
  snapshotName: string;
  includeInTransit?: boolean;
  locationCodes?: string[];   // Phase B: filter by location
}): Promise<SupplySnapshot> {
  const res = await fetch(apiUrl('/supply/snapshots'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse<SupplySnapshot>(res);
}

export async function fetchSnapshot(id: string): Promise<SupplySnapshot> {
  const res = await fetch(apiUrl(`/supply/snapshots/${id}`), { cache: 'no-store' });
  return handleResponse<SupplySnapshot>(res);
}

export async function fetchSnapshotLines(
  id: string,
  params: {
    page?: number;
    pageSize?: number;
    itemCode?: string;
    locationCode?: string;
    estimated?: 'all' | 'oem' | 'estimated';
    freshness?: 'all' | 'PASS' | 'STALE';
  } = {},
): Promise<{ data: SupplySnapshotLine[]; meta: SnapshotLinesMeta }> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  if (params.itemCode) query.set('itemCode', params.itemCode);
  if (params.locationCode) query.set('locationCode', params.locationCode);
  if (params.estimated && params.estimated !== 'all') query.set('estimated', params.estimated);
  if (params.freshness && params.freshness !== 'all') query.set('freshness', params.freshness);

  const url = `${apiUrl(`/supply/snapshots/${id}/lines`)}?${query.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  return handleResponse<{ data: SupplySnapshotLine[]; meta: SnapshotLinesMeta }>(res);
}

export interface GroupedItemRow {
  itemCode: string;
  locationCount: number;
  allocatableQty: number;
  reservedQty: number;
  inTransitQty: number;
  hasStale: boolean;
  hasOverride: boolean;
}

export interface GroupedLocationRow {
  locationCode: string;
  locationName: string | null;
  itemCount: number;
  allocatableQty: number;
  reservedQty: number;
  inTransitQty: number;
  hasStale: boolean;
  hasOverride: boolean;
}

export async function fetchGroupedByItem(
  id: string,
  params: { page?: number; pageSize?: number; itemCode?: string } = {},
): Promise<{ data: GroupedItemRow[]; meta: SnapshotLinesMeta }> {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  if (params.itemCode) q.set('itemCode', params.itemCode);
  const res = await fetch(`${apiUrl(`/supply/snapshots/${id}/by-item`)}?${q}`, { cache: 'no-store' });
  return handleResponse(res);
}

export async function fetchGroupedByLocation(
  id: string,
  params: { page?: number; pageSize?: number; locationCode?: string } = {},
): Promise<{ data: GroupedLocationRow[]; meta: SnapshotLinesMeta }> {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  if (params.locationCode) q.set('locationCode', params.locationCode);
  const res = await fetch(`${apiUrl(`/supply/snapshots/${id}/by-location`)}?${q}`, { cache: 'no-store' });
  return handleResponse(res);
}

export interface SnapshotStats {
  qtyByLocation: { locationCode: string; allocatableQty: number; lineCount: number }[];
  stockBreakdown: { zero: number; low: number; normal: number };
  sourceBreakdown: { oem: number; estimated: number };
  topItems: { itemCode: string; allocatableQty: number }[];
}

export async function fetchSnapshotStats(id: string): Promise<SnapshotStats> {
  const res = await fetch(apiUrl(`/supply/snapshots/${id}/stats`), { cache: 'no-store' });
  return handleResponse<SnapshotStats>(res);
}

export async function freezeSnapshot(id: string, frozenBy?: string): Promise<SupplySnapshot> {
  const res = await fetch(apiUrl(`/supply/snapshots/${id}/freeze`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frozenBy }),
  });
  return handleResponse<SupplySnapshot>(res);
}

export async function acknowledgeStale(
  id: string,
  reason: string,
  userId?: string,
): Promise<SupplySnapshot> {
  const res = await fetch(apiUrl(`/supply/snapshots/${id}/acknowledge-stale`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, userId }),
  });
  return handleResponse<SupplySnapshot>(res);
}

export async function overrideLine(
  lineId: string,
  qty: number,
  reason: string,
  userId?: string,
): Promise<SupplySnapshotLine> {
  const res = await fetch(apiUrl(`/supply/lines/${lineId}/override`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qty, reason, userId }),
  });
  return handleResponse<SupplySnapshotLine>(res);
}

export interface ManualEntryRow {
  item_code: string;
  location_code: string;
  on_hand_qty: number;
  reserved_qty?: number;
  in_transit_qty?: number;
  source_type?: string;
}

export async function manualBravoEntry(rows: ManualEntryRow[]): Promise<BravoUploadResult> {
  const res = await fetch(apiUrl('/supply/bravo/manual'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  return handleResponse<BravoUploadResult>(res);
}

export async function uploadBravo(file: File): Promise<BravoUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(apiUrl('/supply/bravo/upload'), {
    method: 'POST',
    body: formData,
  });
  return handleResponse<BravoUploadResult>(res);
}

// ─── BE-A3/A4: Meta endpoints ─────────────────────────────────────────────────

export interface SupplyMetaLocation {
  locationCode: string;
  itemCount: number;
  totalAllocatable: number;
}

export interface SupplyMetaItem {
  itemCode: string;
  locationCount: number;
  totalAllocatable: number;
}

export async function fetchSupplyMetaLocations(): Promise<{ locations: SupplyMetaLocation[] }> {
  const res = await fetch(apiUrl('/supply/meta/locations'));
  return handleResponse<{ locations: SupplyMetaLocation[] }>(res);
}

export async function fetchSupplyMetaItems(locationCodes?: string[]): Promise<{ items: SupplyMetaItem[] }> {
  const qs = locationCodes && locationCodes.length > 0 ? `?locationCodes=${locationCodes.join(',')}` : '';
  const res = await fetch(apiUrl(`/supply/meta/items${qs}`));
  return handleResponse<{ items: SupplyMetaItem[] }>(res);
}
