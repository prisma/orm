import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  runContractEmit,
  runDbInit,
  setupJourney,
  sql,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('db init on Postgres', () => {
    const db = useDevDatabase();

    it(
      'creates tables in schemas named after a role or an extension',
      async () => {
        await sql(db.connectionString, 'CREATE ROLE myapp NOLOGIN');
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(
          join(ctx.testDir, 'contract.prisma'),
          `// use prisma-8
namespace myapp {
  model Foo {
    id Int @id @default(autoincrement())
    @@map("Foo")
  }
}

namespace pg_trgm {
  extension pg_trgm {}

  model Bar {
    id Int @id
    @@map("Bar")
  }
}
`,
        );

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, emit.stderr).toBe(0);

        const init = await runDbInit(ctx);
        expect(init.exitCode, init.stderr).toBe(0);
        const tables = await sql(
          db.connectionString,
          `SELECT table_schema, table_name FROM information_schema.tables
           WHERE table_schema IN ('myapp', 'pg_trgm') ORDER BY table_schema, table_name`,
        );
        expect(tables.rows).toEqual([
          { table_schema: 'myapp', table_name: 'Foo' },
          { table_schema: 'pg_trgm', table_name: 'Bar' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
