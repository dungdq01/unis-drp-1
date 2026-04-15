import {
  Controller, Get, Post, Query, Body, Res, HttpCode, HttpStatus,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { PlanActualService } from './plan-actual.service';
import { ComputeDto, ListComparisonQueryDto, UploadDatasetDto } from './dto';

@Controller('plan-actual')
export class PlanActualController {
  constructor(private readonly svc: PlanActualService) {}

  @Get('versions')
  listVersions() {
    return this.svc.listVersions();
  }

  @Post('compute')
  @HttpCode(HttpStatus.OK)
  compute(@Body() dto: ComputeDto) {
    return this.svc.computeComparison(dto);
  }

  @Get('summary')
  getSummary() {
    return this.svc.getSummary();
  }

  @Get('comparison')
  listComparisons(@Query() query: ListComparisonQueryDto) {
    return this.svc.listComparisons(query);
  }

  @Get('export')
  async exportCsv(@Query() query: ListComparisonQueryDto, @Res() res: Response) {
    const buf  = await this.svc.exportCsv(query);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="plan_actual_${date}.csv"`,
    });
    res.send(buf);
  }

  // ── Upload Dataset ──────────────────────────────────────────────────────────

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadDataset(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDatasetDto,
  ) {
    return this.svc.uploadDataset(file, dto);
  }

  @Get('uploads')
  listUploads(@Query('type') type?: string) {
    return this.svc.listUploads(type);
  }
}
