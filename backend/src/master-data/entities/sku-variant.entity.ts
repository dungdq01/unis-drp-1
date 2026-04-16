import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { Sku } from './sku.entity';

// C2 fix: composite unique (sku_id, variant_code) — không dùng unique: true trên column
@Entity('sku_variant')
@Unique(['skuId', 'variantCode'])
export class SkuVariant {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'sku_id', type: 'bigint' })
  skuId: string;

  @ManyToOne(() => Sku, (s) => s.variants)
  @JoinColumn({ name: 'sku_id' })
  sku: Sku;

  // KHÔNG có unique: true — composite unique defined above
  @Column({ name: 'variant_code', length: 60 })
  variantCode: string;

  @Column({ name: 'variant_suffix', length: 10 })
  variantSuffix: string;

  @Column({ name: 'variant_name', type: 'varchar', length: 200, nullable: true, default: null })
  variantName: string | null;

  @Column({ type: 'jsonb', nullable: true, default: null })
  attrs: Record<string, unknown> | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
