import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  InsertAst,
  InsertOnConflict,
  ParamRef,
  ProjectionItem,
  TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { createContract } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderLoweredSql } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract: SqliteContract = {
  ...createContract<SqlStorage>({ target: 'sqlite', targetFamily: 'sql' }),
  target: 'sqlite',
};

const item = TableSource.named('item', 'i');
const column = (name: string) => ColumnRef.of('i', name);
const returning = (...names: string[]) =>
  names.map((name) => ProjectionItem.of(name, column(name)));

function insertOne(id: number, name: string, n: number): InsertAst {
  return InsertAst.into(item).withRows([
    { id: ParamRef.of(id), name: ParamRef.of(name), n: ParamRef.of(n) },
  ]);
}

describe('write statements on an aliased target, run against SQLite', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec('CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT UNIQUE, n INTEGER)');
  });

  afterEach(() => {
    database.close();
  });

  function run(ast: AnyQueryAst): unknown[] {
    const { sql, params } = renderLoweredSql(ast, contract, sqliteCodecDescriptorRegistry);
    const values = params.map((param) =>
      param.kind === 'literal' ? (param.value as SQLInputValue) : null,
    );
    return database
      .prepare(sql)
      .all(...values)
      .map((row) => ({ ...row }));
  }

  function rows(): unknown[] {
    return database
      .prepare('SELECT id, name, n FROM item ORDER BY id')
      .all()
      .map((row) => ({ ...row }));
  }

  it('inserts and returns its columns', () => {
    expect(run(insertOne(1, 'a', 1).withReturning(returning('id', 'name')))).toEqual([
      { id: 1, name: 'a' },
    ]);
    expect(rows()).toEqual([{ id: 1, name: 'a', n: 1 }]);
  });

  it('updates the conflicting row from excluded and returns it', () => {
    run(insertOne(1, 'a', 1));

    const upsert = insertOne(2, 'a', 5)
      .withOnConflict(
        InsertOnConflict.on([column('name')]).doUpdateSet({ n: ColumnRef.of('excluded', 'n') }),
      )
      .withReturning(returning('id', 'n'));

    expect(run(upsert)).toEqual([{ id: 1, n: 5 }]);
    expect(rows()).toEqual([{ id: 1, name: 'a', n: 5 }]);
  });

  it('updates the rows its condition on the alias matches and returns them', () => {
    run(insertOne(1, 'a', 1));
    run(insertOne(2, 'b', 2));

    const update = UpdateAst.table(item)
      .withSet({ n: ParamRef.of(9) })
      .withWhere(BinaryExpr.eq(column('id'), ParamRef.of(2)))
      .withReturning(returning('id', 'n'));

    expect(run(update)).toEqual([{ id: 2, n: 9 }]);
    expect(rows()).toEqual([
      { id: 1, name: 'a', n: 1 },
      { id: 2, name: 'b', n: 9 },
    ]);
  });

  it('deletes the rows its condition on the alias matches and returns them', () => {
    run(insertOne(1, 'a', 1));
    run(insertOne(2, 'b', 2));

    const del = DeleteAst.from(item)
      .withWhere(BinaryExpr.eq(column('id'), ParamRef.of(1)))
      .withReturning(returning('id'));

    expect(run(del)).toEqual([{ id: 1 }]);
    expect(rows()).toEqual([{ id: 2, name: 'b', n: 2 }]);
  });
});
