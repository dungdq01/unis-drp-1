import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsOptional, IsBoolean, IsNumber, Min, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { SupplyService } from './supply.service';
import { GetLinesQueryDto } from './dto/get-lines-query.dto';

class CaptureSnapshotBody {
  @IsString()
  snapshotName: string;

  @IsOptional()
  @IsBoolean()
  includeInTransit?: boolean;

  @IsOptional()
  @IsBoolean()
  autoFreeze?: boolean;

  @IsOptional()
  @IsString()
  createdBy?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locationCodes?: string[];   // Phase B: filter locations khi capture
}

class FreezeBody {
  @IsOptional()
  @IsString()
  frozenBy?: string;
}

class AcknowledgeStaleBody {
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

class OverrideLineBody {
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  qty: number;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

@Controller('supply')
export class SupplyController {
  constructor(private readonly supplyService: SupplyService) {}

  /**
   * GET /api/v1/supply/freshness
   * Returns current freshness status from lot_attribute.
   */
  @Get('freshness')
  getFreshnessStatus() {
    return this.supplyService.getFreshnessStatus();
  }

  /**
   * GET /api/v1/supply/snapshots
   * List last 30 snapshots ordered DESC by capture_at.
   */
  @Get('snapshots')
  listSnapshots() {
    return this.supplyService.listSnapshots();
  }

  /**
   * POST /api/v1/supply/snapshots
   * Capture a new supply snapshot from lot_attribute.
   */
  @Post('snapshots')
  @HttpCode(HttpStatus.CREATED)
  captureSnapshot(@Body() body: CaptureSnapshotBody) {
    return this.supplyService.captureSnapshot({
      snapshotName: body.snapshotName,
      includeInTransit: body.includeInTransit,
      autoFreeze: body.autoFreeze,
      createdBy: body.createdBy,
      locationCodes: body.locationCodes,
    });
  }

  /**
   * GET /api/v1/supply/snapshots/:id
   * Get a single snapshot by ID.
   */
  @Get('snapshots/:id')
  getSnapshot(@Param('id') id: string) {
    return this.supplyService.getSnapshot(id);
  }

  /**
   * PATCH /api/v1/supply/snapshots/:id/freeze
   * Freeze a DRAFT snapshot.
   */
  @Patch('snapshots/:id/freeze')
  freezeSnapshot(@Param('id') id: string, @Body() body: FreezeBody) {
    return this.supplyService.freezeSnapshot(id, body.frozenBy);
  }

  /**
   * PATCH /api/v1/supply/snapshots/:id/acknowledge-stale
   * Acknowledge a STALE snapshot.
   */
  @Patch('snapshots/:id/acknowledge-stale')
  acknowledgeStale(@Param('id') id: string, @Body() body: AcknowledgeStaleBody) {
    return this.supplyService.acknowledgeStale(id, body.reason, body.userId);
  }

  /**
   * GET /api/v1/supply/snapshots/:id/lines
   * Get paginated lines for a snapshot with optional filters.
   */
  @Get('snapshots/:id/lines')
  getSnapshotLines(@Param('id') id: string, @Query() query: GetLinesQueryDto) {
    return this.supplyService.getSnapshotLines(id, query);
  }

  /**
   * GET /api/v1/supply/snapshots/:id/stats
   */
  @Get('snapshots/:id/stats')
  getSnapshotStats(@Param('id') id: string) {
    return this.supplyService.getSnapshotStats(id);
  }

  /**
   * GET /api/v1/supply/snapshots/:id/by-item
   * Paginated list of unique item_codes with aggregated qty totals.
   * Expand a row by calling /snapshots/:id/lines?itemCode=...
   */
  @Get('snapshots/:id/by-item')
  getByItem(
    @Param('id') id: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Query('itemCode') itemCode?: string,
  ) {
    return this.supplyService.getGroupedByItem(id, {
      page: parseInt(page, 10) || 1,
      pageSize: Math.min(parseInt(pageSize, 10) || 50, 200),
      itemCode,
    });
  }

  /**
   * GET /api/v1/supply/snapshots/:id/by-location
   * Paginated list of unique location_codes with aggregated qty totals.
   */
  @Get('snapshots/:id/by-location')
  getByLocation(
    @Param('id') id: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Query('locationCode') locationCode?: string,
  ) {
    return this.supplyService.getGroupedByLocation(id, {
      page: parseInt(page, 10) || 1,
      pageSize: Math.min(parseInt(pageSize, 10) || 50, 200),
      locationCode,
    });
  }

  /**
   * PATCH /api/v1/supply/lines/:lineId/override
   * Override the allocatable_qty on a snapshot line (DRAFT or FROZEN).
   */
  @Patch('snapshots/:id/archive')
  archiveSnapshot(
    @Param('id') id: string,
    @Body() body: { archivedBy?: string },
  ) {
    return this.supplyService.archiveSnapshot(id, body?.archivedBy);
  }

  @Patch('lines/:lineId/override')
  overrideLine(@Param('lineId') lineId: string, @Body() body: OverrideLineBody) {
    return this.supplyService.overrideLine(lineId, body.qty, body.reason, body.userId);
  }

  // ── BE-A3: GET /supply/meta/locations ──────────────────────────────────────

  @Get('meta/locations')
  getMetaLocations() {
    return this.supplyService.getMetaLocations();
  }

  // ── BE-A4: GET /supply/meta/items?locationCodes=HCM,HAN ───────────────────

  @Get('meta/items')
  getMetaItems(@Query('locationCodes') locationCodes?: string) {
    const codes = locationCodes ? locationCodes.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    return this.supplyService.getMetaItems(codes);
  }
}
