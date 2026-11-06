/**
 * A rendered `this.setDefault` carries no operation class: the executed migration derives it from its start contract, read from the snapshot store.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { StorageTable } from '@internal/sql-contract/types';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import { SetDefaultCall } from '@internal/target-postgres/op-factory-call';
import { TypeScriptRenderablePostgresMigration } from '@internal/target-postgres/planner-produced-postgres-migration';
import { renderOps } from '@internal/target-postgres/render-ops';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  execFileAsync,
  fixtureConfigSource,
  META,
  rewriteImports,
  SNAPSHOTS_IMPORT_PATH,
  testAdapter,
  tsxPath,
  writeContractFixtures,
} from './fixtures/render-roundtrip';

describe('a rendered this.setDefault, executed', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'postgres-render-set-default-'));
    await writeFile(join(tmpDir, 'package.json'), '{"type":"module"}');
    await writeFile(join(tmpDir, 'prisma.config.ts'), fixtureConfigSource);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  }, timeouts.databaseOperation);

  it(
    'renders a changed default without its operation class, which the executed migration derives from the start contract',
    async () => {
      await writeContractFixtures(tmpDir, META, {
        public: postgresCreateNamespace({
          id: 'public',
          entries: {
            table: {
              ticket: new StorageTable({
                columns: {
                  status: {
                    dataType: 'pg/text',
                    codecId: 'pg/text@1',
                    nullable: false,
                    default: { kind: 'literal', value: 'open' },
                  },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
            },
          },
        }),
      });
      const calls = [
        new SetDefaultCall(
          'public',
          'ticket',
          col('status', 'text', { default: lit('closed'), codecRef: { codecId: 'pg/text@1' } }),
          'widening',
        ),
      ];
      const migration = new TypeScriptRenderablePostgresMigration(
        calls,
        META,
        APP_SPACE_ID,
        SNAPSHOTS_IMPORT_PATH,
        testAdapter,
      );

      const tsSource = rewriteImports(migration.renderTypeScript(keepInternalSpecifiers));
      await writeFile(join(tmpDir, 'migration.ts'), tsSource);
      const { stderr } = await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
        cwd: tmpDir,
      });
      const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));

      expect({
        stderr,
        rendersOperationClass: tsSource.includes('operationClass'),
        operationClasses: ops.map((op: { operationClass: string }) => op.operationClass),
        ops,
      }).toEqual({
        stderr: '',
        rendersOperationClass: false,
        operationClasses: ['widening'],
        ops: await Promise.all(renderOps(calls, testAdapter)),
      });
    },
    timeouts.typeScriptCompilation,
  );
});
