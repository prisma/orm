/**
 * Per-cell in-process database handle for the init journey test.
 *
 * Postgres uses `@prisma/dev` via the existing `@repo/test-utils`
 * factory; Mongo uses `mongodb-memory-server`; SQLite uses a file in the project. Both expose a normalised
 * `connectionString` that the journey injects into the project's `.env`
 * so the scaffolded `prisma.config.ts` (which reads
 * `process.env['DATABASE_URL']`) picks it up.
 */

import { createDevDatabase, timeouts } from '@repo/test-utils';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { CellId } from './harness';

export interface DatabaseHandle {
  readonly connectionString: string;
  close(): Promise<void>;
}

export async function spinUpDatabaseForCell(cell: CellId): Promise<DatabaseHandle> {
  switch (cell.target) {
    case 'mongo':
      return spinUpMongo();
    case 'postgres':
      return spinUpPostgres();
    case 'sqlite':
      return { connectionString: SQLITE_DATABASE_FILE, close: async () => {} };
  }
}

/** A file in the project folder, which the journey's commands and user code run from. */
const SQLITE_DATABASE_FILE = './dev.db';

async function spinUpPostgres(): Promise<DatabaseHandle> {
  const dev = await createDevDatabase();
  return {
    connectionString: dev.connectionString,
    close: () => dev.close(),
  };
}

async function spinUpMongo(): Promise<DatabaseHandle> {
  const replSet = await MongoMemoryReplSet.create({
    instanceOpts: [
      { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
    ],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  return {
    connectionString: replSet.getUri(),
    close: async () => {
      await replSet.stop();
    },
  };
}
