import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
  ],
})
export class AppModule {}
