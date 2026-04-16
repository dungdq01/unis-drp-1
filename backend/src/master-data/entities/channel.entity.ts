import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('channel')
export class Channel {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'cn_code', length: 20, unique: true })
  cnCode: string;

  @Column({ name: 'cn_name', length: 200 })
  cnName: string;

  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  region: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 6 })
  lat: number;

  @Column({ type: 'decimal', precision: 10, scale: 6 })
  lng: number;

  @Column({ name: 'manager_user_id', type: 'bigint', nullable: true })
  managerUserId: string | null;

  @Column({ name: 'connectivity', length: 10, default: 'GOOD' })
  connectivity: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
