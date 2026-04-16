import { IsString, IsOptional, IsEmail, IsIn } from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string | null;

  @IsOptional()
  @IsString()
  contactPhone?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(['B2B', 'B2C'])
  customerType?: 'B2B' | 'B2C';
}
