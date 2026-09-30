import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { SeederModule } from './seeder.module';
import { SeederService } from './seeder.service';

@Module({ imports: [AppModule, SeederModule] })
class SeedModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SeedModule);

  try {
    await app.get(SeederService).seed();
  } finally {
    await app.close();
  }
}

bootstrap().catch(() => {
  // SeederService has already logged the failure.
  process.exitCode = 1;
});
