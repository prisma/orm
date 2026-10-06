import { defineConfig as ormConfig } from '@internal/sqlite/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import testSqliteSpaceExtension from '../../../../contract-space-fixture/sqlite';

// An app contract beside one contract-space extension, on SQLite. Used by
// the `db sign` journeys that re-sign both spaces at once.
export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.prisma',
    output: 'output',
    extensions: [testSqliteSpaceExtension],
    db: { connection: '{{DB_PATH}}' },
    migrations: { dir: 'migrations' },
  }),
});
