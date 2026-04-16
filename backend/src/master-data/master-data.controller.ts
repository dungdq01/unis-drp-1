import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  Injectable,
  CanActivate,
  ExecutionContext,
  Res,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { MasterDataService } from './master-data.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { FeatureFlag, FEATURE_FLAG_KEY } from './feature-flag.decorator';
import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { ChangeNmDto } from './dto/change-nm.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { LtOverrideDto } from './dto/lt-override.dto';
import { CreateHubDto, UpdateHubDto } from './dto/create-hub.dto';
import { AssignHubNmDto } from './dto/assign-hub-nm.dto';
import { UpsertSkuCnMappingDto, PatchSkuCnMappingDto, QuerySkuCnMappingDto } from './dto/upsert-sku-cn-mapping.dto';
import { SkuQueryDto, ChannelQueryDto, SupplierQueryDto, HubQueryDto } from './dto/query.dto';
import { AuditQueryDto } from './dto/audit-query.dto';

// ─── Feature Flag Guard (spec C4 pattern) ────────────────────────────────────
// Uses @FeatureFlag() decorator metadata + SystemConfigService.isEnabled() (DB-backed, TTL 30s).
// M10 compliant: reads from feature_flag table via SystemConfigService.

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Read @FeatureFlag('xxx') metadata from class or method handler
    const flagName = this.reflector.getAllAndOverride<string>(FEATURE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No decorator → guard is a no-op (allow)
    if (!flagName) return true;

    return this.systemConfigService.isEnabled(flagName);
  }
}

// ─── Controller ──────────────────────────────────────────────────────────────

