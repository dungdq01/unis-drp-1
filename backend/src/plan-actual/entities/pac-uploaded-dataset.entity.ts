import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany,
} from 'typeorm';
import { PacUploadedLine } from './pac-uploaded-line.entity';

@Entity('pac_uploaded_dataset')
export class PacUploadedDataset {
  @PrimaryGeneratedColumn('uuid', { name: 'dataset_id' })
  datasetId: string;

  @Column({ length: 100 })
  name: string;

  /** FORECAST or ACTUAL */
  @Column({ length: 20 })
  type: string;

  @Column({ name: 'row_count', default: 0 })
  rowCount: number;

  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true, default: null })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => PacUploadedLine, l => l.dataset)
  lines: PacUploadedLine[];
}
