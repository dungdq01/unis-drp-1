import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('hub')
export class Hub {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'hub_code', length: 30, unique: true })
  hubCode: string;

  @Column({ name: 'hub_name', length: 200 })
  hubName: string;

  @Column({ name: 'hub_type', length: 10, default: 'VIRTUAL' })
  hubType: 'VIRTUAL' | 'PHYSICAL';

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  lat: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  lng: number | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  capacity: number | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
