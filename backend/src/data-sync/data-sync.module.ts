import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncLog } from './entities/sync-log.entity';
import { DrpOverrideLog } from './entities/drp-override-log.entity';
import { SupplySnapshot } from '../supply/entities/supply-snapshot.entity';
import { FreshnessGateService } from './freshness-gate.service';
import { DataSyncService } from './data-sync.service';
import { DataSyncController } from './data-sync.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SyncLog, DrpOverrideLog, SupplySnapshot]),
  ],
  providers: [FreshnessGateService, DataSyncService],
  controllers: [DataSyncController],
  exports: [
    FreshnessGateService, // M23 DRP + M26 ATP inject this
    DataSyncService,
  ],
})
export class DataSyncModule {}
