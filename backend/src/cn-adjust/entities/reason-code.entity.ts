import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('reason_code')
export class ReasonCode {
  @PrimaryColumn({ type: 'varchar', length: 50 })
  code: string;

  @Column({ name: 'label_vi', type: 'varchar', length: 200 })
  labelVi: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
