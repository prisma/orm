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
import {
  AddColumnCall,
  AddForeignKeyCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  CreateExtensionCall,
  CreateIndexCall,
  CreateSchemaCall,
  CreateTableCall,
  DataTransformCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropIndexCall,
  DropNotNullCall,
  DropTableCall,
  RawSqlCall,
  SetDefaultCall,
  SetNotNullCall,
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

describe('Postgres call classes - renderTypeScript + importRequirements', () => {
  it('emits this.dropTable({...}) and contributes no imports', () => {
    const call = new DropTableCall('public', 'user');
    expect(call.renderTypeScript()).toBe('this.dropTable({ schema: "public", table: "user" })');
    expect(call.importRequirements()).toEqual([]);
  });

  it('SetDefaultCall emits this.setDefault({...}) with the column, omits operationClass when additive', () => {
    const column = col('created_at', 'timestamptz', { default: fn('now()') });
    const additive = new SetDefaultCall('public', 'user', column);
    const widening = new SetDefaultCall('public', 'user', column, 'widening');
    expect({
      additive: additive.renderTypeScript(),
      widening: widening.renderTypeScript(),
      imports: additive.importRequirements().map((requirement) => requirement.symbol),
    }).toEqual({
      additive: `this.setDefault({ schema: "public", table: "user", column: col("created_at", "timestamptz", { default: fn("now()") }) })`,
      widening: `this.setDefault({ schema: "public", table: "user", column: col("created_at", "timestamptz", { default: fn("now()") }), operationClass: "widening" })`,
      imports: ['col', 'fn'],
    });
  });

  it('DropConstraintCall omits kind when unique, emits it otherwise', () => {
    const unique = new DropConstraintCall('public', 'user', 'user_email_key');
    expect(unique.renderTypeScript()).toBe(
      'this.dropConstraint({ schema: "public", table: "user", constraint: "user_email_key" })',
    );
    expect(unique.importRequirements()).toEqual([]);

    const fk = new DropConstraintCall('public', 'user', 'user_org_fk', 'foreignKey');
    expect(fk.renderTypeScript()).toBe(
      'this.dropConstraint({ schema: "public", table: "user", constraint: "user_org_fk", kind: "foreignKey" })',
    );
  });

  it('DataTransformCall renders slots as placeholder closures and imports only the placeholder facade symbol', () => {
    const call = new DataTransformCall('Backfill', 'check', 'run');

    expect(call.renderTypeScript()).toBe(
      [
        'this.dataTransform(endContract, "Backfill", {',
        '  check: () => placeholder("check"),',
        '  run: () => placeholder("run"),',
        '})',
      ].join('\n'),
    );
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'placeholder' },
    ]);
  });
});

