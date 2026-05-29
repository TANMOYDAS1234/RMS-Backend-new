// ─── Global Exception Filter ─────────────────────────────────────────────────

import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SentrySDK } from '../observability/sentry.bootstrap';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    this.logger.error(`${req.method} ${req.url} → ${status}`, exception instanceof Error ? exception.stack : '');

    // Only 5xx + unexpected errors go to Sentry. Validation 400s, 401s,
    // 404s are noise. Sentry hub is a no-op when SENTRY_DSN is unset.
    if (status >= 500 && exception instanceof Error) {
      SentrySDK.captureException(exception, {
        tags: { route: req.url, method: req.method, status: String(status) },
      });
    }

    res.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: req.url,
      message,
    });
  }
}
