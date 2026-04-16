import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('customer')
export class Customer {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'customer_code', length: 50, unique: true })
  customerCode: string;

  @Column({ name: 'customer_name', length: 200 })
  customerName: string;

  @Column({ name: 'contact_email', type: 'varchar', length: 200, nullable: true, default: null })
  contactEmail: string | null;

  @Column({ name: 'contact_phone', type: 'varchar', length: 20, nullable: true, default: null })
  contactPhone: string | null;

  @Column({ name: 'customer_type', length: 20, default: 'B2B' })
  customerType: 'B2B' | 'B2C';

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
