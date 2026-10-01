/**
 * End-to-end round-trip for the SQLite migration authoring surface.
 *
 * Confirms that the TypeScript source produced by
 * `TypeScriptRenderableSqliteMigration#renderTypeScript()` is a faithful
 * serialization of the call list: when rewritten to point at the live
 * workspace entrypoints, written to disk, and executed via `tsx`, the
 * resulting `ops.json` matches `renderOps(calls)` exactly. Mirrors the
 * Postgres `render-typescript.roundtrip.test.ts`.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { APP_SPACE_ID, storageHashHex } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { col, primaryKey } from '@internal/sql-relational-core/contract-free';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import {
  AddColumnCall,
  CreateIndexCall,
  CreateTableCall,
  DropTableCall,
  RawSqlCall,
  RecreateTableCall,
} from '@internal/target-sqlite/op-factory-call';
import { TypeScriptRenderableSqliteMigration } from '@internal/target-sqlite/planner-produced-sqlite-migration';
import { renderOps } from '@internal/target-sqlite/render-ops';
import { timeouts } from '@repo/test-utils';
import { join, resolve } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../../src/exports/control';

const execFileAsync = promisify(execFile);
const testAdapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());
const packageRoot = resolve(import.meta.dirname, '../..');
const repoRoot = resolve(packageRoot, '../../../..');
const targetSqliteRoot = resolve(repoRoot, 'packages/3-targets/3-targets/sqlite');
const tsxPath = join(repoRoot, 'node_modules/.bin/tsx');

const targetSqliteMigrationExport = pathToFileURL(
  resolve(targetSqliteRoot, 'src/exports/migration.ts'),
).href;
const cliConfigTypesExport = pathToFileURL(
  resolve(repoRoot, 'packages/1-framework/3-tooling/cli/src/exports/config-types.ts'),
).href;
const familySqlControlExport = pathToFileURL(
  resolve(repoRoot, 'packages/2-sql/9-family/src/exports/control.ts'),
).href;
const targetSqliteControlExport = pathToFileURL(
  resolve(targetSqliteRoot, 'src/exports/control.ts'),
).href;
const adapterSqliteControlExport = pathToFileURL(
  resolve(packageRoot, 'src/exports/control.ts'),
).href;

/**
 * `MigrationCLI.run` requires a `prisma.config.ts` to assemble a
 * `ControlStack`. Tests have no workspace `node_modules` resolution from
 * `tmpDir`, so we write a bespoke config alongside `migration.ts` whose
 * imports all use absolute `file://` URLs into the live workspace
 * sources. The driver is omitted — the round-trip exercises the
 * serialization path only and never opens a database connection.
 */
const fixtureConfigSource = [
  `import sqliteAdapter from '${adapterSqliteControlExport}';`,
  `import { defineConfig } from '${cliConfigTypesExport}';`,
  `import sql from '${familySqlControlExport}';`,
  `import sqlite from '${targetSqliteControlExport}';`,
  '',
  'export default { $prismaConfig: 1, orm: defineConfig({',
  '  family: sql,',
  '  target: sqlite,',
  '  adapter: sqliteAdapter,',
  '}) };',
  '',
].join('\n');

/**
 * Rewrite the bare import the renderer always emits so that running the
 * rendered scaffold from a temp directory (which has no workspace
 * `node_modules` resolution) still reaches the live in-source modules.
 * The renderer pulls both `Migration` (the base class) and `MigrationCLI`
 * (the entrypoint) from the sqlite migration facade, so a single rewrite
 * is enough.
 */
function rewriteImports(tsSource: string): string {
  return tsSource.replace("'@internal/sqlite/migration'", `'${targetSqliteMigrationExport}'`);
}

/**
 * Write the deduplicated snapshot-store fixtures the rendered scaffold
 * imports — `snapshots/<hex>/contract.json` (carrying `storage.storageHash`,
 * which the base's derived `describe()` reads) and the matching
 * `snapshots/<hex>/contract.ts` type module for each of `meta.to` and (when
 * non-null) `meta.from`. The JSON hashes match `meta` so the derived
 * describe() is consistent. `SNAPSHOTS_IMPORT_PATH` matches the
 * `snapshotsImportPath` passed to the migration under test.
 */
async function writeContractFixtures(
  dir: string,
  meta: { readonly from: string | null; readonly to: string },
): Promise<void> {
  const contractType =
    'export type Contract = { readonly storage: { readonly storageHash: string } };\n';
  const writeSnapshot = async (storageHash: string) => {
    const snapshotDir = join(dir, SNAPSHOTS_IMPORT_PATH, storageHashHex(storageHash));
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(
      join(snapshotDir, 'contract.json'),
      JSON.stringify({ storage: { storageHash } }, null, 2),
    );
    await writeFile(join(snapshotDir, 'contract.ts'), contractType);
  };
  await writeSnapshot(meta.to);
  if (meta.from !== null) {
    await writeSnapshot(meta.from);
  }
}

const SNAPSHOTS_IMPORT_PATH = './snapshots';
const META = {
  from: '0'.repeat(64),
  to: '1'.repeat(64),
} as const;

