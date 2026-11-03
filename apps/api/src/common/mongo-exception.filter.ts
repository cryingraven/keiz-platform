import { ArgumentsHost, Catch, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

/**
 * Maps database errors to safe HTTP responses instead of leaking a 500 with a
 * Mongoose stack. Used as the outermost filter.
 */
@Catch()
export class MongoExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const error = exception as { name?: string; code?: number; keyValue?: Record<string, unknown> };

    if (error?.name === 'CastError') {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid identifier',
      });
      return;
    }
    if (error?.code === 11000) {
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        message: 'A record with that unique value already exists',
        fields: error.keyValue ? Object.keys(error.keyValue) : undefined,
      });
      return;
    }
    super.catch(exception, host);
  }
}
