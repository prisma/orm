import { describe, expect, it } from 'vitest';
import { DdlColumn, FunctionColumnDefault, LiteralColumnDefault } from '../../src/exports/ast';
import {
  checkExpression,
  col,
  fn,
  foreignKey,
  lit,
  primaryKey,
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
    expect(value.expression).toBe("datetime('now')");
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
      expression: 'age >= 0',
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
