import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlStorage } from '@internal/sql-contract/types';
import { TableSource } from '@internal/sql-relational-core/ast';
import { cfExpr, table } from '@internal/sql-relational-core/contract-free';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { createContract } from '@repo/test-utils';
import { litParams } from '@repo/test-utils/lowered-params';
import { describe, expect, it } from 'vitest';
import { renderLoweredSql } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract: SqliteContract = {
  ...createContract<SqlStorage>({ target: 'sqlite', targetFamily: 'sql' }),
  target: 'sqlite',
};

const item = table(TableSource.named('item'), {
  id: { codecId: 'sqlite/integer@1', nullable: false },
  name: { codecId: 'sqlite/text@1', nullable: false },
});

function upsertAppending(id: number, name: string, suffix: string) {
  const appended = cfExpr.fn({
    method: 'append',
    template: '{{self}} || {{arg0}}',
    self: cfExpr.columnRef('excluded', 'name'),
    args: [cfExpr.param(suffix, 'sqlite/text@1')],
    returns: { codecId: 'sqlite/text@1', nullable: false },
  });
  return item.upsert({ id, name }).onConflict(item.id).doUpdate({ name: appended.ast }).build();
}

describe('a parameter inside an ON CONFLICT DO UPDATE SET expression on SQLite', () => {
  it('lowers with its own placeholder', () => {
    expect(
      renderLoweredSql(upsertAppending(1, 'b', '!'), contract, sqliteCodecDescriptorRegistry),
    ).toEqual({
      sql: 'INSERT INTO "item" ("id", "name") VALUES (?1, ?2) ON CONFLICT ("id") DO UPDATE SET "name" = excluded."name" || ?3',
      params: litParams(1, 'b', '!'),
    });
  });

  it('writes the expression value when the row conflicts', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO item VALUES (1, 'a');`);
    const { sql, params } = renderLoweredSql(
      upsertAppending(1, 'b', '!'),
      contract,
      sqliteCodecDescriptorRegistry,
    );
    database
      .prepare(sql)
      .run(
        ...params.map((param) =>
          param.kind === 'literal' ? (param.value as SQLInputValue) : null,
        ),
      );

    expect(
      database
        .prepare('SELECT id, name FROM item')
        .all()
        .map((row) => ({ ...row })),
    ).toEqual([{ id: 1, name: 'b!' }]);
    database.close();
  });
});
