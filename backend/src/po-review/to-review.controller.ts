import {
  Controller, Get, Post, Patch,
  Param, Body, Query, Headers,
  HttpCode, HttpStatus, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PoReviewService } from './po-review.service';
import { PoTransitionService } from './po-transition.service';
import { PoTrackingService } from './po-tracking.service';
import { FeatureFlag } from '../master-data/feature-flag.decorator';
import { FeatureFlagGuard } from '../master-data/master-data.controller';

@ApiTags('to-review')
@Controller('po-review/to')
@UseGuards(FeatureFlagGuard)
@FeatureFlag('m27_po_rebuild_enabled')
export class ToReviewController {
  constructor(
    private readonly svc: PoReviewService,
    private readonly transitionSvc: PoTransitionService,
    private readonly trackingSvc: PoTrackingService,
  ) {}

  @Get()
  @ApiOperation({ summary: '[M27] List TO headers' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'donorCnId', required: false })
  @ApiQuery({ name: 'receiverCnId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  listTo(
    @Query('status') status?: string,
    @Query('donorCnId') donorCnId?: string,
    @Query('receiverCnId') receiverCnId?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.svc.listTo({ status, donorCnId, receiverCnId, page, limit });
  }

  @Get(':id')
  @ApiOperation({ summary: '[M27] TO detail + lines + edit log + tracking' })
  getToDetail(@Param('id') id: string) {
    return this.svc.getToDetail(id);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[M27] Confirm TO: DRAFT → CONFIRMED (R13 idempotency-key)' })
  confirmTo(
    @Param('id') id: string,
    @Headers('idempotency-key') idemKey?: string,
    @Headers('x-user-id') userId?: string,
  ) {
    return this.transitionSvc.transitionTo(id, {
      toStatus: 'CONFIRMED', idempotencyKey: idemKey, changedBy: userId,
    });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[M27] Cancel TO: DRAFT/CONFIRMED → CANCELLED (reason ≥ 20 chars)' })
  cancelTo(
    @Param('id') id: string,
    @Body() body: { cancelReason: string },
    @Headers('x-user-id') userId?: string,
  ) {
    return this.transitionSvc.transitionTo(id, {
      toStatus: 'CANCELLED', cancelReason: body.cancelReason, changedBy: userId,
    });
  }

  @Get(':id/tracking')
  @ApiOperation({ summary: '[M27] Get TO tracking' })
  getToTracking(@Param('id') id: string) {
    return this.trackingSvc.getToTracking(id);
  }

  @Patch(':id/tracking')
  @ApiOperation({ summary: '[M27] Update TO tracking fields (H2 fix)' })
  updateToTracking(
    @Param('id') id: string,
    @Body() body: { vehicleNo?: string; carrierCode?: string; containerNo?: string; donorShipDate?: string; actualEtaDate?: string },
    @Headers('x-user-id') userId?: string,
  ) {
    return this.trackingSvc.updateToTracking(id, { ...body, updatedBy: userId });
  }

  @Patch(':id/transition')
  @ApiOperation({ summary: '[M27] TO state transitions: SHIPPED/RECEIVED/CLOSED' })
  transitionTo(
    @Param('id') id: string,
    @Body() body: {
      toStatus: 'SHIPPED' | 'RECEIVED' | 'CLOSED';
      vehicleNo?: string; carrierCode?: string; containerNo?: string; shipDate?: string;
      actualReceivedQty?: number; receiveDate?: string; note?: string;
    },
    @Headers('x-user-id') userId?: string,
  ) {
    return this.transitionSvc.transitionTo(id, { ...body, changedBy: userId });
  }
}
