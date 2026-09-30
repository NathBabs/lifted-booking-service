import { existsSync } from 'fs';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from './snake-naming.strategy';

// The TypeORM CLI runs outside Nest, so ConfigModule never loads .env for it.
if (existsSync('.env')) process.loadEnvFile();

export const AppDataSource = new DataSource({
  type: 'postgres',

  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),

  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,

  entities: ['src/database/entities/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],

  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
});
