import {
  Controller, Post, Get, Patch, Param, Body, Query,
  HttpCode, HttpStatus, ParseIntPipe,
} from '@nestjs/common';
import { AllocationService } from './allocation.service';
import {
  CreateAllocationRunDto, GetResultsQueryDto,
  GetRecommendationsQueryDto, DecideRecommendationDto,
} from './dto';

@Controller('allocation')
export class AllocationController {
  constructor(private readonly allocationService: AllocationService) {}

  /** POST /api/v1/allocation/run — async fire-and-forget (202) */
  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  createRun(@Body() dto: CreateAllocationRunDto) {
    return this.allocationService.createRun(dto);
  }

  /** GET /api/v1/allocation/runs */
  @Get('runs')
  listRuns(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 20,
  ) {
    return this.allocationService.listRuns(page, pageSize);
  }

  /** GET /api/v1/allocation/runs/:id */
  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    return this.allocationService.getRun(id);
  }

  /** GET /api/v1/allocation/runs/:id/summary */
  @Get('runs/:id/summary')
  getSummary(@Param('id') id: string) {
    return this.allocationService.getSummary(id);
  }

  /** GET /api/v1/allocation/runs/:id/results */
  @Get('runs/:id/results')
  getResults(@Param('id') id: string, @Query() query: GetResultsQueryDto) {
    return this.allocationService.getResults(id, query);
  }

  /** GET /api/v1/allocation/runs/:id/recommendations */
  @Get('runs/:id/recommendations')
  getRecommendations(@Param('id') id: string, @Query() query: GetRecommendationsQueryDto) {
    return this.allocationService.getRecommendations(id, query);
  }

  /** PATCH /api/v1/allocation/recommendations/:id/decide */
  @Patch('recommendations/:id/decide')
  decideRecommendation(@Param('id') id: string, @Body() dto: DecideRecommendationDto) {
    return this.allocationService.decideRecommendation(id, dto);
  }
}
