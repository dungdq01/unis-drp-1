import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Maps to migration 003_demand_accuracy.sql.
 * One row per FSKU with actuals T10-T1, model/MA3 forecasts, and accuracy %.
 */
@Entity('demand_accuracy')
export class DemandAccuracy {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 50 })
  fsku: string;

  @Column({ name: 'actual_t10', type: 'decimal', precision: 15, scale: 2, nullable: true })
  actualT10?: number;

  @Column({ name: 'actual_t11', type: 'decimal', precision: 15, scale: 2, nullable: true })
  actualT11?: number;

  @Column({ name: 'actual_t12', type: 'decimal', precision: 15, scale: 2, nullable: true })
  actualT12?: number;

  @Column({ name: 'actual_t1', type: 'decimal', precision: 15, scale: 2, nullable: true })
  actualT1?: number;

  @Column({ name: 'final_fc_t12', type: 'decimal', precision: 15, scale: 2, nullable: true })
  finalFcT12?: number;

  @Column({ name: 'final_fc_t1', type: 'decimal', precision: 15, scale: 2, nullable: true })
  finalFcT1?: number;

  @Column({ name: 'final_fc_t2', type: 'decimal', precision: 15, scale: 2, nullable: true })
  finalFcT2?: number;

  @Column({ name: 'final_fc_t3', type: 'decimal', precision: 15, scale: 2, nullable: true })
  finalFcT3?: number;

  @Column({ name: 'ma3_fc_t12', type: 'decimal', precision: 15, scale: 2, nullable: true })
  ma3FcT12?: number;

  @Column({ name: 'ma3_fc_t1', type: 'decimal', precision: 15, scale: 2, nullable: true })
  ma3FcT1?: number;

  @Column({ name: 'acc_final_t12', type: 'decimal', precision: 5, scale: 2, nullable: true })
  accFinalT12?: number;

  @Column({ name: 'acc_ma3_t12', type: 'decimal', precision: 5, scale: 2, nullable: true })
  accMa3T12?: number;

  @Column({ name: 'acc_final_t1', type: 'decimal', precision: 5, scale: 2, nullable: true })
  accFinalT1?: number;

  @Column({ name: 'acc_ma3_t1', type: 'decimal', precision: 5, scale: 2, nullable: true })
  accMa3T1?: number;

  @Column({ name: 'wma_t10', type: 'decimal', precision: 15, scale: 2, nullable: true })
  wmaT10?: number;

  @Column({ name: 'wma_t11', type: 'decimal', precision: 15, scale: 2, nullable: true })
  wmaT11?: number;

  @Column({ name: 'acc_wma_t10', type: 'decimal', precision: 5, scale: 2, nullable: true })
  accWmaT10?: number;

  @Column({ name: 'acc_wma_t11', type: 'decimal', precision: 5, scale: 2, nullable: true })
  accWmaT11?: number;

  @Column({ name: 'is_modified', default: false })
  isModified: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
