import { Injectable, Logger } from '@nestjs/common';
import { HonoringRateService } from '../nm-atp/honoring-rate.service';

/**
 * M28 Step 6 — NM Honoring Backfill (R5, M1 sweep coordination).
 *
 * M28 weekly calls M26.HonoringRateService.recompute(month, 'weekly_rolling')
 *   → updates rolling_3m_rate for last 3 months (KHÔNG tạo row mới)
 *   → M26 monthly cron Day 1 = source of truth for row per period_month.
 * Race-safe: same service method, mode='weekly_rolling' vs 'monthly_full'.
 */
@Injectable()
export class HonoringBackfillService {
  private readonly logger = new Logger(HonoringBackfillService.name);

  constructor(private readonly honoringSvc: HonoringRateService) {}

  async run(weekStart: string): Promise<{ nmCount: number; unreliableCount: number }> {
    // Month = month of weekStart
    const month = weekStart.slice(0, 7) + '-01';
    const result = await this.honoringSvc.recompute(month, 'weekly_rolling');
    this.logger.log(
      `[Honoring-Backfill] week=${weekStart}: ${result.nmCount} NMs refreshed, ${result.unreliableCount} unreliable`,
    );
    return result;
  }
}
