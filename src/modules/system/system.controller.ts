import { Controller, Get, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Public, no-auth runtime config endpoint. Replaces what Flutter previously
 * had to know at build time via --dart-define:
 *   - qrWebBaseUrl: where customer QR codes should resolve to (the Flutter
 *     web build's origin). Falls back to the request's own origin when no
 *     PUBLIC_WEB_URL env var is set — so a single Render deploy that serves
 *     both API and web JustWorks.
 *   - razorpay key + environment.
 *
 * Keeping this on a tiny standalone controller (not BillingController) so
 * the Flutter app can poll it once at boot without authenticating.
 */
@Controller('system')
export class SystemController {
  constructor(private readonly config: ConfigService) {}

  @Get('config')
  getConfig(@Req() req: Request) {
    // Prefer the explicit env override; otherwise compute from the
    // request's own host so a freshly-cloned deploy works with zero env.
    // X-Forwarded-Proto/Host are set by Render's edge so behind-proxy
    // detection is accurate.
    const envWebUrl = this.config.get<string>('PUBLIC_WEB_URL');
    const protocol = (req.headers['x-forwarded-proto'] as string) ||
                     req.protocol ||
                     'https';
    const host = (req.headers['x-forwarded-host'] as string) ||
                 req.get('host') ||
                 '';
    const computedOrigin = host ? `${protocol}://${host}` : '';
    const qrWebBaseUrl = envWebUrl?.replace(/\/+$/, '') ||
                        computedOrigin.replace(/\/+$/, '');

    return {
      qrWebBaseUrl,
      apiBaseUrl: computedOrigin,
      razorpay: {
        keyId: this.config.get<string>('RAZORPAY_KEY_ID') ?? '',
        enabled: !!this.config.get<string>('RAZORPAY_KEY_ID'),
        environment: this.config.get<string>('RAZORPAY_ENV') ?? 'sandbox',
      },
      environment: this.config.get<string>('NODE_ENV') ?? 'development',
      serverTime: new Date().toISOString(),
    };
  }
}
