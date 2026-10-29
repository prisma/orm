/**
 * End-to-end round-trip for the Postgres migration authoring surface.
 *
 * Confirms that the TypeScript source produced by
 * `TypeScriptRenderablePostgresMigration#renderTypeScript()` is a
 * faithful serialization of the call list: when rewritten to point at the
 * live workspace entrypoints, written to disk, and executed via `tsx`,
 * the resulting `ops.json` matches `renderOps(calls)` exactly (modulo
 * JSON-only fields). This is the acceptance criterion that the
 * authoring surface is an invariant — a planner that emits IR, the IR
 * survives a full parse → execute round-trip back into runtime ops.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { APP_SPACE_ID, storageHashHex } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { formatMigrationTs } from '@internal/migration-tools/migration-ts';
import { checkExpression, col, fn, primaryKey } from '@internal/sql-relational-core/contract-free';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import {
  AddColumnCall,
  AddColumnWithTemporaryDefaultCall,
  AddRequiredColumnToEmptyTableCall,
  AlterColumnTypeCall,
  CreateExtensionCall,
  CreateIndexCall,
  CreatePostgresRlsPolicyCall,
  CreateSchemaCall,
  CreateTableCall,
  DisableRowLevelSecurityCall,
  DropExtensionCall,
  DropPostgresRlsPolicyCall,
  DropSchemaCall,
  DropTableCall,
  EnableRowLevelSecurityCall,
  RawSqlCall,
  RemoveStoredValueCall,
  RenameIndexCall,
  RenamePostgresRlsPolicyCall,
  RenameSchemaCall,
  ReplaceStoredValueCall,
  SetDefaultCall,
  SetExtensionSchemaCall,
  SetTableSchemaCall,
} from '@internal/target-postgres/op-factory-call';
import { TypeScriptRenderablePostgresMigration } from '@internal/target-postgres/planner-produced-postgres-migration';
import { renderOps } from '@internal/target-postgres/render-ops';
import { PostgresRlsPolicy } from '@internal/target-postgres/types';
import { timeouts } from '@repo/test-utils';
import { join, resolve } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  execFileAsync,
  fixtureConfigSource,
  META,
  repoRoot,
  rewriteImports,
  SNAPSHOTS_IMPORT_PATH,
  testAdapter,
  tsxPath,
  writeContractFixtures,
} from './fixtures/render-roundtrip';

const tscPath = join(repoRoot, 'node_modules/.bin/tsc');

/**
 * Writes a rendered migration plus the tsconfig and contract-type fixtures
 * the typecheck tests need. The facade import is pointed at the facade's
 * BUILT dist (an absolute path to `dist/migration.mjs`, which tsc resolves
 * to the rolled-up `migration.d.mts`) — the same declarations a user's
 * project resolves through the package `exports` map, so a dts-rollup
 * regression is visible here (`tsdown-dist-layout-in-tests`). The
 * execution fixtures' minimal `Contract` type does not satisfy the
 * `Migration` base's `Contract<SqlStorage>` constraint, so the snapshot
 * contract types come from the same dist types.
 */
async function writeTypecheckDir(dir: string, renderedSource: string): Promise<void> {
  const tsSource = renderedSource.replace(
    "'@internal/postgres/migration'",
    `'${resolve(repoRoot, 'packages/3-targets/postgres/9-facade/dist/migration.mjs')}'`,
  );
  await writeFile(join(dir, 'migration.ts'), tsSource);
  const contractDistTypes = resolve(
    repoRoot,
    'packages/1-framework/0-foundation/contract/dist/types.mjs',
  );
  const sqlContractDistTypes = resolve(
    repoRoot,
    'packages/2-sql-family/1-core/contract/dist/types.mjs',
  );
  const realContractType = `export type Contract = import('${contractDistTypes}').Contract<\n  import('${sqlContractDistTypes}').SqlStorage\n>;\n`;
  for (const hash of [META.to, META.from]) {
    await writeFile(
      join(dir, SNAPSHOTS_IMPORT_PATH, storageHashHex(hash), 'contract.ts'),
      realContractType,
    );
  }
  await writeFile(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'preserve',
        moduleResolution: 'bundler',
        lib: ['ES2022'],
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        typeRoots: [join(repoRoot, 'node_modules/@types')],
        types: ['node'],
      },
      include: ['migration.ts'],
    }),
  );
}

