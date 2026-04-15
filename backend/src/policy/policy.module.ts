import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { PolicyRun } from './entities/policy-run.entity';
import { ItemAbcClassification } from './entities/item-abc-classification.entity';
import { SafetyStockTarget } from './entities/safety-stock-target.entity';
import { RtmRule } from './entities/rtm-rule.entity';
import { ItemLocationConfig } from './entities/item-location-config.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PolicyRun,
      ItemAbcClassification,
      SafetyStockTarget,
      RtmRule,
      ItemLocationConfig,
    ]),
  ],
  controllers: [PolicyController],
  providers: [PolicyService],
  exports: [PolicyService],
})
export class PolicyModule {}
