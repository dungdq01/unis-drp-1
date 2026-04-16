import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CnDemandAdjustment } from './entities/cn-demand-adjustment.entity';
import { TrustScore } from './entities/trust-score.entity';
import { ReasonCode } from './entities/reason-code.entity';
import { CnAdjustAuditLog } from './entities/cn-adjust-audit-log.entity';
import { TrustScoreService } from './trust-score.service';
import { CnAdjustService } from './cn-adjust.service';
import { CnAdjustController } from './cn-adjust.controller';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CnDemandAdjustment,
      TrustScore,
      ReasonCode,
      CnAdjustAuditLog,
    ]),
    SystemConfigModule,  // BUG-4: FeatureFlagGuard needs SystemConfigService
  ],
  providers: [TrustScoreService, CnAdjustService],
  controllers: [CnAdjustController],
  exports: [
    CnAdjustService,    // M23 DRP injects getEffectiveDemand()
    TrustScoreService,
  ],
})
export class CnAdjustModule {}
