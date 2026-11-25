import { DatabaseSync } from 'node:sqlite';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { describe, expect, it } from 'vitest';
import { createTestSqliteControlAdapter } from './helpers/test-control-adapter';

function ownKeys(record: object | undefined): unknown {
  return {
    prototypeIsPlain: Object.getPrototypeOf(record) === Object.prototype,
    keys: Object.keys(record ?? {}),
  };
}

describe('SQLite introspection of names every object has as a property', () => {
  it('keeps tables and columns named __proto__ and constructor as own keys', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(
      'CREATE TABLE "__proto__" (id INTEGER PRIMARY KEY, "__proto__" TEXT, "constructor" TEXT)',
    );
    db.exec('CREATE TABLE "constructor" (id INTEGER PRIMARY KEY)');
    const driver = {
      familyId: 'sql' as const,
      targetId: 'sqlite' as const,
      async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
        const rows = db
          .prepare(sql)
          .all(...((params ?? []) as Array<string | number | null>)) as Row[];
        return { rows };
      },
      async close() {
        db.close();
      },
    };
    const schema = await createTestSqliteControlAdapter(
      createSqliteBuiltinCodecLookup(),
    ).introspect(driver);
    const protoTable = Object.getOwnPropertyDescriptor(schema.tables, '__proto__')?.value as
      | { columns: object }
      | undefined;
    expect({
      tables: ownKeys(schema.tables),
      columns: ownKeys(protoTable?.columns),
    }).toEqual({
      tables: { prototypeIsPlain: true, keys: ['__proto__', 'constructor'] },
      columns: { prototypeIsPlain: true, keys: ['id', '__proto__', 'constructor'] },
    });
    await driver.close();
  });
});
