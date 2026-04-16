import {
  Injectable,
  BadRequestException,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CnDemandAdjustment, AdjustStatus } from './entities/cn-demand-adjustment.entity';
import { CnAdjustAuditLog } from './entities/cn-adjust-audit-log.entity';
import { ReasonCode } from './entities/reason-code.entity';
import { TrustScoreService } from './trust-score.service';
import { SubmitAdjustmentDto, ForceSubmitDto, ReviewDto } from './dto/submit-adjustment.dto';
import { AdjustHistoryQueryDto } from './dto/query-adjustment.dto';
import { mondayOfStr, isPastCutoffVN } from '../common/date-utils';

// Active statuses — used in effective demand query
const ACTIVE_STATUSES: AdjustStatus[] = ['AUTO_APPROVED', 'APPROVED', 'FORCE_APPROVED'];

@Injectable()
export class CnAdjustService implements OnApplicationBootstrap, OnApplicationShutdown {
  private _cronTimers: NodeJS.Timeout[] = [];

  constructor(
    @InjectRepository(CnDemandAdjustment)
    private readonly adjRepo: Repository<CnDemandAdjustment>,
    @InjectRepository(CnAdjustAuditLog)
    private readonly auditRepo: Repository<CnAdjustAuditLog>,
    @InjectRepository(ReasonCode)
    private readonly reasonRepo: Repository<ReasonCode>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly trustScoreSvc: TrustScoreService,
  ) {}

  // ── Cron: 18:05 VN — expire pending ──────────────────────────────────────

  onApplicationBootstrap() {
    this._scheduleCutoffCron();
  }

  onApplicationShutdown() {
    this._cronTimers.forEach(t => clearTimeout(t));
    this._cronTimers = [];
  }

  private _scheduleCutoffCron() {
    const msUntilNext = () => {
      const nowMs = Date.now();
      const vnNow = new Date(nowMs + 7 * 60 * 60 * 1000);
      // Fire at 18:05 VN = 11:05 UTC
      const fire = new Date(Date.UTC(
        vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate(),
        18 - 7, 5, 0, 0,
      ));
      if (fire.getTime() <= nowMs) fire.setUTCDate(fire.getUTCDate() + 1);
      return fire.getTime() - nowMs;
    };

    const scheduleNext = () => {
      const timer = setTimeout(async () => {
        try { await this.expirePendingCutoff(); }
        catch (e) { console.error('[CnAdjust] cutoff cron failed:', e); }
        scheduleNext();
      }, msUntilNext());
      this._cronTimers.push(timer);
    };

    scheduleNext();
  }

  // ── Submit adjustment (CN role) ───────────────────────────────────────────

  async submitAdjustment(dto: SubmitAdjustmentDto): Promise<CnDemandAdjustment> {
    // R4: cutoff check
    const cutoff = await this._getCutoffTime();
    if (isPastCutoffVN(cutoff)) {
      throw new BadRequestException(
        `Đã quá cutoff ${cutoff}. Liên hệ SC Manager force override nếu khẩn cấp.`,
      );
    }

    return this._doSubmit(dto, false);
  }

  // ── Force submit (SC Manager — bypass cutoff) ─────────────────────────────

  async forceSubmit(dto: ForceSubmitDto, userId: string): Promise<CnDemandAdjustment> {
    // M5: reason_text min 20 chars mandatory for force
    if (!dto.reasonText || dto.reasonText.length < 20) {
      throw new BadRequestException('Force override: reason_text bắt buộc và ≥ 20 ký tự');
    }
    return this._doSubmit({ ...dto, submittedBy: userId }, true);
  }

  // ── SC Manager review queue ───────────────────────────────────────────────

  async getQueue(): Promise<CnDemandAdjustment[]> {
    return this.adjRepo.find({
      where: { status: 'PENDING' },
      order: { submittedAt: 'ASC' },
    });
  }

  // ── Approve ───────────────────────────────────────────────────────────────

  async approve(id: string, dto: ReviewDto): Promise<CnDemandAdjustment> {
    const adj = await this._requireAdj(id, ['PENDING']);
    adj.status = 'APPROVED';
    adj.reviewedBy = dto.reviewedBy;
    adj.reviewedAt = new Date();
    adj.reviewNote = dto.reviewNote ?? null;
    const saved = await this.adjRepo.save(adj);
    await this._audit(saved, 'APPROVE', 'PENDING', 'APPROVED', dto.reviewedBy, dto.reviewNote);
    return saved;
  }

  // ── Reject ────────────────────────────────────────────────────────────────

