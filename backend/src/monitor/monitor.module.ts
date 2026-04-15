import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KpiSnapshot } from './entities/kpi-snapshot.entity';
import { Alert } from './entities/alert.entity';
import { MonitorService } from './monitor.service';
import { MonitorController } from './monitor.controller';

@Module({
  imports: [TypeOrmModule.forFeature([KpiSnapshot, Alert])],
  providers: [MonitorService],
  controllers: [MonitorController],
  exports: [MonitorService],
})
export class MonitorModule {}
