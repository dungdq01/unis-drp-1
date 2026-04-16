import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reflector } from '@nestjs/core';
import { SystemConfigModule } from '../system-config/system-config.module';

import { Sku } from './entities/sku.entity';
import { SkuVariant } from './entities/sku-variant.entity';
import { Channel } from './entities/channel.entity';
import { Supplier } from './entities/supplier.entity';
import { Hub } from './entities/hub.entity';
// TODO Issue-6: Customer entity registered but no service methods / controller routes yet.
//       DoD item FE-7 "Customer CRUD pages" requires adding customerRepo + CRUD
//       to MasterDataService and routes to MasterDataController — Sprint 2 scope.
import { Customer } from './entities/customer.entity';
import { SkuNmMapping } from './entities/sku-nm-mapping.entity';
import { SkuCnMapping } from './entities/sku-cn-mapping.entity';
import { HubCnCluster } from './entities/hub-cn-cluster.entity';
import { HubNmAssignment } from './entities/hub-nm-assignment.entity';
import { CustomerCn } from './entities/customer-cn.entity';
import { MasterDataAuditLog } from './entities/master-data-audit-log.entity';

import { MasterDataService } from './master-data.service';
import { MasterDataController, FeatureFlagGuard } from './master-data.controller';

@Module({
  imports: [
    SystemConfigModule,
    TypeOrmModule.forFeature([
      Sku,
      SkuVariant,
      Channel,
      Supplier,
      Hub,
      Customer,
      SkuNmMapping,
      SkuCnMapping,
      HubCnCluster,
      HubNmAssignment,
      CustomerCn,
      MasterDataAuditLog,
    ]),
  ],
  providers: [MasterDataService, FeatureFlagGuard, Reflector],
  controllers: [MasterDataController],
  exports: [MasterDataService],
})
export class MasterDataModule {}
