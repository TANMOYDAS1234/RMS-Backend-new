// ─── Idempotency Interceptor ─────────────────────────────────────────────────

import {
  Injectable, NestInterceptor, ExecutionContext,
  CallHandler, BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;

    // Only enforce on mutating requests
    if (['POST', 'PATCH', 'PUT'].includes(method)) {
      const key = req.headers['idempotency-key'];
      if (!key) {
        throw new BadRequestException('Idempotency-Key header is required');
      }
    }

    return next.handle();
  }
}
