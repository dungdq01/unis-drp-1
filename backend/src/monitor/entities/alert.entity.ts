import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('alert')
export class Alert {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'alert_type', type: 'varchar', length: 50 })
  alertType: string;

  @Column({ type: 'varchar', length: 10, default: 'WARNING' })
  severity: 'INFO' | 'WARNING' | 'CRITICAL';

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true, default: null })
  body: string | null;

  @Column({ name: 'item_code', type: 'varchar', length: 50, nullable: true, default: null })
  itemCode: string | null;

  @Column({ name: 'location_code', type: 'varchar', length: 20, nullable: true, default: null })
  locationCode: string | null;

  @Column({ name: 'ref_id', type: 'varchar', length: 100, nullable: true, default: null })
  refId: string | null;

  @Column({ name: 'ref_type', type: 'varchar', length: 50, nullable: true, default: null })
  refType: string | null;

  @Column({ name: 'channels_sent', type: 'varchar', length: 100, default: 'SYSTEM' })
  channelsSent: string;

  @Column({ name: 'is_acknowledged', type: 'boolean', default: false })
  isAcknowledged: boolean;

  @Column({ name: 'acknowledged_by', type: 'varchar', length: 100, nullable: true, default: null })
  acknowledgedBy: string | null;

  @Column({ name: 'acknowledged_at', type: 'timestamp', nullable: true, default: null })
  acknowledgedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
