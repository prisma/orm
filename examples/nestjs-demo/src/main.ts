import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable shutdown hooks so onApplicationShutdown is called
  app.enableShutdownHooks();

  await app.listen(3000);
  console.log(`Application is running on: http://localhost:3000`);
}

bootstrap();
