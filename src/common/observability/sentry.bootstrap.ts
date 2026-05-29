// ─── Sentry Bootstrap ────────────────────────────────────────────────────────
// Initialize once at process start, BEFORE NestFactory.create — that's how
// the SDK auto-instruments. Becomes a no-op when SENTRY_DSN isn't set so
// the same code runs in dev without needing local credentials.

import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.RELEASE_SHA,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    // Scrub auth headers and bodies that could contain JWTs / passwords.
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['idempotency-key'];
      }
      return event;
    },
  });
  initialized = true;
  return true;
}

export const SentrySDK = Sentry;
