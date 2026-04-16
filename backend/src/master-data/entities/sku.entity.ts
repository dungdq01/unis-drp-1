import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SkuVariant } from './sku-variant.entity';
import { SkuNmMapping } from './sku-nm-mapping.entity';
import { SkuCnMapping } from './sku-cn-mapping.entity';

@Entity('sku')
export class Sku {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'sku_code', length: 50, unique: true })
  skuCode: string;

  @Column({ name: 'sku_name', length: 200 })
  skuName: string;

  @Column({ length: 20, default: 'm2' })
  uom: string;

  @Column({ name: 'product_group', type: 'varchar', length: 50, nullable: true, default: null })
  productGroup: string | null;

  // C1 fix: bỏ nmId column — relationship qua sku_nm_mapping (single-source)
  @OneToMany(() => SkuNmMapping, (m) => m.sku)
  nmMappings: SkuNmMapping[];

  @OneToMany(() => SkuVariant, (v) => v.sku)
  variants: SkuVariant[];

  @OneToMany(() => SkuCnMapping, (c) => c.sku)
  cnMappings: SkuCnMapping[];

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true, default: null })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'varchar', length: 100, nullable: true, default: null })
  updatedBy: string | null;
}