describe('TypeScriptRenderablePostgresMigration round-trip', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'postgres-render-roundtrip-'));
    await writeFile(join(tmpDir, 'package.json'), '{"type":"module"}');
    await writeFile(join(tmpDir, 'prisma.config.ts'), fixtureConfigSource);
    // The rendered scaffold imports its from/to identity from committed
    // contract JSON (the base derives describe() from `storage.storageHash`)
    // and the matching `Contract` types. Write minimal fixtures so the
    // executed migration resolves its imports; the from/to hashes here match
    // META so the derived describe() is consistent.
    await writeContractFixtures(tmpDir, META);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  }, timeouts.databaseOperation);

  it('renders TS that re-parses to operations matching renderOps(calls) exactly', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const calls = [
      new CreateExtensionCall('public', 'citext'),
      new SetExtensionSchemaCall('citext', 'app'),
      new DropExtensionCall('app', 'citext'),
      new CreateSchemaCall('app'),
      new CreateTableCall(
        'public',
        'user',
        [col('id', 'text', { notNull: true }), col('email', 'text', { notNull: true })],
        [
          primaryKey(['id']),
          checkExpression('user_email_check', `"email" <> ''`),
          checkExpression('user_email_escapes', `"email" !~ '\\d' AND "email" <> '\`\${x}'`),
          checkExpression('user_email_length', `"email" <> ''\n  AND length("email") < 255`),
        ],
      ),
      new AddColumnCall('public', 'user', col('nickname', 'text'), postgresDataTypes),
      new AddColumnCall('public', 'user', col('meta', 'jsonb'), postgresDataTypes),
      new AddColumnWithTemporaryDefaultCall(
        'public',
        'user',
        'handle',
        'text',
        "''",
        postgresDataTypes,
      ),
      new AddRequiredColumnToEmptyTableCall('public', 'user', 'code', 'int4', postgresDataTypes),
      new AlterColumnTypeCall({
        ownsAutoincrementSequence: false,
        schemaName: 'public',
        tableName: 'user',
        columnName: 'nickname',
        type: 'varchar(40)',
        using: { kind: 'sql', sql: 'left("nickname", 40)' },
        dataTypes: postgresDataTypes,
      }),
      new SetDefaultCall(
        'public',
        'user',
        col('meta', 'jsonb', { default: fn(`'{"a": 1}'::jsonb`) }),
        'additive',
      ),
      new CreateIndexCall('public', 'user', 'user_email_idx', { columns: ['email'] }),
      new CreateIndexCall('public', 'user', 'user_email_lower', { expression: '  lower(email)' }),
      new CreateIndexCall(
        'public',
        'user',
        'user_email_eq',
        { expression: 'lower(email)' },
        { unique: true, where: `"nickname" <> 'anonymous'` },
      ),
      new RenameIndexCall('public', 'user', 'user_email_idx', 'user_email_lookup_ab12cd34'),
      new EnableRowLevelSecurityCall('public', 'user'),
      new CreatePostgresRlsPolicyCall(
        'public',
        'user',
        new PostgresRlsPolicy({
          naming: { kind: 'wire', prefix: 'p', hash: 'ab12cd34' },
          tableName: 'user',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: `("id" = auth.uid() AND "email" <> '')`,
          withCheck: `("userId" = auth.uid())`,
          permissive: true,
        }),
      ),
      new RenamePostgresRlsPolicyCall('public', 'user', 'p_ab12cd34', 'p_e5f6a7b8'),
      new DropPostgresRlsPolicyCall('public', 'user', 'p_e5f6a7b8'),
      new DisableRowLevelSecurityCall('public', 'user'),
      new DropTableCall('public', 'stale'),
      new ReplaceStoredValueCall('public', 'user', 'nickname', "it's", 'it"s', false),
      new ReplaceStoredValueCall(UNBOUND_NAMESPACE_ID, 'audit', 'tags', 'a', 'b', true),
      new RemoveStoredValueCall('public', 'user', 'code', 3, false),
      new ReplaceStoredValueCall('public', 'user', 'rank', '7', '8', false, {
        codecRef: { codecId: 'pg/int8@1' },
        codecs: createPostgresBuiltinCodecLookup(),
      }),
      new SetTableSchemaCall('public', 'user', 'app'),
      new SetTableSchemaCall(UNBOUND_NAMESPACE_ID, 'audit', 'app'),
      new RenameSchemaCall('app', 'application'),
      new DropSchemaCall('legacy'),
    ];
    const migration = new TypeScriptRenderablePostgresMigration(
      calls,
      META,
      APP_SPACE_ID,
      SNAPSHOTS_IMPORT_PATH,
      testAdapter,
    );

    const tsSource = rewriteImports(migration.renderTypeScript(keepInternalSpecifiers));
    expect(tsSource).toContain('checkExpression("user_email_check", sql`"email" <> \'\'`)');
    expect(tsSource).toContain('checkExpression("user_email_length", sql`\n');
    expect(tsSource).toContain('expression: "  lower(email)"');
    expect(tsSource).toContain('where: sql`"nickname" <> \'anonymous\'`');
    expect(tsSource).toContain('using: sql`("id" = auth.uid() AND "email" <> \'\')`');
    expect(tsSource).toContain('withCheck: sql`("userId" = auth.uid())`');
    expect(tsSource).toContain(`sql\`"email" !~ '\\\\d' AND "email" <> '\\\`\\\${x}'\``);
    expect(tsSource).toContain('default: fn(sql`\'{"a": 1}\'::jsonb`)');
    expect(tsSource).toContain(
      'this.replaceStoredValue({ table: "audit", column: "tags", from: "a", to: "b", many: true })',
    );
    await writeFile(join(tmpDir, 'migration.ts'), tsSource);

    const { stdout, stderr } = await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
      cwd: tmpDir,
    });
    expect(stderr).toBe('');
    expect(stdout).toContain('Wrote ops.json + migration.json to ');

    const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
    const ops = JSON.parse(opsJson);

    const expected = await Promise.all(renderOps(calls, testAdapter));
    expect(ops).toEqual(expected);
  });

  it('runs a multi-line sql template exactly as writeMigrationTs writes it, giving renderOps(calls)', {
    timeout: timeouts.coldTransformImport,
  }, async () => {
    const calls = [
      new CreateTableCall(
        'public',
        'profile',
        [
          col('id', 'int4', { notNull: true }),
          col('slug', 'text', { default: fn("lower(\n  'a' || 'b'\n)") }),
        ],
        [
          primaryKey(['id']),
          checkExpression(
            'profile_valid',
            `"id" > 0\n  AND length("slug") < 280\n  AND "slug" <> '  x'`,
          ),
        ],
      ),
    ];
    const migration = new TypeScriptRenderablePostgresMigration(
      calls,
      META,
      APP_SPACE_ID,
      SNAPSHOTS_IMPORT_PATH,
      testAdapter,
    );

    const written = await formatMigrationTs(migration.renderTypeScript(keepInternalSpecifiers));
    expect(written).toContain('sql`\n');
    await writeFile(join(tmpDir, 'migration.ts'), rewriteImports(written));

    const { stderr } = await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
      cwd: tmpDir,
    });
    expect(stderr).toBe('');

    const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));
    const expected = JSON.parse(JSON.stringify(await Promise.all(renderOps(calls, testAdapter))));
    expect(ops).toEqual(expected);
  });

  it('renders an empty calls list whose executed scaffold emits []', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const migration = new TypeScriptRenderablePostgresMigration(
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

  it('rendered RLS-policy migration source typechecks against the live migration surface', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    // The failure mode under test: `createRlsPolicy`'s parameter accepts the
    // rendered literal shape, which omits absent keys — `withCheck` for a
    // SELECT policy, `prefix` for an exact policy. A required-key parameter
    // type makes every generated RLS migration a TypeScript error in the
    // user's project, which execution round-trips (tsx strips types) can
    // never catch.
    const calls = [
      new CreatePostgresRlsPolicyCall(
        'public',
        'user',
        new PostgresRlsPolicy({
          naming: { kind: 'wire', prefix: 'tenant_read', hash: 'f8d5e783' },
          tableName: 'user',
          namespaceId: 'public',
          operation: 'select',
          roles: ['app_user'],
          using: '(tenant_id = 1)',
          withCheck: undefined,
          permissive: true,
        }),
      ),
      new CreatePostgresRlsPolicyCall(
        'public',
        'user',
        new PostgresRlsPolicy({
          naming: { kind: 'exact', name: 'Tenant members can read' },
          tableName: 'user',
          namespaceId: 'public',
          operation: 'select',
          roles: ['app_user'],
          using: '(tenant_id = 1)',
          withCheck: undefined,
          permissive: true,
        }),
      ),
    ];
    const migration = new TypeScriptRenderablePostgresMigration(
      calls,
      META,
      APP_SPACE_ID,
      SNAPSHOTS_IMPORT_PATH,
      testAdapter,
    );

    await writeTypecheckDir(tmpDir, migration.renderTypeScript(keepInternalSpecifiers));
    // Non-zero exit (a type error in the rendered source) rejects.
    await execFileAsync(tscPath, ['--project', tmpDir]);
  });

  it('the typecheck catches a rendered literal missing a required key (negative control)', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const migration = new TypeScriptRenderablePostgresMigration(
      [
        new CreatePostgresRlsPolicyCall(
          'public',
          'user',
          new PostgresRlsPolicy({
            naming: { kind: 'exact', name: 'Tenant members can read' },
            tableName: 'user',
            namespaceId: 'public',
            operation: 'select',
            roles: ['app_user'],
            using: '(tenant_id = 1)',
            withCheck: undefined,
            permissive: true,
          }),
        ),
      ],
      META,
      APP_SPACE_ID,
      SNAPSHOTS_IMPORT_PATH,
      testAdapter,
    );

    // Delete the policy's required `naming` key from the rendered source —
    // the compile must fail on the missing property, proving the green run of
    // the sibling test is a real typecheck and not a vacuous pass.
    const rendered = migration.renderTypeScript(keepInternalSpecifiers);
    expect(rendered).toContain('naming: { kind: "exact", name: "Tenant members can read" },');
    const brokenSource = rendered.replace(
      '        naming: { kind: "exact", name: "Tenant members can read" },\n',
      '',
    );
    expect(brokenSource).not.toContain('Tenant members can read');
    await writeTypecheckDir(tmpDir, brokenSource);

    const failure = await execFileAsync(tscPath, ['--project', tmpDir]).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeDefined();
    expect(String((failure as { stdout?: string }).stdout)).toContain(
      "Property 'naming' is missing",
    );
  });

  it('preserves RawSqlCall ops byte-for-byte through the render → execute round-trip', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const op = {
      id: 'raw.custom.1',
      label: 'raw custom 1',
      operationClass: 'additive' as const,
      target: { id: 'postgres' as const },
      precheck: [],
      execute: [{ description: 'do thing', sql: 'SELECT 1' }],
      postcheck: [],
      meta: { note: 'preserved' },
    };
    const calls = [new RawSqlCall(op)];
    const migration = new TypeScriptRenderablePostgresMigration(
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
  it('a migration file written with sql values produces the same ops.json as one written with strings', {
    timeout: timeouts.repeatedScriptRuns,
  }, async () => {
    const stringSource = handWrittenMigration(asStringLiteral);
    const sqlSource = handWrittenMigration(asSqlTemplate);
    expect(sqlSource).toContain('withCheck: sql`\n');

    const run = async (source: string) => {
      await writeFile(join(tmpDir, 'migration.ts'), rewriteImports(source));
      const { stderr } = await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
        cwd: tmpDir,
      });
      expect(stderr).toBe('');
      return readFile(join(tmpDir, 'ops.json'), 'utf-8');
    };
    const fromStrings = await run(stringSource);
    const fromSql = await run(sqlSource);

    expect(fromStrings).toContain('length(\\"id\\") < 64');
    expect(fromStrings).toContain('NOT \\"locked\\"');
    expect(fromSql).toBe(fromStrings);
  });

  it('a migration file written with sql values typechecks against the live migration surface', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    await writeTypecheckDir(tmpDir, handWrittenMigration(asSqlTemplate));
    await execFileAsync(tscPath, ['--project', tmpDir]);
  });
});

