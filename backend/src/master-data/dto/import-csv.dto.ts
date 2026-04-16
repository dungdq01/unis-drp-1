import { IsString, IsOptional, IsBoolean, IsIn } from 'class-validator';

export class ImportCsvDto {
  @IsString()
  @IsIn(['sku', 'channel', 'supplier', 'hub', 'customer'])
  entityType: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsString()
  importedBy?: string;
}
