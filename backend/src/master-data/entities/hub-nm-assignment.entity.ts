import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Hub ↔ Supplier assignment.
 * nm_id: placeholder 0 (supplier PK deviation — no BIGINT id, Sprint 2 migration).
 * nm_code: REAL reference → supplier.supplier_code.
 * M13 (Hub Booking) and M16 (Hub Supply) DEPEND on nm_code to resolve lead_time_days.
 */
@Entity('hub_nm_assignment')
export class HubNmAssignment {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'hub_id', type: 'bigint' })
  hubId: string;

  // BUG-M00-01 fix: nm_id = 0 placeholder, nm_code is the real supplier reference
  @Column({ name: 'nm_id', type: 'bigint', default: 0 })
  nmId: string;

  @Column({ name: 'nm_code', type: 'varchar', length: 30, nullable: true, default: null })
  nmCode: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
