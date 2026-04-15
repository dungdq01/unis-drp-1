import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DrpController } from './drp.controller';
import { DrpService } from './drp.service';
import { PlanRun } from './entities/plan-run.entity';
import { PlannedOrderRelease } from './entities/planned-order-release.entity';
import { DrpException } from './entities/drp-exception.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlanRun, PlannedOrderRelease, DrpException]),
  ],
  controllers: [DrpController],
  providers: [DrpService],
  exports: [DrpService],
})
export class DrpModule {}
