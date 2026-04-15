import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PolicyService } from './policy.service';
import {
  CreatePolicyRunDto, ImportAbcDto, GetSsTargetsQueryDto,
  OverrideSsDto, CreateRtmRouteDto, ActivatePolicyRunDto,
  GetAbcQueryDto, GetRtmQueryDto,
} from './dto';

@ApiTags('policy')
@Controller('policy')
export class PolicyController {
  constructor(private readonly svc: PolicyService) {}

  // ─── Policy Runs ────────────────────────────────────────────────────────

  @Post('runs')
  @ApiOperation({ summary: 'Create policy run + trigger SS calculation (202 async)' })
  createRun(@Body() dto: CreatePolicyRunDto) {
    return this.svc.createPolicyRun(dto);
  }

  @Get('runs')
  @ApiOperation({ summary: 'List 20 most recent policy runs' })
  listRuns() {
    return this.svc.listPolicyRuns();
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Get policy run details + progress' })
  getRun(@Param('id') id: string) {
    return this.svc.getPolicyRun(id);
  }

  @Patch('runs/:id/activate')
  @ApiOperation({ summary: 'Activate DRAFT policy run (archives current ACTIVE)' })
  activateRun(@Param('id') id: string, @Body() dto: ActivatePolicyRunDto) {
    return this.svc.activatePolicyRun(id, dto);
  }

  @Patch('runs/:id/archive')
  @ApiOperation({ summary: 'Archive a policy run manually' })
  archiveRun(@Param('id') id: string) {
    return this.svc.archivePolicyRun(id);
  }

  // ─── ABC Classification ────────────────────────────────────────────────

  @Post('abc/import')
  @ApiOperation({ summary: 'Import ABC from demand_snapshot_line.segment' })
  importAbc(@Body() dto: ImportAbcDto) {
    return this.svc.importAbcFromSnapshot(dto);
  }

  @Get('abc/classifications')
  @ApiOperation({ summary: 'Paginated ABC classifications' })
  getClassifications(@Query() query: GetAbcQueryDto) {
    return this.svc.getAbcClassifications(query);
  }

  @Get('abc/discrepancies')
  @ApiOperation({ summary: 'Items with discrepancy_flag = true' })
  getDiscrepancies(@Query('snapshotId') snapshotId: string) {
    return this.svc.getAbcDiscrepancies(snapshotId);
  }

  // ─── Safety Stock ──────────────────────────────────────────────────────

  @Get('safety-stock/targets')
  @ApiOperation({ summary: 'Paginated SS targets (default: ACTIVE policy run)' })
  getSsTargets(@Query() query: GetSsTargetsQueryDto) {
    return this.svc.getSsTargets(query);
  }

  @Get('safety-stock/summary')
  @ApiOperation({ summary: 'SS summary: avg by class, LCNB count, total combinations' })
  getSsSummary() {
    return this.svc.getSsSummary();
  }

  @Get('safety-stock/targets/:itemCode/:locationCode')
  @ApiOperation({ summary: 'SS target for 1 item × location + calculation_steps' })
  getSsTarget(
    @Param('itemCode') itemCode: string,
    @Param('locationCode') locationCode: string,
  ) {
    return this.svc.getSsTarget(itemCode, locationCode);
  }

  @Patch('safety-stock/targets/:itemCode/:locationCode/override')
  @ApiOperation({ summary: 'Override SS target (Planner manual adjustment)' })
  overrideSs(
    @Param('itemCode') itemCode: string,
    @Param('locationCode') locationCode: string,
    @Body() dto: OverrideSsDto,
  ) {
    return this.svc.overrideSsTarget(itemCode, locationCode, dto);
  }

  // ─── RTM Rules ────────────────────────────────────────────────────────

  @Get('rtm/routes')
  @ApiOperation({ summary: 'List RTM rules' })
  getRtmRoutes(@Query() query: GetRtmQueryDto) {
    return this.svc.getRtmRoutes(query);
  }

  @Post('rtm/routes')
  @ApiOperation({ summary: 'Create/add RTM rule' })
  createRtmRoute(@Body() dto: CreateRtmRouteDto) {
    return this.svc.createRtmRoute(dto);
  }

  @Delete('rtm/routes/:id')
  @ApiOperation({ summary: 'Deactivate RTM rule (set is_active=false)' })
  deactivateRtmRoute(@Param('id') id: string) {
    return this.svc.deactivateRtmRoute(id);
  }

  @Get('rtm/resolve/:itemCode/:branchCode')
  @ApiOperation({ summary: 'Resolve RTM for item × branch (uses ABC from ACTIVE run)' })
  resolveRtm(
    @Param('itemCode') itemCode: string,
    @Param('branchCode') branchCode: string,
  ) {
    return this.svc.resolveRtm(itemCode, branchCode);
  }
}
