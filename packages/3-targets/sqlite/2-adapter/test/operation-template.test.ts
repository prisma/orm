import { DatabaseSync } from 'node:sqlite';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyExpression,
  ColumnRef,
  LiteralExpr,
  OperationExpr,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { renderLoweredSql } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract: SqliteContract = {
  ...createContract<SqlStorage>({ target: 'sqlite', targetFamily: 'sql' }),
  target: 'sqlite',
};

function selectOperation(template: string, args: ReadonlyArray<AnyExpression>): SelectAst {
  return SelectAst.from(TableSource.named('item')).withProjection([
    ProjectionItem.of(
      'value',
      new OperationExpr({
        method: 'join',
        self: ColumnRef.of('item', 'name'),
        args,
        returns: { codecId: 'sqlite/text@1', nullable: false },
        lowering: { targetFamily: 'sql', template },
      }),
    ),
  ]);
}

function lowerSql(ast: SelectAst): string {
  return renderLoweredSql(ast, contract, sqliteCodecDescriptorRegistry).sql;
}

describe('SQLite operation templates', () => {
  it('writes a literal argument containing replacement patterns unchanged', () => {
    const ast = selectOperation('{{self}} || {{arg0}}', [LiteralExpr.of("-$&-$'-$$-")]);
    const database = new DatabaseSync(':memory:');
    database.exec(`CREATE TABLE item (name TEXT NOT NULL); INSERT INTO item VALUES ('a');`);

    expect(lowerSql(ast)).toBe(`SELECT "item"."name" || '-$&-$''-$$-' AS "value" FROM "item"`);
    expect(
      database
        .prepare(lowerSql(ast))
        .all()
        .map((row) => ({ ...row })),
    ).toEqual([{ value: "a-$&-$'-$$-" }]);
    database.close();
  });

  it('does not substitute a token that appears inside an argument', () => {
    const ast = selectOperation('{{self}} || {{arg0}} || {{arg1}}', [
      LiteralExpr.of('{{arg1}}'),
      LiteralExpr.of('!'),
    ]);

    expect(lowerSql(ast)).toBe(`SELECT "item"."name" || '{{arg1}}' || '!' AS "value" FROM "item"`);
  });

  it('rejects a template that references a missing argument', () => {
    expect(() => lowerSql(selectOperation('f({{self}}, {{arg0}})', []))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        meta: { method: 'join' },
      }),
    );
  });
});
