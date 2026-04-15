import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { LotAttribute } from './entities/lot-attribute.entity';
import { SupplySnapshot } from './entities/supply-snapshot.entity';
import { SupplySnapshotLine } from './entities/supply-snapshot-line.entity';
import { BravoService } from './bravo.service';
import { BravoController } from './bravo.controller';
import { SupplyService } from './supply.service';
import { SupplyController } from './supply.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([LotAttribute, SupplySnapshot, SupplySnapshotLine]),
    MulterModule.register({ limits: { fileSize: 50 * 1024 * 1024 } }), // 50 MB max
  ],
  controllers: [BravoController, SupplyController],
  providers: [BravoService, SupplyService],
  exports: [SupplyService],
})
export class SupplyModule {}
