import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PlanActualComparison } from './entities/plan-actual-comparison.entity';
import { PacUploadedDataset } from './entities/pac-uploaded-dataset.entity';
import { PacUploadedLine } from './entities/pac-uploaded-line.entity';
import { PlanActualService } from './plan-actual.service';
import { PlanActualController } from './plan-actual.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlanActualComparison, PacUploadedDataset, PacUploadedLine]),
    MulterModule.register({ storage: memoryStorage() }),
  ],
  providers: [PlanActualService],
  controllers: [PlanActualController],
  exports: [PlanActualService],
})
export class PlanActualModule {}
