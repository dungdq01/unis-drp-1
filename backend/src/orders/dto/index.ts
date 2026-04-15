import { IsString, IsOptional, IsIn, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/pagination.dto';

// ── POST /orders/batches ───────────────────────────────────────────────────────
export class CreateOrderBatchDto {
  @IsString()
  transportPlanId: string;

  @IsOptional() @IsString()
  createdBy?: string;

  @IsOptional() @IsString()
  note?: string;
}

// ── GET /orders/batches ────────────────────────────────────────────────────────
export class ListBatchesQueryDto extends PaginationDto {
  @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'EXPORTED', 'CANCELLED'])
  status?: string;
}

// ── GET /orders/batches/:id/lines ──────────────────────────────────────────────
export class ListLinesQueryDto extends PaginationDto {
  @IsOptional() @IsString()
  itemCode?: string;

  @IsOptional() @IsString()
  sourceLocationCode?: string;

  @IsOptional() @IsString()
  destLocationCode?: string;

  @IsOptional() @IsIn(['ACTIVE', 'CANCELLED'])
  status?: string;

  @IsOptional() @IsIn(['TO', 'SO', 'PO'])
  orderType?: string;
}

// ── POST /orders/batches/:id/submit ───────────────────────────────────────────
export class SubmitBatchDto {
  @IsOptional() @IsString()
  submittedBy?: string;

  @IsOptional() @IsString()
  note?: string;
}

// ── POST /orders/batches/:id/approve ──────────────────────────────────────────
export class ApproveBatchDto {
  @IsOptional() @IsString()
  approvedBy?: string;

  @IsOptional() @IsString()
  note?: string;
}

// ── POST /orders/batches/:id/reject ───────────────────────────────────────────
export class RejectBatchDto {
  @IsOptional() @IsString()
  rejectedBy?: string;

  @IsString()
  rejectReason: string;
  // [BIZ] rejectReason bắt buộc — không cho phép reject không ghi lý do
}

// ── PATCH /orders/lines/:id ────────────────────────────────────────────────────
export class UpdateOrderLineDto {
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  unitPriceVnd?: number;

  @IsOptional() @IsString()
  erpRef?: string;

  @IsOptional() @IsString()
  note?: string;

  @IsOptional() @IsIn(['ACTIVE', 'CANCELLED'])
  status?: 'ACTIVE' | 'CANCELLED';
  // [BIZ] Cancel line chỉ khi batch.status IN (DRAFT, SUBMITTED)
}
