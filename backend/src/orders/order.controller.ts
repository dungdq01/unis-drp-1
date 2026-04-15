import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, Res, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrderService } from './order.service';
import {
  CreateOrderBatchDto, ListBatchesQueryDto, ListLinesQueryDto,
  SubmitBatchDto, ApproveBatchDto, RejectBatchDto, UpdateOrderLineDto,
} from './dto';

@ApiTags('orders')
@Controller('orders')
export class OrderController {
  constructor(private readonly svc: OrderService) {}

  // ── Stats (dashboard KPI) ────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Tổng quan order batches (KPI dashboard)' })
  getStats() { return this.svc.getStats(); }

  // ── Batches ───────────────────────────────────────────────────────────────

  @Post('batches')
  @ApiOperation({ summary: 'Generate order batch từ transport_plan_id (CONFIRMED)' })
  createBatch(@Body() dto: CreateOrderBatchDto) {
    return this.svc.createBatch(dto);
  }

  @Get('batches')
  @ApiOperation({ summary: 'List order batches (paginated, filter by status)' })
  listBatches(@Query() query: ListBatchesQueryDto) {
    return this.svc.listBatches(query);
  }

  @Get('batches/:id')
  @ApiOperation({ summary: 'Get order batch detail' })
  getBatch(@Param('id') id: string) {
    return this.svc.getBatch(id);
  }

  // ── Approval flow ─────────────────────────────────────────────────────────

  @Post('batches/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit batch: DRAFT → SUBMITTED' })
  submitBatch(@Param('id') id: string, @Body() dto: SubmitBatchDto) {
    return this.svc.submitBatch(id, dto);
  }

  @Post('batches/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve batch: SUBMITTED → APPROVED' })
  approveBatch(@Param('id') id: string, @Body() dto: ApproveBatchDto) {
    return this.svc.approveBatch(id, dto);
  }

  @Post('batches/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject batch: SUBMITTED → DRAFT (kèm lý do bắt buộc)' })
  rejectBatch(@Param('id') id: string, @Body() dto: RejectBatchDto) {
    return this.svc.rejectBatch(id, dto);
  }

  @Delete('batches/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel batch (không thể cancel sau EXPORTED)' })
  cancelBatch(
    @Param('id') id: string,
    @Query('cancelledBy') cancelledBy?: string,
  ) {
    return this.svc.cancelBatch(id, cancelledBy);
  }

  // ── Lines ─────────────────────────────────────────────────────────────────

  @Get('batches/:id/lines')
  @ApiOperation({ summary: 'List order lines (paginated, filter item/location/status)' })
  listLines(@Param('id') id: string, @Query() query: ListLinesQueryDto) {
    return this.svc.listLines(id, query);
  }

  @Patch('lines/:id')
  @ApiOperation({ summary: 'Update order line: unit_price, erp_ref, note, cancel' })
  updateLine(@Param('id') id: string, @Body() dto: UpdateOrderLineDto) {
    return this.svc.updateLine(id, dto);
  }

  // ── Export CSV ────────────────────────────────────────────────────────────

  @Post('batches/:id/export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export batch → CSV (APPROVED → EXPORTED)' })
  async exportCsv(
    @Param('id') id: string,
    @Query('exportedBy') exportedBy: string | undefined,
    @Res() res: Response,
  ) {
    const { filename, content } = await this.svc.exportCsv(id, exportedBy);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  }
}
