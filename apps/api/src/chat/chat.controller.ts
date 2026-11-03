import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { chatRequestSchema, ChatRequestInput } from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodBody } from '../common/zod-body';
import { ChatService } from './chat.service';
import { ChatStreamEvent } from './chat.types';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('threads')
  threads(@CurrentUser() user: AuthUser) {
    return this.chat.listThreads(user.orgId, user.sub);
  }

  @Get('threads/:id')
  thread(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.getThread(user.orgId, user.sub, id);
  }

  @Delete('threads/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.deleteThread(user.orgId, user.sub, id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('messages')
  async send(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(chatRequestSchema)) body: ChatRequestInput,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) abort.abort();
    };
    req.on('close', onClose);

    try {
      for await (const event of this.chat.streamEvents({
        orgId: user.orgId,
        userId: user.sub,
        accountId: user.accountId,
        message: body.message,
        threadId: body.threadId,
        abortSignal: abort.signal,
      })) {
        this.write(res, event);
      }
    } catch (error) {
      this.write(res, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Chat failed',
      });
    } finally {
      req.off('close', onClose);
      if (!res.writableEnded) res.end();
    }
  }

  private write(res: Response, event: ChatStreamEvent) {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
