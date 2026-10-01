/**
 * Starts an in-process Postgres (`@prisma/dev`) and writes its connection
 * string to `.env` as DATABASE_URL, which both prisma7.config.ts and
 * prisma.config.ts read. Keep this running in its own terminal; the database
 * lives only as long as the process.
 */
import { writeFileSync } from 'node:fs';
import { createDevDatabase } from '@repo/test-utils';

const database = await createDevDatabase({ databaseIdleTimeoutMillis: 24 * 60 * 60 * 1000 });
writeFileSync('.env', `DATABASE_URL=${database.connectionString}\n`);
console.log(`Postgres is up. DATABASE_URL written to .env:\n${database.connectionString}`);
console.log('Press Ctrl+C to stop it.');

const stop = async () => {
  await database.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
