import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AllocationRun } from './entities/allocation-run.entity';
import { AllocationResult } from './entities/allocation-result.entity';
import { AllocationLeg } from './entities/allocation-leg.entity';
import { AllocationRecommendation } from './entities/allocation-recommendation.entity';
import { AllocationService } from './allocation.service';
import { AllocationController } from './allocation.controller';
import { AllocationLcnbService } from './allocation.lcnb.service';
import { AllocationFairShareService } from './allocation.fair-share.service';
import { AllocationVariantMatchService } from './allocation.variant-match.service';
import { PolicyModule } from '../policy/policy.module';
import { DrpModule } from '../drp/drp.module';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AllocationRun, AllocationResult, AllocationLeg, AllocationRecommendation]),
    PolicyModule,
    DrpModule,            // M24 injects DrpNettingV2Service.getDrpResult()
    SystemConfigModule,   // BUG-M24-4: FeatureFlagGuard dep (SystemConfigService.isEnabled)
  ],
  providers: [
    AllocationService,
    AllocationLcnbService,
    AllocationFairShareService,
    AllocationVariantMatchService,
  ],
  controllers: [AllocationController],
  exports: [AllocationService, AllocationLcnbService],
})
export class AllocationModule {}
