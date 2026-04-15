/**
 * guide.ts — Smart Guide status-checking API
 * Calls existing API endpoints to determine current workflow state for M1–M4.
 * Zero impact on existing code — read-only calls only.
 */

const API = (process.env.NEXT_PUBLIC_API_URL ?? '') + '/api/v1';

async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return r.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 1 — Demand Ingestion
// ─────────────────────────────────────────────────────────────────────────────

export type M1Step = 'EMPTY' | 'HAS_DRAFT' | 'DONE';

export interface M1Status {
  step: M1Step;
  frozenCount: number;
  draftCount: number;
  latestFrozenId: string | null;
  latestFrozenName: string | null;
  latestDraftId: string | null;
  latestDraftName: string | null;
  totalLines: number;
}

export async function fetchM1Status(): Promise<M1Status> {
  const [allSnaps] = await Promise.all([
    safeFetch<any>(`${API}/demand/snapshots`),
  ]);

  const snapshots: any[] = allSnaps?.data ?? [];
  const frozen = snapshots.filter((s: any) => s.status === 'FROZEN');
  const draft  = snapshots.filter((s: any) => s.status === 'DRAFT');

  const latestFrozen = frozen[0] ?? null;
  const latestDraft  = draft[0] ?? null;

  return {
    step:             frozen.length > 0 ? 'DONE' : draft.length > 0 ? 'HAS_DRAFT' : 'EMPTY',
    frozenCount:      frozen.length,
    draftCount:       draft.length,
    latestFrozenId:   latestFrozen?.id ?? null,
    latestFrozenName: latestFrozen?.snapshotName ?? null,
    latestDraftId:    latestDraft?.id ?? null,
    latestDraftName:  latestDraft?.snapshotName ?? null,
    totalLines:       latestFrozen?.totalLines ?? latestDraft?.totalLines ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2 — Supply Snapshot
// ─────────────────────────────────────────────────────────────────────────────

export type M2Step = 'EMPTY' | 'STALE_LOT' | 'HAS_DRAFT' | 'STALE_DRAFT' | 'DONE';

export interface M2Status {
  step: M2Step;
  frozenCount: number;
  draftCount: number;
  latestFrozenId: string | null;
  latestDraftId: string | null;
  draftFreshness: 'PASS' | 'STALE' | null;
  draftStaleAcked: boolean;
  lotFreshness: 'PASS' | 'STALE' | 'NO_DATA' | null;
  lotAgeMinutes: number;
  totalLines: number;
}

export async function fetchM2Status(): Promise<M2Status> {
  const [snaps, freshness] = await Promise.all([
    safeFetch<any>(`${API}/supply/snapshots`),
    safeFetch<any>(`${API}/supply/freshness`),
  ]);

  const snapList: any[] = Array.isArray(snaps) ? snaps : (snaps?.data ?? []);
  const frozen = snapList.filter((s: any) => s.status === 'FROZEN');
  const draft  = snapList.filter((s: any) => s.status === 'DRAFT');

  const latestFrozen = frozen[0] ?? null;
  const latestDraft  = draft[0] ?? null;

  const lotFreshness: any = freshness?.overallFreshness ?? null;
  const lotAgeMinutes: number = freshness?.ageMinutes ?? 0;

  let step: M2Step = 'EMPTY';
  if (frozen.length > 0) {
    step = 'DONE';
  } else if (latestDraft) {
    step = latestDraft.freshness === 'STALE' && !latestDraft.staleAcknowledged
      ? 'STALE_DRAFT'
      : 'HAS_DRAFT';
  } else if (lotFreshness === 'STALE') {
    step = 'STALE_LOT';
  }

  return {
    step,
    frozenCount:      frozen.length,
    draftCount:       draft.length,
    latestFrozenId:   latestFrozen?.id?.toString() ?? null,
    latestDraftId:    latestDraft?.id?.toString() ?? null,
    draftFreshness:   latestDraft?.freshness ?? null,
    draftStaleAcked:  latestDraft?.staleAcknowledged ?? false,
    lotFreshness,
    lotAgeMinutes,
    totalLines:       latestFrozen?.totalLines ?? latestDraft?.totalLines ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3 — Inventory Policy
// ─────────────────────────────────────────────────────────────────────────────

export type M3Step = 'EMPTY' | 'ABC_IMPORTED' | 'SS_CALCULATED' | 'DONE';

export interface M3Status {
  step: M3Step;
  hasActiveRun: boolean;
  hasDraftRun: boolean;
  activeRunId: string | null;
  draftRunId: string | null;
  totalCombinations: number;
  lcnbCount: number;
}

export async function fetchM3Status(): Promise<M3Status> {
  const [runs, ssSummary] = await Promise.all([
    safeFetch<any>(`${API}/policy/runs`),
    safeFetch<any>(`${API}/policy/safety-stock/summary`),
  ]);

  const runList: any[] = Array.isArray(runs) ? runs : (runs?.data ?? runs ?? []);
  const active = runList.filter((r: any) => r.status === 'ACTIVE');
  const draft  = runList.filter((r: any) => r.status === 'DRAFT');

  const activeRun = active[0] ?? null;
  const draftRun  = draft[0] ?? null;

  let step: M3Step = 'EMPTY';
  if (active.length > 0) step = 'DONE';
  else if (draft.length > 0) step = 'SS_CALCULATED';

  return {
    step,
    hasActiveRun:      active.length > 0,
    hasDraftRun:       draft.length > 0,
    activeRunId:       activeRun?.id?.toString() ?? null,
    draftRunId:        draftRun?.id?.toString() ?? null,
    totalCombinations: ssSummary?.totalCombinations ?? draftRun?.totalCombinations ?? 0,
    lcnbCount:         ssSummary?.lcnbCount ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 4 — DRP Netting
// ─────────────────────────────────────────────────────────────────────────────

export type M4Step = 'EMPTY' | 'RUNNING' | 'HAS_EXCEPTIONS' | 'HAS_FROZEN_PO' | 'DONE';

export interface M4Status {
  step: M4Step;
  hasCompletedRun: boolean;
  latestRunId: string | null;
  latestRunStatus: string | null;
  totalPlannedOrders: number;
  openExceptions: number;
  frozenZonePending: number;
  stockoutAlerts: number;
}

export async function fetchM4Status(): Promise<M4Status> {
  const runs = await safeFetch<any>(`${API}/drp/run?page=1&limit=1`);
  const runList: any[] = runs?.data ?? (Array.isArray(runs) ? runs : []);
  const latest = runList[0] ?? null;

  if (!latest) {
    return {
      step: 'EMPTY', hasCompletedRun: false, latestRunId: null,
      latestRunStatus: null, totalPlannedOrders: 0,
      openExceptions: 0, frozenZonePending: 0, stockoutAlerts: 0,
    };
  }

  const openExceptions: number = latest.totalExceptions ?? latest.total_exceptions ?? 0;
  const frozenZonePending: number = latest.frozenZoneViolations ?? latest.frozen_zone_violations ?? 0;
  const stockoutAlerts: number = latest.totalStockouts ?? latest.total_stockouts ?? 0;

  let step: M4Step = 'EMPTY';
  if (latest.status === 'RUNNING' || latest.status === 'PENDING') {
    step = 'RUNNING';
  } else if (latest.status === 'COMPLETED') {
    if (frozenZonePending > 0) step = 'HAS_FROZEN_PO';
    else if (openExceptions > 0) step = 'HAS_EXCEPTIONS';
    else step = 'DONE';
  }

  return {
    step,
    hasCompletedRun:    latest.status === 'COMPLETED',
    latestRunId:        latest.id?.toString() ?? null,
    latestRunStatus:    latest.status ?? null,
    totalPlannedOrders: latest.totalPlannedOrders ?? latest.total_planned_orders ?? 0,
    openExceptions,
    frozenZonePending,
    stockoutAlerts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate: fetch all 4 modules in parallel
// ─────────────────────────────────────────────────────────────────────────────

export interface AllModuleStatus {
  m1: M1Status;
  m2: M2Status;
  m3: M3Status;
  m4: M4Status;
  loadedAt: Date;
}

export async function fetchAllStatus(): Promise<AllModuleStatus> {
  const [m1, m2, m3, m4] = await Promise.all([
    fetchM1Status(),
    fetchM2Status(),
    fetchM3Status(),
    fetchM4Status(),
  ]);
  return { m1, m2, m3, m4, loadedAt: new Date() };
}
