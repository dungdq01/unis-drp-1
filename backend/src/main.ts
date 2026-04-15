import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS: đọc từ env CORS_ORIGIN (comma-separated) — fallback localhost cho dev
  const rawOrigins = process.env.CORS_ORIGIN ?? 'http://localhost:3000,http://localhost:3001';
  const allowedOrigins = rawOrigins.split(',').map(o => o.trim()).filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('UNIS SCP API')
    .setDescription('Supply Chain Planning — UNIS Group')
    .setVersion('1.0')
    .addTag('demand', 'Step 1: Demand Ingestion')
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, doc);

  const port = parseInt(process.env.PORT ?? '3002', 10);
  await app.listen(port);
  console.log(`UNIS API running on port ${port}`);
  console.log(`Swagger: http://localhost:${port}/api/docs`);
}
bootstrap();
