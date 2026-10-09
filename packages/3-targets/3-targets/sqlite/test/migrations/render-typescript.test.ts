import { col, fn, lit } from '@internal/sql-relational-core/contract-free';
import { TsExpression } from '@internal/ts-render';
import { describe, expect, it } from 'vitest';
import * as opFactoryCalls from '../../src/core/migrations/op-factory-call';
import {
  AddColumnCall,
  CreateIndexCall,
  CreateTableCall,
  DataTransformCall,
  DropColumnCall,
  DropIndexCall,
  DropTableCall,
  RawSqlCall,
  RecreateTableCall,
  RenameColumnCall,
  RenameTableCall,
} from '../../src/core/migrations/op-factory-call';
import type { SqliteColumnSpec } from '../../src/core/migrations/operations/shared';
import { renderCallsToTypeScript } from '../../src/core/migrations/render-typescript';

const SNAPSHOTS_IMPORT_PATH = '../../snapshots';
const FROM_HASH = 'a'.repeat(64);
const TO_HASH = 'b'.repeat(64);
const FROM_HEX = 'a'.repeat(64);
const TO_HEX = 'b'.repeat(64);

const renderTypeScript = (
  calls: Parameters<typeof renderCallsToTypeScript>[0],
  meta: Parameters<typeof renderCallsToTypeScript>[1],
) => renderCallsToTypeScript(calls, meta);

describe('renderCallsToTypeScript (sqlite)', () => {
  it('emits contract-JSON imports + fields and Migration<Start, End> header (with-start)', () => {
    const output = renderTypeScript([new DropTableCall('stale')], {
      from: FROM_HASH,
      to: TO_HASH,
      snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
    });

    expect(output).toContain(
      "import { Migration, MigrationCLI } from '@internal/sqlite/migration';",
    );
    expect(output).toContain(
      `import endContract from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract.json' with { type: "json" };`,
    );
    expect(output).toContain(
      `import startContract from '${SNAPSHOTS_IMPORT_PATH}/${FROM_HEX}/contract.json' with { type: "json" };`,
    );
    expect(output).toContain(
      `import type { Contract as End } from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract';`,
    );
    expect(output).toContain(
      `import type { Contract as Start } from '${SNAPSHOTS_IMPORT_PATH}/${FROM_HEX}/contract';`,
    );
    expect(output).toContain('export default class M extends Migration<Start, End> {');
    expect(output).toContain('override readonly startContractJson = startContract;');
    expect(output).toContain('override readonly endContractJson = endContract;');
    expect(output).toContain('override get operations()');
    expect(output).toContain('MigrationCLI.run(import.meta.url, M);');
  });

  it('does NOT emit a describe() method (the base derives it from the contract JSON)', () => {
    const output = renderTypeScript([new DropTableCall('stale')], {
      from: FROM_HASH,
      to: TO_HASH,
      snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
    });

    expect(output).not.toContain('describe()');
    expect(output).not.toContain(`'${FROM_HASH}'`);
    expect(output).not.toContain(`'${TO_HASH}'`);
    expect(output).not.toContain(`"${FROM_HASH}"`);
    expect(output).not.toContain(`"${TO_HASH}"`);
  });

  it('renders the baseline shape for from: null (no start imports, Migration<never, End>)', () => {
    const output = renderTypeScript([new DropTableCall('stale')], {
      from: null,
      to: TO_HASH,
      snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
    });

    expect(output).toContain('export default class M extends Migration<never, End> {');
    expect(output).toContain('override readonly endContractJson = endContract;');
    expect(output).toContain(
      `import endContract from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract.json' with { type: "json" };`,
    );
    expect(output).toContain(
      `import type { Contract as End } from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract';`,
    );
    expect(output).not.toContain('startContract');
    expect(output).not.toContain('startContractJson');
    expect(output).not.toContain('describe()');
  });

  it('inlines the operation calls unchanged', () => {
    const output = renderTypeScript([new DropTableCall('stale')], {
      from: null,
      to: TO_HASH,
      snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
    });
    expect(output).toContain('this.dropTable({ table: "stale" })');
  });

  it('renders a compilable merged import block when from === to (E4)', () => {
    const output = renderTypeScript([new DropTableCall('stale')], {
      from: TO_HASH,
      to: TO_HASH,
      snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
    });

    expect(output).toContain(
      `import endContract from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract.json' with { type: "json" };`,
    );
    expect(output).toContain(
      `import startContract from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract.json' with { type: "json" };`,
    );
    expect(output).toContain(
      `import type { Contract as End, Contract as Start } from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract';`,
    );
    expect(output).toContain('export default class M extends Migration<Start, End> {');
  });

  it('renders a function default as fn() with a sql template and imports sql', () => {
    const output = renderTypeScript(
      [
        new CreateTableCall('t', [
          col('created', 'TEXT', { notNull: true, default: fn("datetime('now')") }),
        ]),
      ],
      { from: null, to: TO_HASH, snapshotsImportPath: SNAPSHOTS_IMPORT_PATH },
    );

    expect(output).toContain(
      `this.createTable({ table: "t", columns: [col("created", "TEXT", { notNull: true, default: fn(sql\`datetime('now')\`) })] })`,
    );
    expect(output).toContain(
      "import { Migration, MigrationCLI, col, fn, sql } from '@internal/sqlite/migration';",
    );
  });

  it('renders a function default holding both quote kinds as a sql template', () => {
    const output = renderTypeScript(
      [new CreateTableCall('t', [col('label', 'TEXT', { default: fn(`printf("%s", 'x')`) })])],
      { from: null, to: TO_HASH, snapshotsImportPath: SNAPSHOTS_IMPORT_PATH },
    );

    expect(output).toContain(
      'this.createTable({ table: "t", columns: [col("label", "TEXT", { default: fn(sql`printf("%s", \'x\')`) })] })',
    );
  });
});

