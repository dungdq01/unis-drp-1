import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { TransportPlan } from './entities/transport-plan.entity';
import { TransportTrip } from './entities/transport-trip.entity';
import { TransportTripLine } from './entities/transport-trip-line.entity';
import { Carrier } from './entities/carrier.entity';
import { TransportLane } from './entities/transport-lane.entity';
import { VehicleType } from './entities/vehicle-type.entity';
import { TransportService } from './transport.service';
import { TransportController } from './transport.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TransportPlan, TransportTrip, TransportTripLine,
      Carrier, TransportLane, VehicleType,
    ]),
    MulterModule.register({ limits: { fileSize: 50 * 1024 * 1024 } }),
  ],
  providers: [TransportService],
  controllers: [TransportController],
  exports: [TransportService],
})
export class TransportModule {}