  async reject(id: string, dto: ReviewDto): Promise<CnDemandAdjustment> {
    const adj = await this._requireAdj(id, ['PENDING']);
    adj.status = 'REJECTED';
    adj.reviewedBy = dto.reviewedBy;
    adj.reviewedAt = new Date();
    adj.reviewNote = dto.reviewNote ?? null;
    const saved = await this.adjRepo.save(adj);
    await this._audit(saved, 'REJECT', 'PENDING', 'REJECTED', dto.reviewedBy, dto.reviewNote);
    return saved;
  }

  // ── CN: my adjustments ────────────────────────────────────────────────────

  async getMyAdjustments(cnId: string, query: AdjustHistoryQueryDto): Promise<{
    data: CnDemandAdjustment[]; total: number; page: number; pageSize: number;
  }> {
    const qb = this.adjRepo.createQueryBuilder('a')
      .where('a.cnId = :cnId', { cnId })
      .orderBy('a.submittedAt', 'DESC');

    if (query.periodStart) qb.andWhere('a.periodDate >= :start', { start: query.periodStart });
    if (query.periodEnd)   qb.andWhere('a.periodDate <= :end',   { end: query.periodEnd });

    qb.skip((query.page - 1) * query.pageSize).take(query.pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  // ── History (SC Manager view — all CNs) ───────────────────────────────────

  async getHistory(query: AdjustHistoryQueryDto): Promise<{
    data: CnDemandAdjustment[]; total: number; page: number; pageSize: number;
  }> {
    const qb = this.adjRepo.createQueryBuilder('a').orderBy('a.submittedAt', 'DESC');
    if (query.cnId)        qb.andWhere('a.cnId = :cnId',     { cnId: query.cnId });
    if (query.periodStart) qb.andWhere('a.periodDate >= :s', { s: query.periodStart });
    if (query.periodEnd)   qb.andWhere('a.periodDate <= :e', { e: query.periodEnd });
    qb.skip((query.page - 1) * query.pageSize).take(query.pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  // ── getEffectiveDemand — M23 DRP injectable (spec §14) ───────────────────

  /**
   * M23 DRP gọi method này TRỰC TIẾP (không qua HTTP).
   * @param weekStart Monday date string 'YYYY-MM-DD' (mondayOf(drpRunDate))
   * @returns Map keyed by "cnId|skuId" → adjusted_qty
   * M23 fallback: nếu key không có trong map → dùng FC raw.
   */
  async getEffectiveDemand(weekStart: string): Promise<Map<string, number>> {
    // C2 fix: normalize weekStart to Monday — period_date in DB is always Monday
    // (guaranteed by _doSubmit). A non-Monday input would silently return empty.
    const monday = mondayOfStr(new Date(weekStart));
    const rows = await this.dataSource.query<{ cn_id: string; sku_id: string; adjusted_qty: number }[]>(`
      SELECT cn_id, sku_id, adjusted_qty
      FROM cn_demand_adjustment
      WHERE period_date = $1
        AND status = ANY($2::text[])
    `, [monday, ACTIVE_STATUSES]);

    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(`${r.cn_id}|${r.sku_id}`, Number(r.adjusted_qty));
    }
    return map;
  }

  // ── Reason codes (FE dropdown) ────────────────────────────────────────────

  async getReasonCodes(): Promise<ReasonCode[]> {
    return this.reasonRepo.find({ where: { isActive: true }, order: { code: 'ASC' } });
  }

  // ── Expire PENDING after cutoff (cron 18:05) ─────────────────────────────

  async expirePendingCutoff(): Promise<{ expired: number }> {
    // C1 fix: use VN date (UTC+7) — cron fires 18:05 VN = 11:05 UTC, but defensive
    // against delays that could cross the UTC day boundary (17:00 UTC = 00:00 VN next day).
    // period_date stores Monday of week; normalize today's VN date to its Monday.
    const vnToday = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const vnMonday = mondayOfStr(vnToday);
    const result = await this.dataSource.query<{ id: string; cn_id: string; sku_id: string }[]>(`
      UPDATE cn_demand_adjustment
      SET status = 'EXPIRED'
      WHERE status = 'PENDING'
        AND period_date = $1
      RETURNING id, cn_id, sku_id
    `, [vnMonday]);

    for (const row of result) {
      await this._audit(
        { id: row.id, cnId: row.cn_id, skuId: row.sku_id } as CnDemandAdjustment,
        'EXPIRE', 'PENDING', 'EXPIRED', 'system:cron', null,
      );
    }

    return { expired: result.length };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _doSubmit(
    dto: SubmitAdjustmentDto,
    force: boolean,
  ): Promise<CnDemandAdjustment> {
    // Validate reason code exists
    const rc = await this.reasonRepo.findOne({ where: { code: dto.reasonCode, isActive: true } });
    if (!rc) throw new BadRequestException(`reason_code không hợp lệ: ${dto.reasonCode}`);

    // Normalize period_date to Monday
    const periodDate = mondayOfStr(new Date(dto.periodDate));

    // Compute delta
    const delta = dto.fcQty > 0
      ? ((dto.adjustedQty - dto.fcQty) / dto.fcQty) * 100
      : 0;

    // Get trust score for this CN
    const trust = await this.trustScoreSvc.getForCn(dto.cnId);
    const trustScore = trust?.score ?? 100;

    // Compute effective tolerance (R8: trust < 60 → 15%)
    const baseTolerance = await this._getTolerance();
    const effectiveTolerance = trustScore < 60 ? 15 : baseTolerance;
    const withinTolerance = Math.abs(delta) <= effectiveTolerance;

    // M4: reason_text mandatory khi vượt tolerance
    if (!withinTolerance && (!dto.reasonText || dto.reasonText.trim().length === 0)) {
      throw new BadRequestException(
        `reason_text bắt buộc khi vượt tolerance ±${effectiveTolerance}% (delta hiện tại: ${delta.toFixed(1)}%)`,
      );
    }

    // Determine status
    const autoApproveThreshold = await this._getAutoApproveThreshold();
    let status: AdjustStatus;
    if (force) {
      status = 'FORCE_APPROVED';
    } else if (withinTolerance && trustScore >= autoApproveThreshold) {
      status = 'AUTO_APPROVED';
    } else {
      status = 'PENDING';
    }

    // Transaction: expire old → insert new (R6)
    const saved = await this.dataSource.transaction(async (em) => {
      // Step 1: expire existing ACTIVE rows for same (cn × sku × week)
      await em.query(`
        UPDATE cn_demand_adjustment
        SET status = 'EXPIRED'
        WHERE cn_id = $1 AND sku_id = $2 AND period_date = $3
          AND status IN ('PENDING','AUTO_APPROVED','APPROVED','FORCE_APPROVED')
      `, [dto.cnId, dto.skuId, periodDate]);

      // Step 2: insert new row
      const adj = em.create(CnDemandAdjustment, {
        cnId:        dto.cnId,
        skuId:       dto.skuId,
        periodDate,
        fcQty:       dto.fcQty,
        adjustedQty: dto.adjustedQty,
        deltaPct:    Math.round(delta * 10000) / 10000,
        reasonCode:  dto.reasonCode,
        reasonText:  dto.reasonText ?? null,
        status,
        submittedBy: dto.submittedBy,
        submittedAt: new Date(),
      });
      return em.save(CnDemandAdjustment, adj);
    });

    // Audit log
    await this._audit(
      saved,
      force ? 'FORCE' : 'SUBMIT',
      null,
      status,
      dto.submittedBy,
      dto.reasonText ?? null,
    );

    return saved;
  }

  private async _requireAdj(id: string, allowedStatuses: AdjustStatus[]): Promise<CnDemandAdjustment> {
    const adj = await this.adjRepo.findOne({ where: { id } });
    if (!adj) throw new NotFoundException(`Adjustment không tìm thấy: ${id}`);
    if (!allowedStatuses.includes(adj.status)) {
      throw new BadRequestException(`Adjustment status '${adj.status}' không thể thực hiện action này`);
    }
    return adj;
  }

  private async _audit(
    adj: Pick<CnDemandAdjustment, 'id' | 'cnId' | 'skuId'>,
    action: CnAdjustAuditLog['action'],
    oldStatus: string | null,
    newStatus: string,
    actor: string,
    reasonText: string | null | undefined,
  ) {
    const log = this.auditRepo.create({
      adjustmentId: adj.id,
      cnId:         adj.cnId,
      skuId:        adj.skuId,
      action,
      oldStatus,
      newStatus,
      actor,
      reasonText:   reasonText ?? null,
    });
    await this.auditRepo.save(log);
  }

  private async _getCutoffTime(): Promise<string> {
    const rows = await this.dataSource.query<{ config_value: string }[]>(
      `SELECT config_value FROM system_config WHERE config_key = 'cn_adjust.cutoff_time' LIMIT 1`,
    );
    const raw = rows[0]?.config_value ?? '"18:00"';
    return raw.replace(/^"|"$/g, ''); // strip JSON string quotes if present
  }

  private async _getTolerance(): Promise<number> {
    const rows = await this.dataSource.query<{ config_value: string }[]>(
      `SELECT config_value FROM system_config WHERE config_key = 'cn_adjust.tolerance_pct' LIMIT 1`,
    );
    return rows.length > 0 ? Number(rows[0].config_value) : 30;
  }

  private async _getAutoApproveThreshold(): Promise<number> {
    const rows = await this.dataSource.query<{ config_value: string }[]>(
      `SELECT config_value FROM system_config WHERE config_key = 'trust.auto_approve_threshold_pct' LIMIT 1`,
    );
    return rows.length > 0 ? Number(rows[0].config_value) : 85;
  }
}
