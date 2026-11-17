/**
 * TypeScript-rendering coverage for the Postgres migration IR call classes:
 *
 * - Each `*Call` emits the expected TypeScript expression and the
 *   `importRequirements()` it depends on.
 * - `DataTransformCall` renders its body as `() => placeholder("slot")`
 *   closures around the authored slot names.
 * - `renderCallsToTypeScript` deduplicates + sorts imports across a mixed
 *   call list and embeds the supplied from/to hashes in `describe()`.
 *
 * Construction + per-class `toOp()` lowering are covered in
 * op-factory-call.construction.test.ts; multi-call op lowering and the
 * `TypeScriptRenderablePostgresMigration` wrapper are covered in
 * op-factory-call.lowering.test.ts.
 */

import { col, fn, lit, primaryKey } from '@internal/sql-relational-core/contract-free';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import {
  AddColumnCall,
  AddForeignKeyCall,
  AlterColumnTypeCall,
  CreateIndexCall,
  CreateTableCall,
  DataTransformCall,
  DropTableCall,
  SetDefaultCall,
} from '@internal/target-postgres/op-factory-call';
import { renderCallsToTypeScript } from '@internal/target-postgres/render-typescript';
import { describe, expect, it } from 'vitest';

const SNAPSHOTS_IMPORT_PATH = '../../snapshots';
const FROM_HEX = 'c'.repeat(64);
const TO_HEX = 'd'.repeat(64);
const META = {
  from: FROM_HEX,
  to: TO_HEX,
  snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
} as const;

describe('Postgres call classes - SetDefaultCall rendering', () => {
  it('SetDefaultCall emits this.setDefault({...}) with the column and never the operation class', () => {
    const column = col('created_at', 'timestamptz', { default: fn('now()') });
    const additive = new SetDefaultCall('public', 'user', column, 'additive');
    const widening = new SetDefaultCall('public', 'user', column, 'widening');
    expect({
      additive: additive.renderTypeScript(),
      widening: widening.renderTypeScript(),
      imports: additive.importRequirements().map((requirement) => requirement.symbol),
    }).toEqual({
      additive:
        'this.setDefault({ schema: "public", table: "user", column: col("created_at", "timestamptz", { default: fn(sql`now()`) }) })',
      widening:
        'this.setDefault({ schema: "public", table: "user", column: col("created_at", "timestamptz", { default: fn(sql`now()`) }) })',
      imports: ['col', 'fn', 'sql'],
    });
  });
});

describe('Postgres call classes - per-class renderTypeScript coverage', () => {
  const migrationModule = '@internal/postgres/migration';

  it('CreateTableCall emits this.createTable({...}) with col() columns; omits constraints when absent', () => {
    const withoutConstraints = new CreateTableCall('public', 'user', [
      col('id', 'text', { notNull: true }),
    ]);
    expect(withoutConstraints.renderTypeScript()).toBe(
      'this.createTable({ schema: "public", table: "user", columns: [col("id", "text", { notNull: true })] })',
    );
    expect(withoutConstraints.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'col' },
    ]);

    const withPk = new CreateTableCall(
      'public',
      'user',
      [col('id', 'text', { notNull: true })],
      [primaryKey(['id'])],
    );
    expect(withPk.renderTypeScript()).toBe(
      'this.createTable({ schema: "public", table: "user", columns: [col("id", "text", { notNull: true })], constraints: [primaryKey(["id"])] })',
    );
    expect(withPk.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'col' },
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'primaryKey' },
    ]);
  });

  it('CreateTableCall omits schema option when schema is __unbound__', () => {
    const call = new CreateTableCall('__unbound__', 'item', [col('id', 'text', { notNull: true })]);
    expect(call.renderTypeScript()).toBe(
      'this.createTable({ table: "item", columns: [col("id", "text", { notNull: true })] })',
    );
  });

  it('CreateTableCall includes lit() and fn() imports when columns have defaults', () => {
    const call = new CreateTableCall('public', 'user', [
      col('id', 'integer', { notNull: true, default: lit(0) }),
    ]);
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'col' },
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'lit' },
    ]);
  });

  it('AddColumnCall emits this.addColumn({...}) and imports col', () => {
    const call = new AddColumnCall('public', 'user', col('email', 'text'), postgresDataTypes);
    expect(call.renderTypeScript()).toBe(
      'this.addColumn({ schema: "public", table: "user", column: col("email", "text") })',
    );
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: migrationModule, symbol: 'col' },
    ]);
  });

  it('AddColumnCall includes codecRef in the rendered col() call when present', () => {
    const codecRef = { codecId: 'pg/uuid@1' };
    const column = col('id', 'uuid', { codecRef });
    const call = new AddColumnCall('public', 'user', column, postgresDataTypes);
    expect(call.renderTypeScript()).toBe(
      'this.addColumn({ schema: "public", table: "user", column: col("id", "uuid", { codecRef: { codecId: "pg/uuid@1" } }) })',
    );

    const callWithTypeParams = new AddColumnCall(
      'public',
      'user',
      col('data', 'jsonb', { codecRef: { codecId: 'pg/json@1', typeParams: { schema: 'v1' } } }),
      postgresDataTypes,
    );
    expect(callWithTypeParams.renderTypeScript()).toContain(
      'codecRef: { codecId: "pg/json@1", typeParams: { schema: "v1" } }',
    );
  });

  const alterAge = (using?: { readonly kind: 'sql'; readonly sql: string }) =>
    new AlterColumnTypeCall({
      ownsAutoincrementSequence: false,
      schemaName: 'public',
      tableName: 'user',
      columnName: 'age',
      type: 'integer',
      dataTypes: postgresDataTypes,
      ...(using === undefined ? {} : { using }),
    });

  it('AlterColumnTypeCall writes an explicit USING clause as a sql template and imports sql', () => {
    const call = alterAge({ kind: 'sql', sql: '"age"::integer' });
    expect({ source: call.renderTypeScript(), imports: call.importRequirements() }).toMatchObject({
      source: expect.stringContaining('using: sql`"age"::integer`'),
      imports: [{ symbol: 'sql' }],
    });
  });

  it('AddForeignKeyCall serializes the full ForeignKeySpec including optional referential actions', () => {
    const minimal = new AddForeignKeyCall('public', 'post', {
      name: 'fk',
      columns: ['a'],
      references: { schema: 'public', table: 'u', columns: ['id'] },
    });
    expect(minimal.renderTypeScript()).toBe(
      'this.addForeignKey({ schema: "public", table: "post", foreignKey: {\n  name: "fk",\n  columns: ["a"],\n  references: { schema: "public", table: "u", columns: ["id"] },\n} })',
    );
    expect(minimal.importRequirements()).toEqual([]);

    const withActions = new AddForeignKeyCall('public', 'post', {
      name: 'post_author_fk',
      columns: ['author_id'],
      references: { schema: 'public', table: 'user', columns: ['id'] },
      onDelete: 'cascade',
      onUpdate: 'restrict',
    });
    expect(withActions.renderTypeScript()).toContain('onDelete: "cascade"');
    expect(withActions.renderTypeScript()).toContain('onUpdate: "restrict"');
  });
});