function asStringLiteral(text: string): string {
  return JSON.stringify(text);
}

function asSqlTemplate(text: string): string {
  if (!text.includes('\n')) return `sql\`${text}\``;
  const lines = text.split('\n').map((line) => `          ${line}`);
  return `sql\`\n${lines.join('\n')}\n        \``;
}

function handWrittenMigration(write: (text: string) => string): string {
  const operations = [
    `this.createTable({ schema: "public", table: "account", columns: [col("id", "text", { notNull: true }), col("created", "timestamptz", { default: fn(${write('now()')}) })], constraints: [primaryKey(["id"]), checkExpression("account_id_check", ${write(`"id" <> ''\n  AND length("id") < 64`)})] }),`,
    `this.addCheckConstraint({ schema: "public", table: "account", constraint: "account_id_format", expression: ${write(`"id" ~ '^[a-z]'`)} }),`,
    `this.createIndex({ schema: "public", table: "account", index: "account_id_lower", expression: ${write('lower("id")')}, extras: { where: ${write(`"id" <> 'system'`)} } }),`,
    `this.createRlsPolicy({ schema: "public", table: "account", policy: { naming: { kind: "wire", prefix: "account_owner", hash: "ab12cd34" }, tableName: "account", namespaceId: "public", operation: "all", roles: ["authenticated"], using: ${write('"userId" = auth.uid()')}, withCheck: ${write(`"userId" = auth.uid()\n  AND NOT "locked"`)}, permissive: true } }),`,
    `this.alterColumnType({ schema: "public", table: "account", column: "id", type: "text", using: ${write('"id"::text')} }),`,
    `this.addColumnWithTemporaryDefault({ schema: "public", table: "account", column: "title", type: "text", temporaryDefault: ${write("''")} }),`,
  ].join('\n');
  const scaffold = new TypeScriptRenderablePostgresMigration(
    [],
    META,
    APP_SPACE_ID,
    SNAPSHOTS_IMPORT_PATH,
  ).renderTypeScript(keepInternalSpecifiers);
  const source = scaffold
    .replace(
      'import { Migration, MigrationCLI }',
      'import { Migration, MigrationCLI, checkExpression, col, fn, primaryKey, sql }',
    )
    .replace('    return [\n\n    ];', `    return [\n${operations}\n    ];`);
  expect(source).toContain(operations);
  expect(source).toContain('primaryKey, sql }');
  return source;
}
