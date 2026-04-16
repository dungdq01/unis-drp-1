import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { TransportPlan } from './entities/transport-plan.entity';
import { TransportTrip } from './entities/transport-trip.entity';
import { TransportTripLine } from './entities/transport-trip-line.entity';
import { TransportTripStop } from './entities/transport-trip-stop.entity';
import { TopUpSuggestion } from './entities/top-up-suggestion.entity';
import { Carrier } from './entities/carrier.entity';
import { TransportLane } from './entities/transport-lane.entity';
import { VehicleType } from './entities/vehicle-type.entity';
import { TransportService } from './transport.service';
import { TransportController } from './transport.controller';
import { TransportLotSizingService } from './transport.lot-sizing.service';
import { TransportMultiDropService } from './transport.multi-drop.service';
import { TransportTopUpService } from './transport.top-up.service';
import { AllocationModule } from '../allocation/allocation.module';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TransportPlan, TransportTrip, TransportTripLine, TransportTripStop,
      TopUpSuggestion, Carrier, TransportLane, VehicleType,
    ]),
    MulterModule.register({ limits: { fileSize: 50 * 1024 * 1024 } }),
    AllocationModule,     // M25 injects AllocationLcnbService.getAllocationResult()
    SystemConfigModule,   // FeatureFlagGuard dep
  ],
  providers: [
    TransportService,
    TransportLotSizingService,
    TransportMultiDropService,
    TransportTopUpService,
  ],
  controllers: [TransportController],
  exports: [TransportService, TransportLotSizingService, TransportTopUpService],
})
export class TransportModule {}
