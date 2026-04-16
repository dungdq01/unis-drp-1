import { IsString, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * PATCH /skus/:id/change-nm
 * Dedicated endpoint (spec v1.1 M2 fix) — changing NM requires a mandatory reason
 * for full audit trail. Separate from general PATCH /skus/:id to make the intent explicit.
 */
export class ChangeNmDto {
  @IsString()
  @IsNotEmpty()
  nmCode: string;

  /** Mandatory reason — audited in master_data_audit_log.changed_fields.reason */
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  moq?: number;
}
