import { col, fn } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import { CreateTableCall, DropTableCall } from '../../src/core/migrations/op-factory-call';
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
