import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DemandController } from './demand.controller';
import { DemandService } from './demand.service';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { AccuracyController } from './accuracy.controller';
import { AccuracyService } from './accuracy.service';
import { DemandSnapshot } from './entities/demand-snapshot.entity';
import { DemandSnapshotLine } from './entities/demand-snapshot-line.entity';
import { DemandForecastDetail } from './entities/demand-forecast-detail.entity';
import { DemandOverrideLog } from './entities/demand-override-log.entity';
import { DemandAccuracy } from './entities/demand-accuracy.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DemandSnapshot,
      DemandSnapshotLine,
      DemandForecastDetail,
      DemandOverrideLog,
      DemandAccuracy,
    ]),
  ],
  controllers: [DemandController, InsightsController, AccuracyController],
  providers: [DemandService, InsightsService, AccuracyService],
  exports: [DemandService, InsightsService, AccuracyService],
})
export class DemandModule {}
