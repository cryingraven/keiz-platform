import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  CollectionQuoteInput,
  collectionQuoteSchema,
} from '@keiz/shared';
import { Public } from '../common/public.decorator';
import { ZodBody } from '../common/zod-body';
import { DocumentsService } from './documents.service';
import { PublicPaymentsService } from './public-payments.service';

@Controller('public/documents')
export class PublicDocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly payments: PublicPaymentsService,
  ) {}

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

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token/pay')
  payInfo(@Param('token') token: string) {
    return this.payments.info(token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':token/pay')
  createPayment(
    @Param('token') token: string,
    @Body(new ZodBody(collectionQuoteSchema)) body: CollectionQuoteInput,
  ) {
    return this.payments.quote(token, body);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token/pay/:quoteId')
  paymentStatus(
    @Param('token') token: string,
    @Param('quoteId') quoteId: string,
  ) {
    return this.payments.status(token, quoteId);
  }
}
