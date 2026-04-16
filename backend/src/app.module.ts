import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MasterDataModule } from './master-data/master-data.module';
import { DemandModule } from './demand/demand.module';
import { SupplyModule } from './supply/supply.module';
import { PolicyModule } from './policy/policy.module';
import { DrpModule } from './drp/drp.module';
import { AllocationModule } from './allocation/allocation.module';
import { TransportModule } from './transport/transport.module';
import { OrderModule } from './orders/order.module';
import { MonitorModule } from './monitor/monitor.module';
import { PlanActualModule } from './plan-actual/plan-actual.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { DataSyncModule } from './data-sync/data-sync.module';
import { CnAdjustModule } from './cn-adjust/cn-adjust.module';
import { NmAtpModule } from './nm-atp/nm-atp.module';
import { PoReviewModule } from './po-review/po-review.module';
import { FeedbackModule } from './feedback/feedback.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'unis_scp',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: false,
    }),
    MasterDataModule,
    DemandModule,
    SupplyModule,
    PolicyModule,
    DrpModule,
    AllocationModule,
    TransportModule,
    OrderModule,
    MonitorModule,
    PlanActualModule,
    SystemConfigModule,
    DataSyncModule,
    CnAdjustModule,
    NmAtpModule,
    PoReviewModule,
    FeedbackModule,
  ],
})
export class AppModule {}
