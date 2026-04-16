import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TrustScore } from './entities/trust-score.entity';

@Injectable()
export class TrustScoreService implements OnApplicationBootstrap, OnApplicationShutdown {
  private _cronTimers: NodeJS.Timeout[] = [];

  constructor(
    @InjectRepository(TrustScore)
    private readonly trustRepo: Repository<TrustScore>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ── Cron: Monday 06:00 VN ─────────────────────────────────────────────────

  onApplicationBootstrap() {
    this._scheduleMonday0600VN();
  }

  onApplicationShutdown() {
    this._cronTimers.forEach(t => clearTimeout(t));
    this._cronTimers = [];
  }

  private _scheduleMonday0600VN() {
    const msUntilNext = () => {
      const nowMs = Date.now();
      const vnNow = new Date(nowMs + 7 * 60 * 60 * 1000);
      // Find next Monday
      const day = vnNow.getUTCDay(); // 0=Sun,1=Mon…
      const daysUntilMon = day === 1 ? 7 : (8 - day) % 7; // if today Mon → next Mon
      const nextMon = new Date(Date.UTC(
        vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + daysUntilMon,
        6 - 7, 0, 0, 0, // 06:00 VN = 23:00 UTC prev day (may underflow — Date handles it)
      ));
      // If 06:00 VN today is still in the future and today is Mon
      if (day === 1) {
        const todayFire = new Date(Date.UTC(
          vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate(),
          6 - 7, 0, 0, 0,
        ));
        if (todayFire.getTime() > nowMs) return todayFire.getTime() - nowMs;
      }
      return nextMon.getTime() - nowMs;
    };

    const scheduleNext = () => {
      const delay = msUntilNext();
      const timer = setTimeout(async () => {
        try {
          await this.recalculateAll();
        } catch (e) {
          console.error('[TrustScore] weekly cron failed:', e);
        }
        scheduleNext();
      }, delay);
      this._cronTimers.push(timer);
    };

    scheduleNext();
  }

  // ── Public methods ────────────────────────────────────────────────────────

  async getAll(): Promise<TrustScore[]> {
    return this.trustRepo.find({ order: { cnId: 'ASC' } });
  }

  async getForCn(cnId: string): Promise<TrustScore | null> {
    let row = await this.trustRepo.findOne({ where: { cnId } });
    if (!row) {
      // Lazy create with default 100 grace (first time a CN submits)
      row = this.trustRepo.create({ cnId, score: 100, isGracePeriod: true });
      row = await this.trustRepo.save(row);
    }
    return row;
  }

  /**
   * Recalculate trust score for all CNs.
   * Phase 1: if no actual_qty data → keep score=100, is_grace_period=TRUE (noop).
   * Phase 2: when M28 backfills actual_qty → full calculation.
   */
  async recalculateAll(): Promise<{ updated: number }> {
    const cns = await this.dataSource.query<{ cn_id: string }[]>(
      `SELECT DISTINCT cn_id FROM cn_demand_adjustment
       WHERE status IN ('AUTO_APPROVED','APPROVED','FORCE_APPROVED')`,
    );

    let updated = 0;
    for (const { cn_id } of cns) {
      const rows = await this.dataSource.query<{
        total: number; accurate: number; has_actual: boolean;
      }[]>(`
        SELECT
          COUNT(*)::INT                                                          AS total,
          COUNT(*) FILTER (WHERE is_accurate = TRUE)::INT                       AS accurate,
          BOOL_OR(actual_qty IS NOT NULL)                                        AS has_actual
        FROM cn_demand_adjustment
        WHERE cn_id = $1
          AND submitted_at >= NOW() - INTERVAL '12 weeks'
          AND status IN ('AUTO_APPROVED','APPROVED','FORCE_APPROVED')
      `, [cn_id]);

      const { total, accurate, has_actual } = rows[0];

      if (!has_actual || total === 0) {
        // Phase 1 grace — keep default, just update timestamp
        await this.dataSource.query(
          `INSERT INTO trust_score (cn_id, score, is_grace_period, last_calculated_at)
           VALUES ($1, 100, TRUE, NOW())
           ON CONFLICT (cn_id) DO UPDATE
             SET last_calculated_at = NOW(), is_grace_period = TRUE`,
          [cn_id],
        );
      } else {
        const score = total > 0 ? Math.round((accurate / total) * 100 * 100) / 100 : 100;
        await this.dataSource.query(
          `INSERT INTO trust_score
             (cn_id, score, total_adjustments_12w, accurate_adjustments_12w, last_calculated_at, is_grace_period)
           VALUES ($1, $2, $3, $4, NOW(), FALSE)
           ON CONFLICT (cn_id) DO UPDATE
             SET score = $2,
                 total_adjustments_12w = $3,
                 accurate_adjustments_12w = $4,
                 last_calculated_at = NOW(),
                 is_grace_period = FALSE`,
          [cn_id, score, total, accurate],
        );
        updated++;
      }
    }

    return { updated };
  }
}
