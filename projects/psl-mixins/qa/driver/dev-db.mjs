import { writeFileSync } from 'node:fs';
import { startPrismaDevServer } from '@prisma/dev';

const server = await startPrismaDevServer({
  databaseConnectTimeoutMillis: 1000,
  databaseIdleTimeoutMillis: 30_000,
});
const url = new URL(server.database.connectionString);
if (url.hostname === 'localhost' || url.hostname === '::1') url.hostname = '127.0.0.1';
writeFileSync('database-url.txt', url.toString());
console.log('dev database listening; connection string written to database-url.txt');

const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
setInterval(() => {}, 60_000);
