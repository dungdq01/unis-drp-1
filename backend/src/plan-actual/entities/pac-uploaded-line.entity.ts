import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { PacUploadedDataset } from './pac-uploaded-dataset.entity';

@Entity('pac_uploaded_line')
@Index(['datasetId', 'itemCode', 'locationCode', 'periodStart'])
export class PacUploadedLine {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'dataset_id', type: 'uuid' })
  datasetId: string;

  @ManyToOne(() => PacUploadedDataset, d => d.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dataset_id' })
  dataset: PacUploadedDataset;

  @Column({ name: 'item_code', length: 50 })
  itemCode: string;

  @Column({ name: 'location_code', length: 50 })
  locationCode: string;

  /** YYYY-MM-01 */
  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ type: 'numeric', precision: 14, scale: 4 })
  qty: number;
}
