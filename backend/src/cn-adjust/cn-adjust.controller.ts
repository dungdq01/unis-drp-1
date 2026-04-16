import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { CnAdjustService } from './cn-adjust.service';
import { TrustScoreService } from './trust-score.service';
import { SubmitAdjustmentDto, ForceSubmitDto, ReviewDto } from './dto/submit-adjustment.dto';
import { AdjustHistoryQueryDto } from './dto/query-adjustment.dto';
import { FeatureFlag } from '../master-data/feature-flag.decorator';
import { FeatureFlagGuard } from '../master-data/master-data.controller';

/**
 * M22 — CN Demand Adjustment & Trust Score
 * Prefix: /cn-adjust
 *
 * Routes:
 *   POST   /cn-adjust                          CN submit adjustment
 *   GET    /cn-adjust/my                       CN view own adjustments
 *   GET    /cn-adjust/queue                    SC Manager PENDING queue
 *   PATCH  /cn-adjust/:id/approve              SC Manager approve
 *   PATCH  /cn-adjust/:id/reject               SC Manager reject
 *   POST   /cn-adjust/force                    SC Manager force submit (bypass cutoff)
 *   GET    /cn-adjust/history                  History all CNs (SC Manager)
 *   GET    /cn-adjust/trust                    Trust score per CN
 *   GET    /cn-adjust/effective-demand         M23 DRP internal demand (weekStart query param)
 *   GET    /cn-adjust/reason-codes             FE dropdown
 */
@Controller('cn-adjust')
@UseGuards(FeatureFlagGuard)
@FeatureFlag('m22_cn_demand_adjust_enabled')
export class CnAdjustController {
  constructor(
    private readonly cnAdjustSvc: CnAdjustService,
    private readonly trustScoreSvc: TrustScoreService,
  ) {}

  // ── CN submit ─────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/cn-adjust
   * CN Manager submit demand adjustment.
   * R4: Rejected automatically after cutoff 18:00 VN.
   * R2: Auto-approved if within tolerance AND trust ≥ 85%.
   * R3: Vượt tolerance → PENDING + mandatory reason_text.
   * US-1, US-2, US-3.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  submit(@Body() dto: SubmitAdjustmentDto) {
    return this.cnAdjustSvc.submitAdjustment(dto);
  }

  // ── Fixed routes before :id ───────────────────────────────────────────────

  /**
   * GET /api/v1/cn-adjust/reason-codes
   * Dropdown lookup for FE form (reason_code table — source of truth per M2 fix).
   */
  @Get('reason-codes')
  getReasonCodes() {
    return this.cnAdjustSvc.getReasonCodes();
  }

  /**
   * GET /api/v1/cn-adjust/my?cnId=&page=&pageSize=&periodStart=&periodEnd=
   * CN xem adjustment của mình. cnId từ query (Phase 1) / JWT (Phase 2).
   * US-5.
   */
  @Get('my')
  getMyAdjustments(
    @Query() query: AdjustHistoryQueryDto,
    @Headers('x-cn-code') cnCode?: string,
  ) {
    const cnId = query.cnId ?? cnCode;
    if (!cnId) {
      // M2 fix: explicit guard — prev code used `cnId!` which silently passed undefined
      // to TypeORM and either crashed on PG or returned all rows.
      throw new BadRequestException('cnId bắt buộc: truyền qua query ?cnId= hoặc header x-cn-code');
    }
    return this.cnAdjustSvc.getMyAdjustments(cnId, query);
  }

  /**
   * GET /api/v1/cn-adjust/queue
   * SC Manager review queue — chỉ PENDING rows.
   * US-2.
   */
  @Get('queue')
  getQueue() {
    return this.cnAdjustSvc.getQueue();
  }

  /**
   * GET /api/v1/cn-adjust/history?cnId=&periodStart=&periodEnd=&page=
   * History tất cả adjustments — SC Manager view.
   * US-5 (extended).
   */
  @Get('history')
  getHistory(@Query() query: AdjustHistoryQueryDto) {
    return this.cnAdjustSvc.getHistory(query);
  }

  /**
   * GET /api/v1/cn-adjust/trust
   * Trust score per CN — dashboard SC Manager.
   * US-6: badge green ≥85, yellow 60-84, red <60. Grace period = badge xám.
   */
  @Get('trust')
  getTrustScores() {
    return this.trustScoreSvc.getAll();
  }

  /**
   * GET /api/v1/cn-adjust/effective-demand?weekStart=YYYY-MM-DD
   * Internal endpoint for M23 DRP (also exposed for debugging).
   * M23 injects CnAdjustService directly — this endpoint is for FE/audit use.
   * Returns array of { cnId, skuId, adjustedQty } for active adjustments that week.
   * US-7.
   */
  @Get('effective-demand')
  async getEffectiveDemand(@Query('weekStart') weekStart: string) {
    const map = await this.cnAdjustSvc.getEffectiveDemand(weekStart);
    // Convert Map → array for JSON response
    return Array.from(map.entries()).map(([key, adjustedQty]) => {
      const [cnId, skuId] = key.split('|');
      return { cnId, skuId, adjustedQty };
    });
  }

  /**
   * POST /api/v1/cn-adjust/force
   * SC Manager force submit after cutoff. Mandatory reasonText ≥ 20 chars (M5 fix).
   * Creates FORCE_APPROVED adjustment. Audit logs action='FORCE'.
   * US-4.
   */
  @Post('force')
  @HttpCode(HttpStatus.CREATED)
  forceSubmit(
    @Body() dto: ForceSubmitDto,
    @Headers('x-user-id') userId: string = 'sc-manager',
  ) {
    return this.cnAdjustSvc.forceSubmit(dto, userId);
  }

  // ── Parameterized routes ──────────────────────────────────────────────────

  /**
   * PATCH /api/v1/cn-adjust/:id/approve
   * SC Manager approve a PENDING adjustment.
   * US-2: review queue flow.
   */
  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id') id: string, @Body() dto: ReviewDto) {
    return this.cnAdjustSvc.approve(id, dto);
  }

  /**
   * PATCH /api/v1/cn-adjust/:id/reject
   * SC Manager reject a PENDING adjustment.
   * CN Manager sees REJECTED in history with reviewNote.
   */
  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id') id: string, @Body() dto: ReviewDto) {
    return this.cnAdjustSvc.reject(id, dto);
  }
}
