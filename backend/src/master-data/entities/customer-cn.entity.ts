import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('customer_cn')
export class CustomerCn {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'customer_id', type: 'bigint' })
  customerId: string;

  @Column({ name: 'cn_id', type: 'bigint' })
  cnId: string;

  @Column({ name: 'is_primary', default: false })
  isPrimary: boolean;

  @Column({ default: true })
  active: boolean;
}
