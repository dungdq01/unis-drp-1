import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AllocationRun } from './entities/allocation-run.entity';
import { AllocationResult } from './entities/allocation-result.entity';
import { AllocationRecommendation } from './entities/allocation-recommendation.entity';
import { AllocationService } from './allocation.service';
import { AllocationController } from './allocation.controller';
import { PolicyModule } from '../policy/policy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AllocationRun, AllocationResult, AllocationRecommendation]),
    PolicyModule,
  ],
  providers: [AllocationService],
  controllers: [AllocationController],
  exports: [AllocationService],
})
export class AllocationModule {}
