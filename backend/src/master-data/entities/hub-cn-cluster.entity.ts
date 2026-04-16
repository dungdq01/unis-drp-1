import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('hub_cn_cluster')
export class HubCnCluster {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'hub_id', type: 'bigint' })
  hubId: string;

  @Column({ name: 'cn_id', type: 'bigint' })
  cnId: string;

  @Column({ default: true })
  active: boolean;
}
