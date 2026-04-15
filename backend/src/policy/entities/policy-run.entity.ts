import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('policy_run')
export class PolicyRun {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'run_name', length: 200 })
  runName: string;

  @Column({ length: 20, default: 'DRAFT' })
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

  @Column({ name: 'demand_snapshot_id', type: 'uuid' })
  demandSnapshotId: string;

  @Column({ name: 'total_combinations', default: 0 })
  totalCombinations: number;

  @Column({ name: 'combinations_done', default: 0 })
  combinationsDone: number;

  @Column({ name: 'activated_by', type: 'varchar', length: 100, nullable: true })
  activatedBy: string | null;

  @Column({ name: 'activated_at', type: 'timestamp', nullable: true })
  activatedAt: Date | null;

  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
