import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { codecRefForStorageColumn } from '../src/codec-ref-for-column';
import { InsertAst, type InsertValue, ParamRef, TableSource, UpdateAst } from '../src/exports/ast';
import { type ColumnDescriptor, table } from '../src/exports/contract-free';

const TEXT: ColumnDescriptor = { codecId: 'test/text@1', nullable: true };
const INT: ColumnDescriptor = { codecId: 'test/int@1', nullable: false };

function protoKeyed<Value>(value: Value): Record<string, Value> {
  return Object.fromEntries([['__proto__', value]]);
}

function ownProto(record: object | undefined): unknown {
  return {
    prototypeIsPlain: Object.getPrototypeOf(record) === Object.prototype,
    keys: Object.keys(record ?? {}),
  };
}

describe('a column named like a property every object has', () => {
  it('has no codec when the storage table has no such column', () => {
    const storage = new SqlStorage({
      storageHash: blindCast<SqlStorage['storageHash'], 'test storage hash literal'>('test'),
      namespaces: {
        public: createTestSqlNamespace({
          id: 'public',
          entries: {
            table: {
              users: new StorageTable({
                columns: { id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false } },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
            },
          },
        }),
      },
    });
    expect(codecRefForStorageColumn(storage, 'public', 'users', 'constructor')).toBeUndefined();
  });

  it('is left out of a contract-free update the table has no such column for', () => {
    const things = table(TableSource.named('things'), { id: INT });
    const ast = things
      .update()
      .set(
        blindCast<{ id: number }, 'a value keyed by a name the table lacks'>({ constructor: 'x' }),
      )
      .build();
    expect(ast.set).toEqual({});
  });

  it('inserts no value a contract-free row leaves out', () => {
    const things = table(TableSource.named('things'), { id: INT, constructor: TEXT });
    const ast = things
      .insert(
        blindCast<{ id: number; constructor: null }, 'a row that leaves a column out'>({ id: 1 }),
      )
      .build();
    expect((ast.rows[0]?.['constructor'] as ParamRef | undefined)?.value).toBeUndefined();
  });
});

describe('a rewritten mutation', () => {
  it('keeps an insert value and an update set keyed __proto__ as own keys', () => {
    const things = TableSource.named('things');
    const insert = InsertAst.into(things)
      .withRows([protoKeyed<InsertValue>(ParamRef.of(1))])
      .rewrite({});
    const update = UpdateAst.table(things)
      .withSet(protoKeyed(ParamRef.of(1)))
      .rewrite({});
    expect({ insert: ownProto(insert.rows[0]), update: ownProto(update.set) }).toEqual({
      insert: { prototypeIsPlain: true, keys: ['__proto__'] },
      update: { prototypeIsPlain: true, keys: ['__proto__'] },
    });
  });

  it('keeps a contract-free insert value and update set of a column named __proto__ as own keys', () => {
    const things = table(TableSource.named('things'), {
      id: INT,
      ...Object.fromEntries([['__proto__', TEXT]]),
    });
    const values = blindCast<{ id: number }, 'a row with a column named __proto__'>(
      Object.fromEntries([
        ['id', 1],
        ['__proto__', 'x'],
      ]),
    );
    const insert = things.insert(values).build();
    const update = things.update().set(values).build();
    expect({ insert: ownProto(insert.rows[0]), update: ownProto(update.set) }).toEqual({
      insert: { prototypeIsPlain: true, keys: ['id', '__proto__'] },
      update: { prototypeIsPlain: true, keys: ['id', '__proto__'] },
    });
  });
});
