import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, raw } from 'express';
import { AppModule } from './app.module';
import { swaggerOptions } from './utils/swagger-options';

process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error(
    'unhandled rejection (backend keeps running):',
    (reason as Error)?.stack ?? reason,
  );
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.use(
    '/api/tg-accounts',
    raw({ type: ['application/octet-stream', 'image/*'], limit: '15mb' }),
  );
  app.use('/api/personas', json({ limit: '8mb' }));
  app.use(json({ limit: '2mb' }));

  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Nastya API')
    .setDescription(
      `<h3>Manager panel API and the persona brain 👋</h3>
      <ul>
      <li>Sign in at <a>/auth/login</a> with username and password</li>
      <li>Grab the access token</li>
      <li>Set it under the “Authorize” button</li>
      </ul>`,
    )
    .setVersion('0.0.1')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      in: 'header',
      description:
        '<h5>Insert the received access token during authorization</h5>',
    })
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, swaggerOptions);

  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 8011));
}
bootstrap();
