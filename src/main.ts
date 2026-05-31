import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { join } from 'path';
import * as fs from 'fs';
import { initSentry } from './common/observability/sentry.bootstrap';
import { AppModule } from './app.module';

// Sentry must be initialized before the Nest app boots so the SDK can hook
// into Node's uncaughtException / unhandledRejection.
initSentry();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  const allowedOrigins = (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length === 1 && allowedOrigins[0] === '*' ? true : allowedOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const uploadsDir = join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });

  // Serve the Flutter Web build out of public/web when present (the deploy
  // pipeline copies flutter_app/build/web there). This makes the customer
  // QR app reachable at the same origin as the API — one Render service
  // serves both, no separate static-site deploy needed, and the QR code
  // generator can fall back to req.host without extra env wiring.
  const webDir = process.env.WEB_BUILD_DIR
    ? join(process.cwd(), process.env.WEB_BUILD_DIR)
    : join(process.cwd(), 'public', 'web');
  if (fs.existsSync(webDir)) {
    app.useStaticAssets(webDir, {
      fallthrough: true,
      index: ['index.html'],
      // Hashed Flutter assets (main.dart.js, canvaskit/*, etc.) have
      // content-derived filenames so they're safe to cache forever.
      // index.html and the service worker MUST NOT be cached or the
      // client keeps loading the previous build for hours after a
      // deploy — exactly the "I deployed but my fix isn't live" failure
      // mode users keep hitting on this app.
      setHeaders: (res, path) => {
        const lower = path.toLowerCase();
        const noCache =
          lower.endsWith('/index.html') ||
          lower.endsWith('flutter_service_worker.js') ||
          lower.endsWith('flutter_bootstrap.js') ||
          lower.endsWith('manifest.json') ||
          lower.endsWith('version.json');
        if (noCache) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
      },
    });
    const indexHtml = join(webDir, 'index.html');
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.get(/^\/t\/.+/, (_req: any, res: any, next: any) => {
      if (fs.existsSync(indexHtml)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.sendFile(indexHtml);
      }
      return next();
    });
    logger.log(`Serving Flutter Web build from ${webDir}`);
  } else {
    logger.log(`Flutter Web build not present at ${webDir} — API only.`);
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('RMS Backend API')
    .setDescription('Restaurant Management System — REST + WebSocket API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, doc, { swaggerOptions: { persistAuthorization: true } });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`RMS Backend running on http://localhost:${port}`);
  logger.log(`OpenAPI docs at http://localhost:${port}/docs`);
}

bootstrap();
