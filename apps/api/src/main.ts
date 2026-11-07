import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { HttpAdapterHost } from '@nestjs/core';
import { MongoExceptionFilter } from './common/mongo-exception.filter';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  // Respect X-Forwarded-For from the reverse proxy. Without this every audit
  // row and every throttler bucket sees the proxy's IP, not the user's.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(cookieParser());
  app.use(helmet());
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','),
    credentials: true,
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
