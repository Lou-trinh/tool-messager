import 'reflect-metadata';
import compression from 'compression';
import helmet from 'helmet';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import swaggerUi from 'swagger-ui-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { JsonLogger } from './common/json-logger';
import { openApiDocument } from './openapi';
import { ZALO_SITE_VERIFICATION_PATH } from './site-verification.controller';

function validateEnvironment(): void {
  const required = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'] as const;
  for (const name of required) if (!process.env[name]) throw new Error(`${name} is required.`);
  if (process.env.NODE_ENV === 'production') {
    for (const name of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'] as const) {
      const value = process.env[name] ?? '';
      if (value.length < 32 || /development|change-me|replace-with/i.test(value)) throw new Error(`${name} must be a non-placeholder secret of at least 32 characters in production.`);
    }
  }
}

async function bootstrap(): Promise<void> {
  validateEnvironment();
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger(), rawBody: true });
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: ZALO_SITE_VERIFICATION_PATH, method: RequestMethod.GET }],
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  }));
  app.use(compression());
  app.enableCors({
    origin: (process.env.APP_URL ?? 'http://localhost:3000').split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { explorer: true }));

  await app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0');
}

void bootstrap();
