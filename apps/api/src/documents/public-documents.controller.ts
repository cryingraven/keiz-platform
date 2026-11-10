import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/public.decorator';
import { DocumentsService } from './documents.service';

@Controller('public/documents')
export class PublicDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  get(@Param('token') token: string) {
    return this.documents.publicDocument(token);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':token/pdf')
  async pdf(@Param('token') token: string, @Res() res: Response) {
    const file = await this.documents.publicPdf(token);
    const buffer = await this.documents.renderPdf(file.document);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }
}
