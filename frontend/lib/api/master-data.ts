const BASE = 'http://localhost:3002/api/v1/master-data';

export interface Sku {
  id: string;
  skuCode: string;
  skuName: string;
  uom: string;
  productGroup: string | null;
  active: boolean;
  nmCode?: string;
  moq?: number;
}

export interface Channel {
  id: string;
  cnCode: string;
  cnName: string;
  region: string | null;
  lat: number;
  lng: number;
  connectivity: string;
  active: boolean;
}

export interface Supplier {
  supplierCode: string;
  supplierName: string;
  leadTimeDays: number | null;
  region: string | null;
  factoryCode: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  ltDriftCount: number;
}

export interface Hub {
  id: string;
  hubCode: string;
  hubName: string;
  hubType: 'VIRTUAL' | 'PHYSICAL';
  lat: number | null;
  lng: number | null;
  active: boolean;
}

export interface QualityMetrics {
  skuNoNmMapping: number;
  channelNoLatLng: number;
  supplierNoSkuMapping: number;
  skuNoRecentSupply: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchSkus(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  activeOnly?: boolean;
}): Promise<PaginatedResponse<Sku>> {
  const q = new URLSearchParams({
    page: String(params?.page ?? 1),
    pageSize: String(params?.pageSize ?? 20),
    ...(params?.search ? { search: params.search } : {}),
    ...(params?.activeOnly !== undefined ? { activeOnly: String(params.activeOnly) } : {}),
  });
  const r = await fetch(`${BASE}/skus?${q}`);
  return r.json();
}

export async function createSku(body: Partial<Sku>): Promise<Sku> {
  const r = await fetch(`${BASE}/skus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': 'admin' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function updateSku(id: string, body: Partial<Sku>): Promise<Sku> {
  const r = await fetch(`${BASE}/skus/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-id': 'admin' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function deactivateSku(id: string): Promise<void> {
  // Controller returns 204 No Content — do NOT call r.json() (throws SyntaxError)
  await fetch(`${BASE}/skus/${id}`, {
    method: 'DELETE',
    headers: { 'x-user-id': 'admin' },
  });
}

export async function fetchChannels(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<PaginatedResponse<Channel>> {
  const q = new URLSearchParams({
    page: String(params?.page ?? 1),
    pageSize: String(params?.pageSize ?? 50),
    ...(params?.search ? { search: params.search } : {}),
  });
  const r = await fetch(`${BASE}/channels?${q}`);
  return r.json();
}

export async function createChannel(body: Partial<Channel>): Promise<Channel> {
  const r = await fetch(`${BASE}/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': 'admin' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function updateChannel(id: string, body: Partial<Channel>): Promise<Channel> {
  const r = await fetch(`${BASE}/channels/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-id': 'admin' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function fetchSuppliers(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<PaginatedResponse<Supplier>> {
  const q = new URLSearchParams({
    page: String(params?.page ?? 1),
    pageSize: String(params?.pageSize ?? 50),
    ...(params?.search ? { search: params.search } : {}),
  });
  const r = await fetch(`${BASE}/suppliers?${q}`);
  return r.json();
}

export async function updateSupplier(
  supplierCode: string,
  body: { supplierName?: string; leadTimeDays?: number | null; region?: string | null; factoryCode?: string | null; status?: string }
): Promise<Supplier> {
  const r = await fetch(`${BASE}/suppliers/${supplierCode}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-id': 'admin' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function fetchHubs(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<PaginatedResponse<Hub>> {
  const q = new URLSearchParams({
    page: String(params?.page ?? 1),
    pageSize: String(params?.pageSize ?? 50),
    ...(params?.search ? { search: params.search } : {}),
  });
  const r = await fetch(`${BASE}/hubs?${q}`);
  return r.json();
}

export async function createHub(body: Partial<Hub>): Promise<Hub> {
  const r = await fetch(`${BASE}/hubs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': 'admin' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function fetchQuality(): Promise<QualityMetrics> {
  const r = await fetch(`${BASE}/quality`);
  return r.json();
}