describe('renderCallsToTypeScript (sqlite) — the sql import', () => {
  const recreateTable = (columns: readonly SqliteColumnSpec[]) =>
    new RecreateTableCall({
      tableName: 'note',
      contractTable: { columns, primaryKey: { columns: ['id'] }, uniques: [], foreignKeys: [] },
      schemaColumnNames: ['id'],
      indexes: [],
      summary: 'Recreates table note',
      postchecks: [{ description: 'verify', sql: `SELECT "a" = 'b'` }],
      operationClass: 'widening',
    });
  const idColumn: SqliteColumnSpec = { name: 'id', typeSql: 'INTEGER', nullable: false };
  const functionDefault = (expression: string): SqliteColumnSpec => ({
    name: 'slug',
    typeSql: 'TEXT',
    default: { kind: 'function', expression },
    nullable: true,
  });

  const oneCallPerClass = [
    new CreateTableCall('note', [
      col('id', 'INTEGER'),
      col('kind', 'TEXT', { default: lit('draft') }),
    ]),
    new DropTableCall('stale'),
    new RenameTableCall('stale', 'archived', []),
    new RenameColumnCall('note', 'title', 'heading', []),
    recreateTable([idColumn]),
    new AddColumnCall('note', { name: 'nickname', typeSql: 'TEXT', nullable: true }),
    new DropColumnCall('note', 'nickname'),
    new CreateIndexCall('note', 'note_kind_idx', ['kind']),
    new DropIndexCall('note', 'note_kind_idx'),
    new DataTransformCall('data_migration.backfill', 'Backfill', 'note', 'kind'),
    new RawSqlCall({
      id: 'raw.custom.1',
      label: 'raw custom 1',
      operationClass: 'additive',
      target: { id: 'sqlite' },
      precheck: [],
      execute: [{ description: 'do thing', sql: 'SELECT 1' }],
      postcheck: [],
    }),
  ];

  const templateCalls = [
    new CreateTableCall('note', [col('created', 'TEXT', { default: fn("datetime('now')") })]),
    new AddColumnCall('note', functionDefault('lower(hex(randomblob(4)))')),
    recreateTable([idColumn, functionDefault('lower(hex(randomblob(4)))')]),
  ];

  const fallbackOnlyCalls = [
    new CreateTableCall('note', [col('created', 'TEXT', { default: fn("  datetime('now')") })]),
    new AddColumnCall('note', functionDefault('lower(\n  x)  ')),
    recreateTable([idColumn, functionDefault('\nx')]),
  ];

  function facadeImportNames(output: string): string[] {
    const facadeImport = output.match(
      /import\s*\{([\s\S]*?)\}\s*from\s*'@internal\/sqlite\/migration';/,
    );
    return (facadeImport?.[1] ?? '').split(',').map((entry) => entry.trim());
  }

  const render = (call: (typeof oneCallPerClass)[number]) =>
    renderTypeScript([call], {
      from: null,
      to: TO_HASH,
      snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
    });

  it('the fixture list covers every op-factory-call class (a new class must be added here)', () => {
    const moduleMembers: unknown[] = Object.values(opFactoryCalls);
    const allCallClasses = moduleMembers.filter(
      (value): value is abstract new () => TsExpression =>
        typeof value === 'function' && value.prototype instanceof TsExpression,
    );
    const covered = new Set(oneCallPerClass.map((call) => call.constructor));
    expect(allCallClasses.filter((cls) => !covered.has(cls)).map((cls) => cls.name)).toEqual([]);
  });

  it.each(
    [...oneCallPerClass, ...templateCalls, ...fallbackOnlyCalls].map((call) => ({
      name: call.constructor.name,
      call,
    })),
  )('$name imports sql exactly when it prints a sql template', ({ call }) => {
    const output = render(call);
    const body = output.slice(output.indexOf('export default class'));

    expect(facadeImportNames(output).includes('sql')).toBe(/\bsql`/.test(body));
  });

  it('prints sql templates only for the calls whose SQL the tag holds', () => {
    const printing = (calls: readonly (typeof oneCallPerClass)[number][]) =>
      calls.filter((call) => /\bsql`/.test(render(call))).length;

    expect({
      oneCallPerClass: printing(oneCallPerClass),
      templateCalls: printing(templateCalls),
      fallbackOnlyCalls: printing(fallbackOnlyCalls),
    }).toEqual({ oneCallPerClass: 0, templateCalls: 3, fallbackOnlyCalls: 0 });
  });
});