describe('renderCallsToTypeScript', () => {
  it('deduplicates + sorts imports across a mixed call list and keeps the base Migration import', () => {
    const calls = [
      new CreateTableCall('public', 'user', [col('id', 'text', { notNull: true })]),
      new DropTableCall('public', 'old_user'),
      new AddColumnCall('public', 'user', col('email', 'text'), postgresDataTypes),
      new CreateIndexCall('public', 'user', 'user_email_idx', { columns: ['email'] }),
    ];

    const source = renderCallsToTypeScript(calls, META);

    // All four calls now emit as this.* method calls. Only the col() DDL
    // builder arg to this.addColumn/this.createTable needs a bare import.
    const targetPostgresImports = source
      .split('\n')
      .filter((line) => line.includes("from '@internal/postgres/migration';"));
    expect(targetPostgresImports).toEqual([
      "import { Migration, MigrationCLI, col } from '@internal/postgres/migration';",
    ]);
    expect(source).toContain('this.createTable(');
    expect(source).toContain('this.addColumn(');
    expect(source).toContain('this.dropTable(');
    expect(source).toContain('this.createIndex(');
  });

  it('emits DataTransformCall slots as placeholder closures and contributes placeholder + endContract imports', () => {
    const calls = [new DataTransformCall('Backfill user emails', 'check-emails', 'run-emails')];

    const source = renderCallsToTypeScript(calls, META);

    // `placeholder` is merged with the base `Migration` import (also owned
    // by the target's migration entrypoint) into a single aggregated line.
    // `dataTransform` is no longer imported as a free factory: it is called
    // as `this.dataTransform(...)` so `PostgresMigration` can inject the
    // control adapter.
    expect(source).toContain(
      "import { Migration, MigrationCLI, placeholder } from '@internal/postgres/migration';",
    );
    expect(source).toContain(
      `import endContract from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract.json' with { type: "json" };`,
    );
    const endContractImportLines = source
      .split('\n')
      .filter((line) => line.startsWith('import') && line.includes('endContract'));
    expect(endContractImportLines).toEqual([
      `import endContract from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract.json' with { type: "json" };`,
    ]);
    expect(source).toContain(
      [
        '      this.dataTransform(endContract, "Backfill user emails", {',
        '        check: () => placeholder("check-emails"),',
        '        run: () => placeholder("run-emails"),',
        '      })',
      ].join('\n'),
    );
  });

  it('renders CreateTableCall as this.createTable({...}) with col() columns in the scaffold', () => {
    const calls = [
      new CreateTableCall('public', 'bug', [
        col('severity', 'text', { notNull: true }),
        col('stepsToRepro', 'text'),
      ]),
      new CreateTableCall(
        'public',
        'item',
        [col('tenant_id', 'uuid', { notNull: true }), col('id', 'uuid', { notNull: true })],
        [primaryKey(['tenant_id', 'id'])],
      ),
    ];
    const source = renderCallsToTypeScript(calls, META);
    // The scaffold must emit the method form with contract-free col() builders.
    expect(source).toContain('this.createTable({');
    expect(source).toContain('col("severity", "text"');
    expect(source).toContain('col("stepsToRepro", "text")');
    expect(source).toContain('col("tenant_id", "uuid"');
    expect(source).toContain('primaryKey(["tenant_id", "id"])');
    // Must not embed a raw SQL string.
    expect(source).not.toMatch(/this\.createTable\(.*CREATE TABLE/s);
  });
});
