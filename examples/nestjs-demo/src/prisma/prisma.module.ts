import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { db } from './db.js';

export const DB = Symbol('PRISMA_DB');
export type Db = typeof db;

@Global()
@Module({
  providers: [{ provide: DB, useValue: db }],
  exports: [DB],
})
export class PrismaModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await db.close();
  }
}
