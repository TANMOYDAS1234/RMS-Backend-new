// ─── Idempotency Interceptor ─────────────────────────────────────────────────

import {
  Injectable, NestInterceptor, ExecutionContext,
  CallHandler, BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

// Routes that don't need idempotency keys (internal/manager overrides)
const EXEMPT_PREFIXES = ['/manager/', '/admin/orders/', '/admin/billing/'];

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;

    // Only enforce on mutating requests
    if (['POST', 'PATCH', 'PUT'].includes(method)) {
      const path: string = req.path ?? '';
      const isExempt = EXEMPT_PREFIXES.some((p) => path.startsWith(p));
      if (!isExempt) {
        const key = req.headers['idempotency-key'];
        if (!key) {
          throw new BadRequestException('Idempotency-Key header is required');
        }
      }
    }

    return next.handle();
  }
}
