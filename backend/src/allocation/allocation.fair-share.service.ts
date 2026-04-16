import { Injectable } from '@nestjs/common';

export interface CellDemand {
  cnId: string;
  skuId: string;
  periodStart: string;  // C1 fix: week grain preserved through allocation
  netDemand: number;
}

/** Map<"cnId|skuId|periodStart", quota> */
export type FairShareQuotaMap = Map<string, number>;

/**
 * M24 §4 Step 5.5 [C3 fix] — Fair-share pre-compute at (sku, week) grain.
 *
 * For each (sku, week) group:
 *   If hub_available[sku|week] < Σ_CN(net_demand[cn][sku|week]):
 *     quota[cn][sku][week] = hub_available × (cn_demand / Σ demand)
 *   Else: quota = cn_demand (no cap)
 *
 * Hub pool is keyed per (sku, week) — a hub shortfall in week-N does not
 * starve week-M.
 */
@Injectable()
export class AllocationFairShareService {
  compute(cells: CellDemand[], hubBySkuWeek: Map<string, number>): FairShareQuotaMap {
    const totalDemandBySkuWeek = new Map<string, number>();
    for (const c of cells) {
      if (c.netDemand <= 0) continue;
      const grp = `${c.skuId}|${c.periodStart}`;
      totalDemandBySkuWeek.set(grp, (totalDemandBySkuWeek.get(grp) ?? 0) + c.netDemand);
    }

    const quota: FairShareQuotaMap = new Map();
    for (const c of cells) {
      const cellKey = `${c.cnId}|${c.skuId}|${c.periodStart}`;
      if (c.netDemand <= 0) {
        quota.set(cellKey, 0);
        continue;
      }
      const grp = `${c.skuId}|${c.periodStart}`;
      const hubAvail = hubBySkuWeek.get(grp) ?? 0;
      const totalDemand = totalDemandBySkuWeek.get(grp) ?? 0;
      if (totalDemand <= 0 || hubAvail >= totalDemand) {
        quota.set(cellKey, c.netDemand);
      } else {
        const share = hubAvail * (c.netDemand / totalDemand);
        quota.set(cellKey, Math.max(0, share));
      }
    }
    return quota;
  }
}
