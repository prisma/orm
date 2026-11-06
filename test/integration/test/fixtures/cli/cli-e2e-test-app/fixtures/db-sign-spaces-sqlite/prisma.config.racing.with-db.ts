import sqliteDriver from '@internal/driver-sqlite/control';
import { defineConfig as ormConfig } from '@internal/sqlite/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import testSqliteSpaceExtension from '../../../../contract-space-fixture/sqlite';
import { racingDriver } from '../fixtures/db-sign-spaces/racing-driver';

// The app and one contract-space extension on SQLite, through a driver that
// runs the statement in race.json just before its first transaction.
export default definePrismaConfig({
  orm: {
    ...ormConfig({
      contract: './contract.prisma',
      output: 'output',
      extensions: [testSqliteSpaceExtension],
      db: { connection: '{{DB_PATH}}' },
      migrations: { dir: 'migrations' },
    }),
    driver: racingDriver(sqliteDriver, new URL('./race.json', import.meta.url)),
  },
});
