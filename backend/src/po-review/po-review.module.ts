import { Module, forwardRef } from '@nestjs/common';
import { PoReviewService } from './po-review.service';
import { PoEditService } from './po-edit.service';
import { PoTransitionService } from './po-transition.service';
import { PoOverdueService } from './po-overdue.service';
import { PoTrackingService } from './po-tracking.service';
import { PoReviewController } from './po-review.controller';
import { ToReviewController } from './to-review.controller';
import { TransportModule } from '../transport/transport.module';
import { NmAtpModule } from '../nm-atp/nm-atp.module';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    forwardRef(() => TransportModule),  // H3 fix: forwardRef breaks circular dep (M25 injects PoReviewService)
    forwardRef(() => NmAtpModule),      // H3 fix: forwardRef breaks circular dep (M26 injects PoReviewService)
    SystemConfigModule,
  ],
  controllers: [PoReviewController, ToReviewController],
  providers: [PoReviewService, PoEditService, PoTransitionService, PoOverdueService, PoTrackingService],
  exports: [PoReviewService],  // M28 injectable + M25/M26 event callbacks
})
export class PoReviewModule {}
