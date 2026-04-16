import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeeklyKpiSnapshot } from './entities/weekly-kpi-snapshot.entity';
import { SsAdjustmentLog } from './entities/ss-adjustment-log.entity';
import { LtActualLog } from './entities/lt-actual-log.entity';
import { OverrideAnalysis } from './entities/override-analysis.entity';
import { FeedbackService } from './feedback.service';
import { SsAutoAdjustService } from './ss-auto-adjust.service';
import { LtAutoUpdateService } from './lt-auto-update.service';
import { TrustRefreshService } from './trust-refresh.service';
import { HonoringBackfillService } from './honoring-backfill.service';
import { OverrideAnalysisService } from './override-analysis.service';
import { KpiSnapshotService } from './kpi-snapshot.service';
import { DashboardService } from './dashboard.service';
import { FeedbackController } from './feedback.controller';
import { MasterDataModule } from '../master-data/master-data.module';
import { DrpModule } from '../drp/drp.module';
import { CnAdjustModule } from '../cn-adjust/cn-adjust.module';
import { NmAtpModule } from '../nm-atp/nm-atp.module';
import { PoReviewModule } from '../po-review/po-review.module';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WeeklyKpiSnapshot, SsAdjustmentLog, LtActualLog, OverrideAnalysis]),
    MasterDataModule,    // autoUpdateLt + updateTransitLt
    DrpModule,           // DrpSsCnService.preview() for SS formula
    CnAdjustModule,      // TrustScoreService.recalculateAll()
    NmAtpModule,         // HonoringRateService.recompute()
    PoReviewModule,      // getActualLtPerNmRoute() + getPoFulfillment()
    SystemConfigModule,  // feature flag + config values
  ],
  providers: [
    FeedbackService,
    SsAutoAdjustService,
    LtAutoUpdateService,
    TrustRefreshService,
    HonoringBackfillService,
    OverrideAnalysisService,
    KpiSnapshotService,
    DashboardService,
  ],
  controllers: [FeedbackController],
  exports: [FeedbackService],
})
export class FeedbackModule {}
