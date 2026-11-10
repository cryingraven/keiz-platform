import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ReportExportQuery,
  ReportQuery,
  reportExportQuerySchema,
  reportQuerySchema,
} from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodBody } from '../common/zod-body';
import { ReportingExportService } from './reporting-export.service';
import { ReportingService } from './reporting.service';

@Controller('accounting')
export class ReportingController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly exporter: ReportingExportService,
  ) {}

  @Get('reports')
  reports(
    @CurrentUser() user: AuthUser,
    @Query(new ZodBody(reportQuerySchema)) query: ReportQuery,
  ) {
    return this.reporting.build(user.orgId, query);
  }

  @Get('reports/export')
  async export(
    @CurrentUser() user: AuthUser,
    @Query(new ZodBody(reportExportQuerySchema)) query: ReportExportQuery,
    @Res() res: Response,
  ) {
    const report = await this.reporting.build(user.orgId, query);
    const file = await this.exporter.export(report, query.format, query.report);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.buffer);
  }
}