describe('TypeScriptRenderableSqliteMigration round-trip', () => {
  // Definite-assignment assertion: `beforeEach` populates this. The runtime
  // check in `afterEach` covers the case where setup throws before the
  // assignment runs — without that guard the teardown would mask the real
  // setup error with a `rm(undefined)` failure.
  let tmpDir!: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sqlite-render-roundtrip-'));
    await writeFile(join(tmpDir, 'package.json'), '{"type":"module"}');
    await writeFile(join(tmpDir, 'prisma.config.ts'), fixtureConfigSource);
    // The rendered scaffold imports its from/to identity from committed
    // contract JSON (the base derives describe() from `storage.storageHash`)
    // plus the matching `Contract` types. Write minimal fixtures so the
    // executed migration resolves its imports.
    await writeContractFixtures(tmpDir, META);
  });

  afterEach(async () => {
    if (typeof tmpDir === 'string') {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('renders TS that re-parses to operations matching renderOps(calls) exactly', {
    timeout: timeouts.coldTransformImport,
  }, async () => {
    const calls = [
      new CreateTableCall(
        'user',
        [col('id', 'INTEGER', { primaryKey: true }), col('email', 'TEXT', { notNull: true })],
        [primaryKey(['id'])],
      ),
      new AddColumnCall('user', {
        name: 'nickname',
        typeSql: 'TEXT',
        nullable: true,
      }),
      new CreateIndexCall('user', 'user_email_idx', ['email']),
      new DropTableCall('stale'),
    ];
    const migration = new TypeScriptRenderableSqliteMigration(
      calls,
      META,
      APP_SPACE_ID,
      SNAPSHOTS_IMPORT_PATH,
    );

    const tsSource = rewriteImports(migration.renderTypeScript(keepInternalSpecifiers));
    await writeFile(join(tmpDir, 'migration.ts'), tsSource);

    const { stdout, stderr } = await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
      cwd: tmpDir,
    });
    expect(stderr).toBe('');
    expect(stdout).toContain('Wrote ops.json + migration.json to ');

    const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
    const ops = JSON.parse(opsJson);

    const expected = JSON.parse(JSON.stringify(await Promise.all(renderOps(calls, testAdapter))));

    expect(ops).toEqual(expected);
  });

  it('renders an empty calls list whose executed scaffold emits []', {
    timeout: timeouts.coldTransformImport,
  }, async () => {
    const migration = new TypeScriptRenderableSqliteMigration(
      [],
      META,
      APP_SPACE_ID,
      SNAPSHOTS_IMPORT_PATH,
    );

    const tsSource = rewriteImports(migration.renderTypeScript(keepInternalSpecifiers));
    await writeFile(join(tmpDir, 'migration.ts'), tsSource);

    const { stderr } = await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
      cwd: tmpDir,
    });
    expect(stderr).toBe('');

    const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));
    expect(ops).toEqual([]);
  });

  it('preserves RawSqlCall ops byte-for-byte through the render → execute round-trip', {
    timeout: timeouts.coldTransformImport,
  }, async () => {
    const op = {
      id: 'raw.custom.1',
      label: 'raw custom 1',
      operationClass: 'additive' as const,
      target: { id: 'sqlite' as const },
      precheck: [],
      execute: [{ description: 'do thing', sql: 'SELECT 1' }],
      postcheck: [],
      meta: { note: 'preserved' },
    };
    const calls = [new RawSqlCall(op)];
    const migration = new TypeScriptRenderableSqliteMigration(
      calls,
      META,
      APP_SPACE_ID,
      SNAPSHOTS_IMPORT_PATH,
    );

    const tsSource = rewriteImports(migration.renderTypeScript(keepInternalSpecifiers));
    await writeFile(join(tmpDir, 'migration.ts'), tsSource);

    await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
      cwd: tmpDir,
    });

    const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));

    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual(JSON.parse(JSON.stringify(op)));
  });

  it('preserves RecreateTableCall through the render → execute round-trip', {
    timeout: timeouts.coldTransformImport,
  }, async () => {
    const calls = [
      new RecreateTableCall({
        tableName: 'user',
        contractTable: {
          columns: [
            { name: 'id', typeSql: 'INTEGER', nullable: false },
            {
              name: 'email',
              typeSql: 'TEXT',
              default: { kind: 'literal', value: 'nobody' },
              codecRef: { codecId: 'sqlite/text@1' },
              nullable: true,
            },
          ],
          primaryKey: { columns: ['id'] },
          uniques: [],
          foreignKeys: [],
        },
        schemaColumnNames: ['id', 'email'],
        indexes: [{ name: 'idx_user_email', columns: ['email'] }],
        summary: 'Recreates table user',
        postchecks: [
          {
            description: 'verify "email" nullability on "user"',
            sql: "SELECT COUNT(*) > 0 FROM pragma_table_info('user') WHERE name = 'email' AND \"notnull\" = 0",
          },
          { description: 'verify "email" default on "user"', columnDefault: 'email' },
        ],
        operationClass: 'widening',
      }),
    ];
    const migration = new TypeScriptRenderableSqliteMigration(
      calls,
      META,
      APP_SPACE_ID,
      SNAPSHOTS_IMPORT_PATH,
    );

    const tsSource = rewriteImports(migration.renderTypeScript(keepInternalSpecifiers));
    await writeFile(join(tmpDir, 'migration.ts'), tsSource);

    await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], { cwd: tmpDir });

    const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));

    const expected = JSON.parse(JSON.stringify(await Promise.all(renderOps(calls, testAdapter))));
    expect(ops).toEqual(expected);
  });
});
