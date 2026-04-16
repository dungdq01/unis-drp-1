import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Sku } from './sku.entity';
import { Channel } from './channel.entity';

@Entity('sku_cn_mapping')
export class SkuCnMapping {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'sku_id', type: 'bigint' })
  skuId: string;

  @ManyToOne(() => Sku, (s) => s.cnMappings)
  @JoinColumn({ name: 'sku_id' })
  sku: Sku;

  @Column({ name: 'cn_id', type: 'bigint' })
  cnId: string;

  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'cn_id' })
  channel: Channel;

  @Column({ name: 'ss_override', type: 'decimal', precision: 15, scale: 2, nullable: true })
  ssOverride: number | null;

  @Column({ name: 'z_override', type: 'decimal', precision: 5, scale: 4, nullable: true })
  zOverride: number | null;

  @Column({ name: 'is_critical', default: false })
  isCritical: boolean;

  @Column({ default: true })
  active: boolean;
}
