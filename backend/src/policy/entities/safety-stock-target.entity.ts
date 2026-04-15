import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { PolicyRun } from './policy-run.entity';

@Entity('safety_stock_target')
export class SafetyStockTarget {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'item_code', length: 50 })
  itemCode: string;

  @Column({ name: 'location_code', length: 20 })
  locationCode: string;

  @Column({ name: 'policy_run_id', type: 'bigint' })
  policyRunId: string;

  @ManyToOne(() => PolicyRun)
  @JoinColumn({ name: 'policy_run_id' })
  policyRun: PolicyRun;

  @Column({ name: 'abc_class', type: 'char', length: 1 })
  abcClass: 'A' | 'B' | 'C';

  @Column({ name: 'csl_target', type: 'decimal', precision: 5, scale: 4 })
  cslTarget: number;

  @Column({ name: 'z_score', type: 'decimal', precision: 5, scale: 3 })
  zScore: number;

  @Column({ name: 'lead_time_days' })
  leadTimeDays: number;

  @Column({ name: 'sigma_demand', type: 'decimal', precision: 15, scale: 4 })
  sigmaDemand: number;

  @Column({ name: 'sigma_lt', type: 'decimal', precision: 10, scale: 4 })
  sigmaLt: number;

  @Column({ type: 'decimal', precision: 15, scale: 4 })
  adu: number;

  @Column({ name: 'ss_formula', type: 'decimal', precision: 15, scale: 2 })
  ssFormula: number;

  @Column({ name: 'ss_dos_cap', type: 'decimal', precision: 15, scale: 2 })
  ssDosCap: number;

  @Column({ name: 'ss_final' })
  ssFinal: number;

  @Column({ name: 'dos_target' })
  dosTarget: number;

  @Column({ name: 'sigma_source', length: 20, default: 'fc_error' })
  sigmaSource: string;

  @Column({ name: 'lcnb_mode', length: 20, default: 'DETECT_ONLY' })
  lcnbMode: string;

  @Column({ name: 'lcnb_flag', default: false })
  lcnbFlag: boolean;

  @Column({ name: 'override_ss', type: 'int', nullable: true })
  overrideSs: number | null;

  @Column({ name: 'override_reason', type: 'text', nullable: true })
  overrideReason: string | null;

  @Column({ name: 'override_by', type: 'varchar', length: 100, nullable: true })
  overrideBy: string | null;

  @Column({ name: 'override_at', type: 'timestamp', nullable: true })
  overrideAt: Date | null;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  snapshotId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
