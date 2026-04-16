import { IsInt, IsString, IsNotEmpty, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * POST /suppliers/:code/lt-override
 * SC Manager escape hatch — force-override lead_time_days for a supplier.
 * Spec M2 fix: requires mandatory reason; increments lt_drift_count; sets lt_drift_last_at.
 * Override is audited as action='UPDATE' with changedFields.reason.
 */
export class LtOverrideDto {
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  ltDays: number;

  /** Mandatory reason for the override — stored in audit log */
  @IsString()
  @IsNotEmpty()
  reason: string;
}
