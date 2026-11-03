import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, tap } from 'rxjs';
import { AuditService } from './audit.service';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const req = http.getRequest();
    if (!MUTATING.has(req.method)) return next.handle();

    const res = http.getResponse();
    const path = req.route?.path ?? req.path;
    const base = {
      orgId: req.user?.orgId,
      actorUserId: req.user?.sub,
      accountId: req.user?.accountId,
      action: `${req.method} ${path}`,
      method: req.method,
      path,
      ip: req.ip,
    };

    return next.handle().pipe(
      tap(() => {
        // Fire and forget: the response does not wait for the audit write.
        void this.audit.record({ ...base, status: res.statusCode ?? 200 });
      }),
      catchError((error) => {
        void this.audit.record({
          ...base,
          status: typeof error?.status === 'number' ? error.status : 500,
          metadata: { error: error?.message },
        });
        throw error;
      }),
    );
  }
}
