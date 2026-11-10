import { sql } from '@internal/sql-contract/sql-expression';
import { describe, expect, it } from 'vitest';
import {
  DdlColumn,
  FunctionColumnDefault,
  LiteralColumnDefault,
  opaqueSql,
} from '../../src/exports/ast';
import {
  checkExpression,
  col,
  fn,
  foreignKey,
  lit,
  primaryKey,
  type SqlTextInput,
  sqlTextOf,
  unique,
} from '../../src/exports/contract-free';

describe('contract-free column helpers', () => {
  it('lit produces a frozen LiteralColumnDefault', () => {
    const value = lit('app');
    expect(value).toBeInstanceOf(LiteralColumnDefault);
    expect(value.kind).toBe('literal');
    expect(value.value).toBe('app');
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('fn produces a frozen FunctionColumnDefault', () => {
    const value = fn("datetime('now')");
    expect(value).toBeInstanceOf(FunctionColumnDefault);
    expect(value.kind).toBe('function');
    expect(value.expression).toEqual(opaqueSql("datetime('now')"));
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('col builds a frozen DdlColumn with optional flags', () => {
    const column = col('id', 'bigserial', {
      primaryKey: true,
      default: fn('now()'),
    });
    expect(column).toBeInstanceOf(DdlColumn);
    expect(column.name).toBe('id');
    expect(column.type).toBe('bigserial');
    expect(column.primaryKey).toBe(true);
    expect(column.default).toBeInstanceOf(FunctionColumnDefault);
    expect(Object.isFrozen(column)).toBe(true);
  });

  it('rejects invalid literal input', () => {
    expect(() => lit(Symbol('x') as unknown as string)).toThrow(/Invalid column default literal/);
  });
});

describe('contract-free table constraint helpers', () => {
  it('primaryKey carries its column tuple, named or anonymous', () => {
    expect({
      anonymous: { ...primaryKey(['id']) },
      named: { ...primaryKey(['tenant_id', 'id'], { name: 'user_pkey' }) },
    }).toEqual({
      anonymous: { kind: 'primary-key', columns: ['id'], name: undefined },
      named: { kind: 'primary-key', columns: ['tenant_id', 'id'], name: 'user_pkey' },
    });
  });

  it('foreignKey carries its referenced coordinates and referential actions', () => {
    expect({
      ...foreignKey(['user_id'], 'user', ['id'], {
        name: 'post_user_fk',
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
    }).toEqual({
      kind: 'foreign-key',
      columns: ['user_id'],
      refTable: 'user',
      refColumns: ['id'],
      name: 'post_user_fk',
      onDelete: 'cascade',
      onUpdate: 'restrict',
    });
  });

  it('foreignKey leaves the referential actions undeclared when none are given', () => {
    expect({ ...foreignKey(['user_id'], 'user', ['id']) }).toEqual({
      kind: 'foreign-key',
      columns: ['user_id'],
      refTable: 'user',
      refColumns: ['id'],
      name: undefined,
      onDelete: undefined,
      onUpdate: undefined,
    });
  });

  it('unique carries its column tuple, named or anonymous', () => {
    expect({
      anonymous: { ...unique(['email']) },
      named: { ...unique(['email'], { name: 'user_email_key' }) },
    }).toEqual({
      anonymous: { kind: 'unique', columns: ['email'], name: undefined },
      named: { kind: 'unique', columns: ['email'], name: 'user_email_key' },
    });
  });

  it('checkExpression carries its name and predicate verbatim', () => {
    expect({ ...checkExpression('user_age_check', 'age >= 0') }).toEqual({
      kind: 'check-expression',
      name: 'user_age_check',
      expression: opaqueSql('age >= 0'),
    });
  });

  it('freezes every constraint and copies caller-owned column arrays', () => {
    const columns = ['id'];
    const constraint = primaryKey(columns);
    columns.push('tenant_id');

    expect({
      frozen: [
        primaryKey(['id']),
        foreignKey(['user_id'], 'user', ['id']),
        unique(['email']),
        checkExpression('c', 'x > 0'),
      ].map(Object.isFrozen),
      columnsUnaffected: constraint.columns,
    }).toEqual({ frozen: [true, true, true, true], columnsUnaffected: ['id'] });
  });
});

describe('sql values in contract-free helpers', () => {
  it('fn and checkExpression read a sql value as its text', () => {
    expect({
      fn: fn(sql`datetime('now')`).expression,
      check: checkExpression(
        'user_age_check',
        sql`
        age >= 0
          AND age < 200
      `,
      ).expression,
    }).toEqual({
      fn: opaqueSql("datetime('now')"),
      check: opaqueSql('age >= 0\n  AND age < 200'),
    });
  });

  it('sqlTextOf returns a string unchanged', () => {
    expect(sqlTextOf('  lower("email")  ', 'index expression')).toBe('  lower("email")  ');
  });

  it('sqlTextOf rebuilds a sql value another installed copy made, canonicalizing its text', () => {
    const fromAnotherCopy = {
      [Symbol.for('@prisma/sql-expression')]: true,
      text: '\n    "userId" = auth.uid()\n      AND NOT "locked"\n  ',
    } as unknown as SqlTextInput;

    expect(sqlTextOf(fromAnotherCopy, 'policy using')).toBe(
      '"userId" = auth.uid()\n  AND NOT "locked"',
    );
  });

  it('sqlTextOf refuses a value that is neither a string nor a sql value, naming the argument', () => {
    expect(() => sqlTextOf({ text: 'now()' } as unknown as SqlTextInput, 'policy using')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: 'policy using must be a string or a sql`...` value.',
        meta: { what: 'policy using' },
      }),
    );
  });

  it('fn and checkExpression name their argument when they refuse a value', () => {
    const notSql = { text: 'now()' } as unknown as SqlTextInput;

    expect(() => fn(notSql)).toThrow('fn expression must be a string or a sql`...` value.');
    expect(() => checkExpression('user_age_check', notSql)).toThrow(
      'checkExpression "user_age_check" expression must be a string or a sql`...` value.',
    );
  });
});
