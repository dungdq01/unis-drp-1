import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
  Res,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { DataSyncService } from './data-sync.service';
import { FreshnessGateService } from './freshness-gate.service';
import { SyncHistoryQueryDto, OverrideDto } from './dto/sync-query.dto';

/**
 * M21 — Data Sync & Freshness Gate endpoints.
 * Prefix: /supply (extends existing supply domain, avoids new domain overhead).
 *
 * Routes added by M21 (all under /api/v1/supply/):
 *   POST  nm-upload/:nmCode         — NM CSV upload
 *   GET   sync/template/:nmCode     — download CSV template
 *   GET   sync/dashboard            — freshness per NM
 *   GET   freshness/gate            — gate check result (M23/M26 use this)
 *   POST  sync/trigger/:nmCode      — manual trigger 1 NM
 *   POST  sync/trigger-all          — manual trigger all active NMs
 *   GET   sync/history              — paginated sync_log
 *   POST  sync/override             — SC Manager force override (mandatory reason)
 */
@Controller('supply')
export class DataSyncController {
  constructor(
    private readonly dataSyncService: DataSyncService,
    private readonly freshnessGate: FreshnessGateService,
  ) {}

  // ── NM Upload ─────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/supply/nm-upload/:nmCode
   * NM uploads CSV per template. Validates header + rows, creates snapshot + sync_log.
   * US-4, US-5: header mismatch → 400 + link template.
   */
  @Post('nm-upload/:nmCode')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadNmCsv(
    @Param('nmCode') nmCode: string,
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-user-id') userId: string = 'nm-user',
  ) {
    if (!file) throw new BadRequestException('File CSV bắt buộc (field name: file)');
    return this.dataSyncService.uploadNmCsv(nmCode, file.buffer, userId);
  }

  // ── Template download ─────────────────────────────────────────────────────

  /**
   * GET /api/v1/supply/sync/template/:nmCode
   * Download pre-filled CSV template for this NM (SKU list of their products).
   * US-4: NM downloads template with their 50 SKUs pre-filled.
   */
  @Get('sync/template/:nmCode')
  async downloadTemplate(@Param('nmCode') nmCode: string, @Res() res: Response) {
    const { csv, filename } = await this.dataSyncService.generateTemplate(nmCode);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\ufeff' + csv); // BOM for Excel UTF-8 compatibility
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/supply/sync/dashboard
   * List all active NMs with freshness status.
   * US-6: SC Manager sees table NM × last_sync × age × badge.
   */
  @Get('sync/dashboard')
  getDashboard() {
    return this.dataSyncService.getDashboard();
  }

  // ── Gate check (internal, also exposed for debugging) ─────────────────────

  /**
   * GET /api/v1/supply/freshness/gate
   * Returns gate check: canRun + which NMs are stale.
   * M23/M26 call FreshnessGateService directly (service injection), not via HTTP.
   * This endpoint is for FE dashboard + debugging.
   */
  @Get('freshness/gate')
  getGate() {
    return this.dataSyncService.gateCheck();
  }

  // ── Manual trigger ────────────────────────────────────────────────────────

  /**
   * POST /api/v1/supply/sync/trigger/:nmCode
   *
   * **Ghi chú quan trọng cho FE1:**
   * Endpoint này KHÔNG tự pull data từ NM. Nó chỉ tạo một sync_log row
   * để ghi nhận rằng SC Manager đã "request" NM sync.
   *
   * Flow đúng:
   *   1. NM tải template: GET /supply/sync/template/:nmCode
   *   2. NM điền qty → upload: POST /supply/nm-upload/:nmCode  ← data thực sự vào đây
   *   3. SC Manager nhắc NM upload (out-of-band: Zalo/email/phone)
   *   4. SC Manager có thể click trigger để ghi log rằng đã nhắc
   *
   * Response: sync_log row với rowsImported=0, status=SUCCESS,
   * errorMsg="Manual trigger — no file upload. Use POST /supply/nm-upload/:nmCode"
   *
   * Để import data thực sự: dùng POST /supply/nm-upload/:nmCode với file CSV.
   */
  @Post('sync/trigger/:nmCode')
  @HttpCode(HttpStatus.OK)
  triggerOne(
    @Param('nmCode') nmCode: string,
    @Headers('x-user-id') userId: string = 'admin',
  ) {
    return this.dataSyncService.triggerSyncOne(nmCode, userId);
  }

  /**
   * POST /api/v1/supply/sync/trigger-all
   *
   * Tạo sync_log cho tất cả NM active — KHÔNG pull data tự động.
   * Dùng để ghi nhận "cron ping" hoặc SC Manager nhắc tất cả NM upload.
   * Actual data import: mỗi NM phải POST /supply/nm-upload/:nmCode riêng.
   *
   * Cron 06:00 + 14:00 VN cũng gọi cùng method này (trigger_source=CRON_06/CRON_14).
   */
  @Post('sync/trigger-all')
  @HttpCode(HttpStatus.OK)
  triggerAll(@Headers('x-user-id') userId: string = 'admin') {
    return this.dataSyncService.runSyncAll('MANUAL', userId);
  }

  // ── Sync history ──────────────────────────────────────────────────────────

  /**
   * GET /api/v1/supply/sync/history?nmCode=&page=&pageSize=
   * Paginated sync_log history.
   */
  @Get('sync/history')
  getHistory(@Query() query: SyncHistoryQueryDto) {
    return this.dataSyncService.getHistory(query);
  }

  // ── Override ──────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/supply/sync/override
   * SC Manager force-runs DRP with stale data.
   * Body: { reason (min 20 chars), approvedBy, planRunId? }
   * US-3: audit log + stale snapshot recorded.
   */
  @Post('sync/override')
  @HttpCode(HttpStatus.CREATED)
  override(@Body() dto: OverrideDto) {
    return this.dataSyncService.override(dto);
  }
}
