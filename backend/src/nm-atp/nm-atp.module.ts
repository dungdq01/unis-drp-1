import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AtpRun } from './entities/atp-run.entity';
import { AtpCheck } from './entities/atp-check.entity';
import { NmHonoringRate } from './entities/nm-honoring-rate.entity';
import { NmAtpService } from './nm-atp.service';
import { NmAtpController } from './nm-atp.controller';
import { HonoringRateService } from './honoring-rate.service';
import { AtpClassificationService } from './atp-classification.service';
import { UrgencyRankingService } from './urgency-ranking.service';
import { HonoringRateService } from './honoring-rate.service';
import { AllocationModule } from '../allocation/allocation.module';
import { DataSyncModule } from '../data-sync/data-sync.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { PoReviewModule } from '../po-review/po-review.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AtpRun, AtpCheck, NmHonoringRate]),
    AllocationModule,                    // M24 getAllocationResult() + AllocationLcnbService
    DataSyncModule,                      // M21 FreshnessGateService.checkAll()
    SystemConfigModule,                  // feature flag + config
    forwardRef(() => PoReviewModule),    // H3 fix: AND correlation callback
  ],
  providers: [
    NmAtpService,
    AtpClassificationService,
    UrgencyRankingService,
    HonoringRateService,
  ],
  controllers: [NmAtpController],
  exports: [NmAtpService, HonoringRateService], // M27 injects getAtpResult(); M28 injects recompute()
})
export class NmAtpModule {}
