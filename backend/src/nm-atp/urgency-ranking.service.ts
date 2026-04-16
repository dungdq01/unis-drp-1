import { Injectable } from '@nestjs/common';
import { UrgencyRankEntry } from './entities/atp-check.entity';

export interface RecipientInput {
  cnId: string;
  cnCode: string;
  requestedQty: number;
}

export interface RankInput {
  atpQty: number;
  recipients: RecipientInput[];
  /** Map<cnId, hstk_days> — preloaded once per run for all CNs */
  hstkMap: Map<string, number>;
  /** Map<cnId, transit_lt_days from NM to this CN> — from transport_lane lane_type='NM_TO_CN' */
  ltMap: Map<string, number>;
}

/**
 * M26 §5 — Urgency Ranking Algorithm (R4-R6, C3 CTO fix).
 *
 * Sort order: (is_critical DESC, hstk_days ASC, cn_code ASC).
 * CRITICAL = hstk_days < transit_lt_days (C3 fix — KHÔNG dùng SS_cn qty, sai dimension).
 * Waterfall: alloc atp_qty to recipients by rank until exhausted.
 */
@Injectable()
export class UrgencyRankingService {
  rank(input: RankInput): UrgencyRankEntry[] {
    const DEFAULT_HSTK = 10;
    const DEFAULT_LT = 2;

    // Annotate each recipient with HSTK + LT
    const annotated = input.recipients.map((r) => {
      const hstkDays = input.hstkMap.get(r.cnId) ?? DEFAULT_HSTK;
      const transitLtDays = input.ltMap.get(r.cnId) ?? DEFAULT_LT;
      const isCritical = hstkDays < transitLtDays; // C3 fix
      return { ...r, hstkDays, transitLtDays, isCritical };
    });

    // Sort: is_critical DESC → hstk_days ASC → cn_code ASC (M3 fix: deterministic tie-break)
    annotated.sort((a, b) => {
      if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
      if (a.hstkDays !== b.hstkDays) return a.hstkDays - b.hstkDays;
      return a.cnCode.localeCompare(b.cnCode);
    });

    // Waterfall alloc (R6)
    let remaining = input.atpQty;
    return annotated.map((r, idx) => {
      const alloc = Math.min(r.requestedQty, Math.max(0, remaining));
      remaining -= alloc;
      return {
        cnId: r.cnId,
        cnCode: r.cnCode,
        hstkDays: r.hstkDays,
        transitLtDays: r.transitLtDays,
        isCritical: r.isCritical,
        requestedQty: r.requestedQty,
        atpAlloc: Math.round(alloc * 100) / 100,
        unfulfilled: Math.round((r.requestedQty - alloc) * 100) / 100,
        rank: idx + 1,
      };
    });
  }
}
