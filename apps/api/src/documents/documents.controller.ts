import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  createDocumentShareSchema,
  CreateDocumentShareInput,
} from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { ZodBody } from '../common/zod-body';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get(':type/:id/pdf')
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const file = await this.documents.authenticatedPdf(user.orgId, type, id);
    const buffer = await this.documents.renderPdf(file.document);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }

  @Get(':type/:id/share')
  shareMeta(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return this.documents.getShareMeta(user.orgId, type, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles('APPROVER', 'ADMIN', 'OWNER')
  @Post(':type/:id/share')
  createShare(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Body(new ZodBody(createDocumentShareSchema))
    body: CreateDocumentShareInput,
  ) {
    return this.documents.createShare(
      user.orgId,
      user.sub,
      type,
      id,
      body.expiresInDays,
    );
  }

  @Roles('APPROVER', 'ADMIN', 'OWNER')
  @Delete(':type/:id/share')
  revokeShare(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return this.documents.revokeShare(user.orgId, type, id);
  }
}
