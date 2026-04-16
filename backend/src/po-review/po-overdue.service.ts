import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * M27 PO_OVERDUE alert cron (R12).
 * Fires daily 09:00 VN. PO CONFIRMED > overdue_days (default 7) without SHIPPED → alert M8 + dashboard flag.
 */
@Injectable()
export class PoOverdueService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PoOverdueService.name);
  private _cronTimer: NodeJS.Timeout | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onApplicationBootstrap(): void {
    this._scheduleDailyCron();
  }

  private _scheduleDailyCron(): void {
    const msUntil = this._msUntilNext09VN();
    this._cronTimer = setTimeout(async () => {
      try {
        const result = await this.checkOverdue();
        this.logger.log(`[CRON 09:00 VN] PO_OVERDUE: ${result.overduePoCount} PO, ${result.overdueToCount} TO`);
      } catch (err) {
        this.logger.error(`[CRON PO_OVERDUE] failed: ${(err as Error).message}`);
      } finally {
        this._scheduleDailyCron();
      }
    }, msUntil);
  }

  async checkOverdue(): Promise<{ overduePoCount: number; overdueToCount: number }> {
    // Read overdue_days from system_config (R14 policy pin fallback)
    const cfgRows: Array<{ config_value: string }> = await this.dataSource.query(
      `SELECT config_value FROM system_config WHERE config_key = 'po.overdue_days' LIMIT 1`,
    );
    const overdueDays = parseInt(cfgRows[0]?.config_value ?? '7', 10);

    const overduePo: Array<{ id: string; po_number: string; nm_id: string; cn_id: string }> =
      await this.dataSource.query(
        `SELECT id::text, po_number, nm_id::text, cn_id::text
         FROM po_header
         WHERE status = 'CONFIRMED'
           AND confirmed_at < NOW() - INTERVAL '${overdueDays} days'
         ORDER BY confirmed_at ASC`,
      );

    for (const po of overduePo) {
      // Phase 1: log as M8 stub alert
      this.logger.warn(
        `[PO_OVERDUE] PO ${po.po_number} NM#${po.nm_id}→CN#${po.cn_id}: ` +
          `>${overdueDays} ngày chưa SHIPPED — follow-up NM (M8 alert stub)`,
      );
    }

    const overdueTO: Array<{ id: string; to_number: string }> = await this.dataSource.query(
      `SELECT id::text, to_number
       FROM to_header
       WHERE status = 'CONFIRMED'
         AND confirmed_at < NOW() - INTERVAL '${overdueDays} days'`,
    );

    for (const to of overdueTO) {
      this.logger.warn(
        `[TO_OVERDUE] TO ${to.to_number}: >${overdueDays} ngày chưa SHIPPED (M8 alert stub)`,
      );
    }

    return { overduePoCount: overduePo.length, overdueToCount: overdueTO.length };
  }

  private _msUntilNext09VN(): number {
    // 09:00 VN = 02:00 UTC
    const nowMs = Date.now();
    const vnNow = new Date(nowMs + 7 * 60 * 60 * 1000);
    let year = vnNow.getUTCFullYear();
    let month = vnNow.getUTCMonth();
    let day = vnNow.getUTCDate();
    // If current VN time >= 09:00, fire tomorrow
    if (vnNow.getUTCHours() >= 9) {
      day += 1;
    }
    const fire = new Date(Date.UTC(year, month, day, 9 - 7, 0, 0, 0));
    const diff = fire.getTime() - nowMs;
    return diff > 0 ? diff : 60_000;  // safety: min 1 min
  }
}