describe('Postgres call classes - per-class renderTypeScript coverage', () => {
  const migrationModule = '@internal/postgres/migration';
  const expectFactoryImport = (
    call: { importRequirements(): readonly unknown[] },
    symbol: string,
  ) => {
    expect(call.importRequirements()).toEqual([{ moduleSpecifier: migrationModule, symbol }]);
  };

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

  it('CreateSchemaCall emits this.createSchema({schema}) and contributes no imports', () => {
    const schema = new CreateSchemaCall('app');
    expect(schema.renderTypeScript()).toBe('this.createSchema({ schema: "app" })');
    expect(schema.importRequirements()).toEqual([]);
  });

  it('AddColumnCall emits this.addColumn({...}) and imports col', () => {
    const call = new AddColumnCall('public', 'user', col('email', 'text'));
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
    const call = new AddColumnCall('public', 'user', column);
    expect(call.renderTypeScript()).toBe(
      'this.addColumn({ schema: "public", table: "user", column: col("id", "uuid", { codecRef: { codecId: "pg/uuid@1" } }) })',
    );

    const callWithTypeParams = new AddColumnCall(
      'public',
      'user',
      col('data', 'jsonb', { codecRef: { codecId: 'pg/json@1', typeParams: { schema: 'v1' } } }),
    );
    expect(callWithTypeParams.renderTypeScript()).toContain(
      'codecRef: { codecId: "pg/json@1", typeParams: { schema: "v1" } }',
    );
  });

  it('codecRef round-trip: col() built from the rendered arguments equals the original DdlColumn', () => {
    const originalCodecRef = { codecId: 'pg/uuid@1' };
    const originalColumn = col('id', 'uuid', { codecRef: originalCodecRef, notNull: true });

    const roundTrippedColumn = col('id', 'uuid', {
      notNull: true,
      codecRef: { codecId: 'pg/uuid@1' },
    });
    expect(roundTrippedColumn).toEqual(originalColumn);
    expect(roundTrippedColumn.codecRef).toEqual(originalCodecRef);
  });

  it('AddColumnCall without codecRef renders col() with no codecRef property', () => {
    const call = new AddColumnCall('public', 'user', col('score', 'integer'));
    expect(call.renderTypeScript()).not.toContain('codecRef');
  });

  it('DropColumnCall emits this.dropColumn({...}) and contributes no imports', () => {
    const call = new DropColumnCall('public', 'user', 'legacy');
    expect(call.renderTypeScript()).toBe(
      'this.dropColumn({ schema: "public", table: "user", column: "legacy" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });

  it('AlterColumnTypeCall emits this.alterColumnType({...}) and contributes no imports', () => {
    const call = new AlterColumnTypeCall('public', 'user', 'age', {
      qualifiedTargetType: 'integer',
      formatTypeExpected: 'integer',
      rawTargetTypeForLabel: 'integer',
    });
    const rendered = call.renderTypeScript();
    expect(rendered.startsWith('this.alterColumnType({')).toBe(true);
    expect(rendered).toContain('table: "user"');
    expect(rendered).toContain('column: "age"');
    expect(rendered).toContain('qualifiedTargetType: "integer"');
    expect(call.importRequirements()).toEqual([]);
  });

  it('AlterColumnTypeCall preserves an explicit USING clause in the options literal', () => {
    const call = new AlterColumnTypeCall('public', 'user', 'age', {
      qualifiedTargetType: 'integer',
      formatTypeExpected: 'integer',
      rawTargetTypeForLabel: 'integer',
      using: '"age"::integer',
    });
    expect(call.renderTypeScript()).toContain('using: "\\"age\\"::integer"');
  });

  it('SetNotNullCall / DropNotNullCall / DropDefaultCall emit this.X({...}) and contribute no imports', () => {
    expect(new SetNotNullCall('public', 'user', 'email').renderTypeScript()).toBe(
      'this.setNotNull({ schema: "public", table: "user", column: "email" })',
    );
    expect(new DropNotNullCall('public', 'user', 'nickname').renderTypeScript()).toBe(
      'this.dropNotNull({ schema: "public", table: "user", column: "nickname" })',
    );
    expect(new DropDefaultCall('public', 'user', 'updated_at').renderTypeScript()).toBe(
      'this.dropDefault({ schema: "public", table: "user", column: "updated_at" })',
    );
    expect(new SetNotNullCall('public', 'user', 'email').importRequirements()).toEqual([]);
    expect(new DropNotNullCall('public', 'user', 'nickname').importRequirements()).toEqual([]);
    expect(new DropDefaultCall('public', 'user', 'updated_at').importRequirements()).toEqual([]);
  });

  it('AddPrimaryKeyCall / AddUniqueCall emit this.X({schema, table, constraint, columns})', () => {
    const pk = new AddPrimaryKeyCall('public', 'user', 'user_pkey', ['id']);
    expect(pk.renderTypeScript()).toBe(
      'this.addPrimaryKey({ schema: "public", table: "user", constraint: "user_pkey", columns: ["id"] })',
    );
    expect(pk.importRequirements()).toEqual([]);

    const uq = new AddUniqueCall('public', 'user', 'user_email_key', ['email']);
    expect(uq.renderTypeScript()).toBe(
      'this.addUnique({ schema: "public", table: "user", constraint: "user_email_key", columns: ["email"] })',
    );
    expect(uq.importRequirements()).toEqual([]);
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

  it('CreateIndexCall / DropIndexCall emit this.X({...}) and contribute no imports', () => {
    const ci = new CreateIndexCall('public', 'user', 'user_email_idx', { columns: ['email'] });
    expect(ci.renderTypeScript()).toBe(
      'this.createIndex({ schema: "public", table: "user", index: "user_email_idx", columns: ["email"] })',
    );
    expect(ci.importRequirements()).toEqual([]);

    const di = new DropIndexCall('public', 'user', 'stale_idx');
    expect(di.renderTypeScript()).toBe(
      'this.dropIndex({ schema: "public", table: "user", index: "stale_idx" })',
    );
    expect(di.importRequirements()).toEqual([]);
  });

  it('CreateIndexCall renders extras when they are provided', () => {
    const ci = new CreateIndexCall(
      'public',
      'doc',
      'doc_body_idx',
      { columns: ['body'] },
      {
        type: 'gin',
        options: { fastupdate: false },
      },
    );
    expect(ci.renderTypeScript()).toBe(
      'this.createIndex({ schema: "public", table: "doc", index: "doc_body_idx", columns: ["body"], extras: { type: "gin", options: { fastupdate: false } } })',
    );
  });

  it('CreateExtensionCall emits a single-arg factory call', () => {
    const ext = new CreateExtensionCall('citext');
    expect(ext.renderTypeScript()).toBe('createExtension("citext")');
    expectFactoryImport(ext, 'createExtension');
  });

  it('RawSqlCall serializes the stored op as a JSON literal and imports rawSql', () => {
    const op = {
      id: 'raw.1',
      label: 'raw 1',
      operationClass: 'additive' as const,
      target: { id: 'postgres' as const },
      precheck: [],
      execute: [{ description: 'do', sql: 'SELECT 1' }],
      postcheck: [],
    };
    const call = new RawSqlCall(op);

    const rendered = call.renderTypeScript();
    expect(rendered.startsWith('rawSql({')).toBe(true);
    expect(rendered).toContain('id: "raw.1"');
    expect(rendered).toContain('sql: "SELECT 1"');
    expectFactoryImport(call, 'rawSql');
  });

  it('RawSqlCall carries the stored op unchanged; operationClass + label mirror the op', () => {
    const op = {
      id: 'raw.widening.1',
      label: 'raw widening label',
      operationClass: 'widening' as const,
      target: { id: 'postgres' as const },
      precheck: [],
      execute: [],
      postcheck: [],
    };
    const call = new RawSqlCall(op);
    expect(call.operationClass).toBe('widening');
    expect(call.label).toBe('raw widening label');
    expect(call.op).toBe(op);
  });
});

describe('renderCallsToTypeScript', () => {
  it('deduplicates + sorts imports across a mixed call list and keeps the base Migration import', () => {
    const calls = [
      new CreateTableCall('public', 'user', [col('id', 'text', { notNull: true })]),
      new DropTableCall('public', 'old_user'),
      new AddColumnCall('public', 'user', col('email', 'text')),
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

  it('derives describe() from contract JSON instead of embedding from/to hashes', () => {
    const source = renderCallsToTypeScript([], META);
    // New shape: from/to are derived by the base from the imported contract JSON
    // (no describe() block, no hash literals).
    expect(source).not.toContain('describe()');
    expect(source).not.toContain(`'${META.from}'`);
    expect(source).not.toContain(`'${META.to}'`);
    expect(source).toContain('export default class M extends Migration<Start, End> {');
    expect(source).toContain('override readonly startContractJson = startContract;');
    expect(source).toContain('override readonly endContractJson = endContract;');
    expect(source).toContain(
      "import { Migration, MigrationCLI } from '@internal/postgres/migration';",
    );
    expect(source).toContain('MigrationCLI.run(import.meta.url, M);');
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
