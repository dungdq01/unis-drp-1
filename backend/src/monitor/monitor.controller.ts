import {
  Controller, Get, Post, Patch, Query, Param, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MonitorService } from './monitor.service';
import {
  ComputeKpiDto, ListKpiQueryDto, HstkQueryDto,
  ListAlertsQueryDto, AcknowledgeAlertDto,
} from './dto';

@ApiTags('monitor')
@Controller('monitor')
export class MonitorController {
  constructor(private readonly svc: MonitorService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard summary: alert counts + HSTK + batch metrics' })
  getStats() { return this.svc.getStats(); }

  @Post('kpi/compute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger KPI computation on-demand → saves kpi_snapshot + generates alerts' })
  computeKpi(@Body() dto: ComputeKpiDto) { return this.svc.computeKpi(dto); }

  @Get('kpi')
  @ApiOperation({ summary: 'List kpi_snapshot history (filter by group/code/location/item)' })
  listKpi(@Query() query: ListKpiQueryDto) { return this.svc.listKpiSnapshots(query); }

  @Get('hstk')
  @ApiOperation({ summary: 'HSTK per item × location (summary + filtered data)' })
  getHstk(@Query() query: HstkQueryDto) { return this.svc.getHstk(query); }

  @Get('execution')
  @ApiOperation({ summary: 'Execution metrics: overdue batches, approval SLA, cancel rate' })
  getExecution() { return this.svc.getExecutionMetrics(); }

  @Get('alerts')
  @ApiOperation({ summary: 'List alerts (filter by severity, type, acknowledged, location)' })
  listAlerts(@Query() query: ListAlertsQueryDto) { return this.svc.listAlerts(query); }

  @Patch('alerts/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge alert → is_acknowledged = true' })
  acknowledgeAlert(@Param('id') id: string, @Body() dto: AcknowledgeAlertDto) {
    return this.svc.acknowledgeAlert(id, dto);
  }
}