@Controller('master-data')
@UseGuards(FeatureFlagGuard)
@FeatureFlag('m00_master_data_enabled')
export class MasterDataController {
  constructor(
    private readonly masterDataService: MasterDataService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  // ── SKU ────────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/master-data/skus
   * Create a new SKU with mandatory NM mapping and optional variants (atomic transaction).
   */
  @Post('skus')
  @HttpCode(HttpStatus.CREATED)
  createSku(
    @Body() dto: CreateSkuDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.createSku(dto, userId);
  }

  /**
   * GET /api/v1/master-data/skus
   */
  @Get('skus')
  listSkus(@Query() query: SkuQueryDto) {
    return this.masterDataService.listSkus(query);
  }

  /**
   * GET /api/v1/master-data/skus/:id
   * Returns SKU with nmCode, moq and active variants.
   */
  @Get('skus/:id')
  getSku(@Param('id') id: string) {
    return this.masterDataService.getSku(id);
  }

  /**
   * PATCH /api/v1/master-data/skus/:id
   */
  @Patch('skus/:id')
  updateSku(
    @Param('id') id: string,
    @Body() dto: UpdateSkuDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.updateSku(id, dto, userId);
  }

  /**
   * PATCH /api/v1/master-data/skus/:id/change-nm
   * Spec v1.1 M2 fix: dedicated endpoint for NM change with mandatory reason.
   * Deactivates old mapping and inserts new one for full audit trail.
   */
  @Patch('skus/:id/change-nm')
  changeSkuNm(
    @Param('id') id: string,
    @Body() dto: ChangeNmDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.changeSkuNm(id, dto, userId);
  }

  /**
   * DELETE /api/v1/master-data/skus/:id
   * Soft delete: sets active = false. Does NOT physically remove rows.
   */
  @Delete('skus/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivateSku(
    @Param('id') id: string,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.deactivateSku(id, userId);
  }

  // ── Channel (CN) ───────────────────────────────────────────────────────────

  /**
   * POST /api/v1/master-data/channels
   */
  @Post('channels')
  @HttpCode(HttpStatus.CREATED)
  createChannel(
    @Body() dto: CreateChannelDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.createChannel(dto, userId);
  }

  /**
   * GET /api/v1/master-data/channels
   */
  @Get('channels')
  listChannels(@Query() query: ChannelQueryDto) {
    return this.masterDataService.listChannels(query);
  }

  /**
   * GET /api/v1/master-data/channels/:id
   */
  @Get('channels/:id')
  getChannel(@Param('id') id: string) {
    return this.masterDataService.getChannel(id);
  }

  /**
   * PATCH /api/v1/master-data/channels/:id
   */
  @Patch('channels/:id')
  updateChannel(
    @Param('id') id: string,
    @Body() dto: UpdateChannelDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.updateChannel(id, dto, userId);
  }

  /**
   * DELETE /api/v1/master-data/channels/:id
   * Soft delete.
   */
  @Delete('channels/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivateChannel(
    @Param('id') id: string,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.deactivateChannel(id, userId);
  }

  // ── Supplier (NM) ─ read + update only (no UI create; import via CSV) ──────

  /**
   * GET /api/v1/master-data/suppliers
   */
  @Get('suppliers')
  listSuppliers(@Query() query: SupplierQueryDto) {
    return this.masterDataService.listSuppliers(query);
  }

  /**
   * GET /api/v1/master-data/suppliers/upload-template
   * Returns CSV template for NM bulk import.
   * M21 Sprint 3 DEPENDS on this — must remain stable.
   * NOTE: must be declared BEFORE /suppliers/:code to avoid route conflict.
   */
  @Get('suppliers/upload-template')
  getSupplierTemplate(@Res() res: Response) {
    const csv = this.masterDataService.getUploadTemplate('supplier');
    res
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="supplier_template.csv"')
      .send(csv);
  }

  /**
   * GET /api/v1/master-data/suppliers/:code
   * :code = supplier_code (NOT numeric id — supplier PK deviation)
   */
  @Get('suppliers/:code')
  getSupplier(@Param('code') code: string) {
    return this.masterDataService.getSupplier(code);
  }

  /**
   * PATCH /api/v1/master-data/suppliers/:code
   */
  @Patch('suppliers/:code')
  updateSupplier(
    @Param('code') code: string,
    @Body() dto: UpdateSupplierDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.updateSupplier(code, dto, userId);
  }

  /**
   * POST /api/v1/master-data/suppliers/:code/lt-override
   * Spec M2 fix: SC Manager escape hatch — force lead_time_days override.
   * Increments lt_drift_count, sets lt_drift_last_at, writes audit log with reason.
   */
  @Post('suppliers/:code/lt-override')
  @HttpCode(HttpStatus.OK)
  ltOverride(
    @Param('code') code: string,
    @Body() dto: LtOverrideDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.ltOverride(code, dto, userId);
  }

  // ── Hub ────────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/master-data/hubs
   */
  @Post('hubs')
  @HttpCode(HttpStatus.CREATED)
  createHub(
    @Body() dto: CreateHubDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.createHub(dto, userId);
  }

  /**
   * GET /api/v1/master-data/hubs
   */
  @Get('hubs')
  listHubs(@Query() query: HubQueryDto) {
    return this.masterDataService.listHubs(query);
  }

  /**
   * PATCH /api/v1/master-data/hubs/:id
   */
  @Patch('hubs/:id')
  updateHub(
    @Param('id') id: string,
    @Body() dto: UpdateHubDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.updateHub(id, dto, userId);
  }

  /**
   * POST /api/v1/master-data/hubs/:id/assign-nm
   * BUG-M00-01 fix: assign a supplier (NM) to a hub.
   * Populates nm_code (real FK for M13/M16 lookup) and nm_id=0 (placeholder).
   * M13 Hub Booking and M16 Hub Supply DEPEND on this endpoint.
   */
  @Post('hubs/:id/assign-nm')
  @HttpCode(HttpStatus.OK)
  assignHubNm(
    @Param('id') id: string,
    @Body() dto: AssignHubNmDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.assignHubNm(id, dto, userId);
  }

  // ── SKU-CN Mapping ──────────────────────────────────────────────────────────

  /**
   * POST /api/v1/master-data/sku-cn-mappings
   * UPSERT: creates or updates ss_override/z_override per (sku_id, cn_id).
   */
  @Post('sku-cn-mappings')
  @HttpCode(HttpStatus.OK)
  upsertSkuCnMapping(
    @Body() dto: UpsertSkuCnMappingDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.upsertSkuCnMapping(dto, userId);
  }

  /**
   * GET /api/v1/master-data/sku-cn-mappings
   */
  @Get('sku-cn-mappings')
  listSkuCnMappings(@Query() query: QuerySkuCnMappingDto) {
    return this.masterDataService.listSkuCnMappings(query);
  }

  /**
   * PATCH /api/v1/master-data/sku-cn-mappings/:id
   */
  @Patch('sku-cn-mappings/:id')
  patchSkuCnMapping(
    @Param('id') id: string,
    @Body() dto: PatchSkuCnMappingDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.patchSkuCnMapping(id, dto, userId);
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/master-data/import/:entityType
   * Bulk CSV import with optional dry-run mode.
   * M-02 fix: body must be sent as Content-Type: text/plain (raw CSV text).
   * NestJS will pass the raw string via @Body() when the route uses a text body parser.
   * Configure in main.ts: app.use('/api/v1/master-data/import', express.text({ type: 'text/plain' }))
   * Returns { total, valid, errors, imported }.
   */
  @Post('import/:entityType')
  @HttpCode(HttpStatus.OK)
  importCsv(
    @Param('entityType') entityType: string,
    @Body() body: string,
    @Query('dryRun') dryRun: string = 'false',
    @Headers('x-user-id') userId: string = 'system',
    @Headers('content-type') contentType: string = '',
  ) {
    if (!contentType.includes('text/')) {
      // Graceful: if JSON body parser ran, body may be an object — stringify back
      const csvText = typeof body === 'string' ? body : JSON.stringify(body);
      return this.masterDataService.importCsv(entityType, csvText, dryRun === 'true', userId);
    }
    return this.masterDataService.importCsv(entityType, body, dryRun === 'true', userId);
  }

  /**
   * GET /api/v1/master-data/import/:entityType/template
   * Returns CSV template file for download (any entity type).
   */
  @Get('import/:entityType/template')
  getTemplate(@Param('entityType') entityType: string, @Res() res: Response) {
    const csv = this.masterDataService.getUploadTemplate(entityType);
    res
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="${entityType}_template.csv"`)
      .send(csv);
  }

  // ── Audit Log ──────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/master-data/audit
   * Paginated audit log — filterable by entityType, entityId, action, changedBy.
   */
  @Get('audit')
  getAuditLog(@Query() query: AuditQueryDto) {
    return this.masterDataService.getAuditLog(query);
  }

  // ── Data Quality ───────────────────────────────────────────────────────────

  /**
   * GET /api/v1/master-data/quality
   */
  @Get('quality')
  getQualityMetrics() {
    return this.masterDataService.getQualityMetrics();
  }

  // ── Feature Flags (TD-02) ──────────────────────────────────────────────────

  /**
   * GET /api/v1/master-data/feature-flags
   * List all feature flags with current enabled state.
   * Used by admin UI to manage toggles without server restart (QA-18).
   */
  @Get('feature-flags')
  listFeatureFlags() {
    return this.systemConfigService.listFlags();
  }

  /**
   * PATCH /api/v1/master-data/feature-flags/:flagName
   * Toggle a feature flag on/off in DB.
   * Body: { enabled: boolean }
   */
  @Patch('feature-flags/:flagName')
  @HttpCode(HttpStatus.OK)
  setFeatureFlag(
    @Param('flagName') flagName: string,
    @Body() body: { enabled: boolean },
    @Headers('x-user-id') userId: string = 'admin',
  ) {
    return this.systemConfigService.updateFlag(flagName, body.enabled, userId);
  }

  // ── Customer ────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/master-data/customers
   */
  @Post('customers')
  @HttpCode(HttpStatus.CREATED)
  createCustomer(
    @Body() dto: import('./dto/create-customer.dto').CreateCustomerDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.createCustomer(dto, userId);
  }

  /**
   * GET /api/v1/master-data/customers
   */
  @Get('customers')
  listCustomers(@Query() query: import('./dto/query.dto').CustomerQueryDto) {
    return this.masterDataService.listCustomers(query);
  }

  /**
   * GET /api/v1/master-data/customers/:id
   */
  @Get('customers/:id')
  getCustomer(@Param('id') id: string) {
    return this.masterDataService.getCustomer(id);
  }

  /**
   * PATCH /api/v1/master-data/customers/:id
   */
  @Patch('customers/:id')
  updateCustomer(
    @Param('id') id: string,
    @Body() dto: import('./dto/update-customer.dto').UpdateCustomerDto,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.updateCustomer(id, dto, userId);
  }

  /**
   * DELETE /api/v1/master-data/customers/:id
   * Soft delete.
   */
  @Delete('customers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivateCustomer(
    @Param('id') id: string,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.deactivateCustomer(id, userId);
  }

  /**
   * POST /api/v1/master-data/customers/:id/channels
   * Link a channel (CN) to a customer. Body: { cnId, isPrimary? }
   */
  @Post('customers/:id/channels')
  @HttpCode(HttpStatus.OK)
  linkCustomerCn(
    @Param('id') customerId: string,
    @Body() body: { cnId: string; isPrimary?: boolean },
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.linkCustomerCn(customerId, body.cnId, body.isPrimary ?? false, userId);
  }

  /**
   * DELETE /api/v1/master-data/customers/:id/channels/:cnId
   * Unlink a channel from a customer (soft — sets active=false).
   */
  @Delete('customers/:id/channels/:cnId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unlinkCustomerCn(
    @Param('id') customerId: string,
    @Param('cnId') cnId: string,
    @Headers('x-user-id') userId: string = 'system',
  ) {
    return this.masterDataService.unlinkCustomerCn(customerId, cnId, userId);
  }
}
