import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { MongoExceptionFilter } from './common/mongo-exception.filter';
import { auditNetworkConfig } from './common/network';
import { auditWebAuthnConfig } from './auth/webauthn/webauthn.config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('bootstrap');
  const config = app.get(ConfigService);
  const network = auditNetworkConfig(config);
  const webauthn = auditWebAuthnConfig(config);
  for (const warning of network.warnings) logger.warn(warning);
  logger.log(
    `network=${network.walletNetwork} outlayer=${network.outlayerNetwork} ` +
      `payments=${network.paymentsMode} webauthn=${webauthn.rpId}`,
  );
  app.setGlobalPrefix('api');
  // Respect X-Forwarded-For from the reverse proxy. Without this every audit
  // row and every throttler bucket sees the proxy's IP, not the user's.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  const allowedOrigins = (process.env.WEB_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use((req: Request, res: Response, next: NextFunction) => {
    // SameSite=Lax already blocks most cross-site POSTs; an explicit Origin
    // check is the second lock on the money-moving endpoints. Only enforce in
    // production so LAN/dev origins do not break local testing.
    if (
      process.env.NODE_ENV === 'production' &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    ) {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) {
        res.status(403).json({
          statusCode: 403,
          message: 'Request origin is not allowed',
        });
        return;
      }
    }
    next();
  });
  app.use(cookieParser());
  // The API serves JSON, not documents. Helmet's document-level cross-origin
  // policies can leak through proxies and break browser popup/iframe flows, so
  // leave COOP off and allow cross-origin resource reads for API consumers.
  app.use(
    helmet({
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization'],
  });
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new MongoExceptionFilter(httpAdapter));
  app.enableShutdownHooks();
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[keiz-api] listening on http://localhost:${port}/api`);
}

void bootstrap();
