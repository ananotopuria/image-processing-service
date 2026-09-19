import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export function parseCorsOrigins(value: string | undefined): string[] {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error(
      'CORS_ORIGINS must contain at least one frontend origin, e.g. http://localhost:5173',
    );
  }

  for (const [index, origin] of origins.entries()) {
    let url: URL | undefined;
    try {
      url = new URL(origin);
    } catch {
      // Report the configuration key and entry without logging its contents.
    }
    if (
      !url ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      origin.includes('*')
    ) {
      throw new Error(
        `CORS_ORIGINS entry ${index + 1} must be an exact HTTP(S) origin (scheme://host[:port]), with no wildcard, credentials, path, trailing slash, query, or fragment; use the browser's URL.origin value`,
      );
    }
  }

  return origins;
}

export function configureApp(app: INestApplication): void {
  const origins = parseCorsOrigins(
    app.get(ConfigService).get<string>('CORS_ORIGINS'),
  );

  // Register before routes and guards so preflights and errors get CORS headers.
  app.enableCors({
    origin: origins,
    methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Retry-After'],
    credentials: false,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
