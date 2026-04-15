import { Controller, Post, UploadedFile, UseInterceptors, Body, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, IsNumber, IsOptional, Min, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BravoService } from './bravo.service';

class ManualEntryRow {
  @IsString()
  item_code: string;

  @IsString()
  location_code: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  on_hand_qty: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  reserved_qty?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  in_transit_qty?: number;

  @IsString()
  @IsOptional()
  source_type?: string;
}

class ManualEntryBody {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualEntryRow)
  rows: ManualEntryRow[];
}

@Controller('supply/bravo')
export class BravoController {
  constructor(private readonly bravoService: BravoService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new Error('No file uploaded');
    return this.bravoService.processUpload(file.buffer);
  }

  @Post('manual')
  manualEntry(@Body() body: ManualEntryBody) {
    if (!body.rows?.length) throw new BadRequestException('Rows array is empty');
    return this.bravoService.processManualRows(body.rows.map((r) => ({
      item_code: r.item_code,
      location_code: r.location_code,
      on_hand_qty: r.on_hand_qty,
      reserved_qty: r.reserved_qty ?? 0,
      in_transit_qty: r.in_transit_qty ?? 0,
      source_type: r.source_type ?? 'OEM',
    })));
  }
}
