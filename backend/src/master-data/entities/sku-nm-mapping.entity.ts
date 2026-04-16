import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Sku } from './sku.entity';

/**
 * C1 fix: Single-source of truth for SKU → NM relationship.
 * supplier PK deviation: supplier_code VARCHAR (not BIGSERIAL id).
 * nm_code VARCHAR is the real FK reference to supplier.supplier_code.
 * nm_id kept as nullable placeholder (0) for schema compat — not used for joins.
 */
@Entity('sku_nm_mapping')
export class SkuNmMapping {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'sku_id', type: 'bigint' })
  skuId: string;

  @ManyToOne(() => Sku, (s) => s.nmMappings)
  @JoinColumn({ name: 'sku_id' })
  sku: Sku;

  // nm_id: placeholder 0 — supplier has no BIGINT id (see supplier PK deviation)
  @Column({ name: 'nm_id', type: 'bigint', default: 0 })
  nmId: string;

  // nm_code: real reference to supplier.supplier_code
  @Column({ name: 'nm_code', type: 'varchar', length: 30, nullable: true, default: null })
  nmCode: string | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  moq: number;

  @Column({ type: 'int', default: 1 })
  priority: number;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
