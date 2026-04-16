import { Controller, Get, Patch, Param, Query, Body, Headers } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { ListConfigQueryDto, UpdateConfigsDto, UpdateToggleDto, AuditQueryDto } from './dto';

@Controller('system-config')
export class SystemConfigController {
  constructor(private readonly svc: SystemConfigService) {}

  // GET /api/v1/system-config?group=PLANNING_CYCLE
  @Get()
  getAll(@Query() q: ListConfigQueryDto) {
    return this.svc.getAll(q.group);
  }

  // Fixed routes MUST be before :group param to avoid NestJS route collision

  // GET /api/v1/system-config/roles
  @Get('roles')
  getRoles() {
    return this.svc.getRoles();
  }

  // GET /api/v1/system-config/toggles
  @Get('toggles')
  getToggles() {
    return this.svc.getToggles();
  }

  // GET /api/v1/system-config/audit
  @Get('audit')
  getAudit(@Query() q: AuditQueryDto) {
    return this.svc.getAuditLog(q);
  }

  // GET /api/v1/system-config/flags
  @Get('flags')
  listFlags() {
    return this.svc.listFlags();
  }

  // PATCH /api/v1/system-config/flags/:flagKey
  @Patch('flags/:flagKey')
  updateFlag(
    @Param('flagKey') flagKey: string,
    @Body() body: { enabled: boolean },
    @Headers('x-user-id') userId = 'admin',
  ) {
    return this.svc.updateFlag(flagKey, body.enabled, userId);
  }

  // GET /api/v1/system-config/:group
  @Get(':group')
  getByGroup(@Param('group') group: string) {
    return this.svc.getByGroup(group.toUpperCase());
  }

  // PATCH /api/v1/system-config
  @Patch()
  updateConfigs(@Body() dto: UpdateConfigsDto) {
    return this.svc.updateConfigs(dto);
  }

  // PATCH /api/v1/system-config/toggles/:key
  @Patch('toggles/:key')
  updateToggle(@Param('key') key: string, @Body() dto: UpdateToggleDto) {
    return this.svc.updateToggle(key, dto);
  }
}
