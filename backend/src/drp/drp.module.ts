import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DrpController } from './drp.controller';
import { DrpService } from './drp.service';
import { PlanRun } from './entities/plan-run.entity';
import { PlannedOrderRelease } from './entities/planned-order-release.entity';
import { DrpException } from './entities/drp-exception.entity';
import { PolicyRun } from './entities/policy-run.entity';
import { SsCn } from './entities/ss-cn.entity';
import { DrpCnLine } from './entities/drp-cn-line.entity';
import { DrpPolicyRunService } from './drp.policy-run.service';
import { DrpSsCnService } from './drp.ss-cn.service';
import { DrpVariantSuggestionService } from './drp.variant-suggestion.service';
import { DrpNettingV2Service } from './drp.netting-v2.service';
import { DataSyncModule } from '../data-sync/data-sync.module';
import { CnAdjustModule } from '../cn-adjust/cn-adjust.module';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlanRun,
      PlannedOrderRelease,
      DrpException,
      PolicyRun,
      SsCn,
      DrpCnLine,
    ]),
    DataSyncModule,      // provides FreshnessGateService
    CnAdjustModule,      // provides CnAdjustService (getEffectiveDemand)
    SystemConfigModule,  // G11: feature flag gate
  ],
  controllers: [DrpController],
  providers: [
    DrpService,
    DrpPolicyRunService,
    DrpSsCnService,
    DrpVariantSuggestionService,
    DrpNettingV2Service,
  ],
  exports: [DrpService, DrpNettingV2Service],
})
export class DrpModule {}
