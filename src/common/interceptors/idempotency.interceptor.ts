// ─── Idempotency Interceptor ─────────────────────────────────────────────────

import {
  Injectable, NestInterceptor, ExecutionContext,
  CallHandler, BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

// Internal/read-modify endpoints that legitimately can't carry an Idempotency-Key
// (state-machine progress ticks, polled stock-log appends). Keep tight — DO NOT add
// high-blast-radius mutations like /manager/order-action, /admin/billing/refund,
// or /admin/orders/force-close here; those MUST be idempotent.
const EXEMPT_PREFIXES: string[] = [];

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;

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
