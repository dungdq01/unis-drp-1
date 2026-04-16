import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, MinLength, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class SubmitAdjustmentDto {
  @IsString() @IsNotEmpty()
  cnId: string;

  @IsString() @IsNotEmpty()
  skuId: string;

  /**
   * Bất kỳ ngày nào trong tuần — service sẽ normalize về Monday.
   * Format: YYYY-MM-DD
   */
  @IsDateString()
  periodDate: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fcQty: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  adjustedQty: number;

  @IsString() @IsNotEmpty()
  reasonCode: string;

  /** Mandatory khi delta > tolerance hoặc force submit. Service validates. */
  @IsOptional()
  @IsString()
  reasonText?: string;

  @IsString() @IsNotEmpty()
  submittedBy: string;
}

export class ForceSubmitDto extends SubmitAdjustmentDto {
  /** Mandatory for force: min 20 chars. Validated at HTTP layer (M1 fix) + service layer. */
  @IsString()
  @IsNotEmpty()
  @MinLength(20, { message: 'Force override: reason_text phải ≥ 20 ký tự' })
  reasonText: string;
}

export class ReviewDto {
  @IsString() @IsNotEmpty()
  reviewedBy: string;

  @IsOptional()
  @IsString()
  reviewNote?: string;
}
