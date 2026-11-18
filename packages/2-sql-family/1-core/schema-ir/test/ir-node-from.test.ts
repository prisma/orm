import { describe, expect, it } from 'vitest';
import { PrimaryKey } from '../src/ir/primary-key';
import { SqlCheckConstraintIR } from '../src/ir/sql-check-constraint-ir';
import { SqlIndexIR } from '../src/ir/sql-index-ir';
import { SqlTableIR } from '../src/ir/sql-table-ir';
import { computeCheckContentHash } from '../src/naming';

const expression = `"email" <> ''`;
const checkInput = {
  naming: { kind: 'wire', prefix: 'users_email_check', hash: computeCheckContentHash(expression) },
  expression,
  dependsOn: undefined,
} as const;
const indexInput = {
  naming: { kind: 'exact', name: 'users_email_idx' },
  columns: ['email'],
  where: undefined,
  unique: false,
  partial: false,
  type: undefined,
  options: undefined,
  annotations: undefined,
  dependsOn: undefined,
} as const;

describe('schema-IR node from() factories', () => {
  describe('PrimaryKey', () => {
    it('constructs from raw input', () => {
      expect(PrimaryKey.from({ columns: ['id'] })).toBeInstanceOf(PrimaryKey);
    });

    it('returns an existing instance by identity', () => {
      const pk = new PrimaryKey({ columns: ['id'] });
      expect(PrimaryKey.from(pk)).toBe(pk);
    });
  });

  describe('SqlIndexIR', () => {
    it('constructs from raw input', () => {
      expect(SqlIndexIR.from(indexInput)).toBeInstanceOf(SqlIndexIR);
    });

    it('returns an existing instance by identity', () => {
      const index = new SqlIndexIR(indexInput);
      expect(SqlIndexIR.from(index)).toBe(index);
    });
  });

  describe('SqlCheckConstraintIR', () => {
    it('constructs from raw input', () => {
      expect(SqlCheckConstraintIR.from(checkInput)).toBeInstanceOf(SqlCheckConstraintIR);
    });

    it('returns an existing instance by identity', () => {
      const check = new SqlCheckConstraintIR(checkInput);
      expect(SqlCheckConstraintIR.from(check)).toBe(check);
    });
  });

  it('SqlTableIR hydrates raw inputs and instances alike', () => {
    const raw = new SqlTableIR({
      name: 'users',
      columns: { email: { name: 'email', typeText: 'text', nullable: false } },
      primaryKey: { columns: ['email'] },
      foreignKeys: [],
      uniques: [],
      indexes: [indexInput],
      checks: [checkInput],
    });
    const carriedPrimaryKey = raw.primaryKey;
    if (carriedPrimaryKey === undefined) throw new Error('expected a primary key');
    const rehydrated = new SqlTableIR({
      name: 'users',
      columns: { email: { name: 'email', typeText: 'text', nullable: false } },
      primaryKey: carriedPrimaryKey,
      foreignKeys: [],
      uniques: [],
      indexes: raw.indexes,
      checks: raw.checks ?? [],
    });

    expect(raw.primaryKey).toBeInstanceOf(PrimaryKey);
    expect(raw.indexes[0]).toBeInstanceOf(SqlIndexIR);
    expect(raw.checks?.[0]).toBeInstanceOf(SqlCheckConstraintIR);

    expect(rehydrated.primaryKey).toBe(raw.primaryKey);
    expect(rehydrated.indexes[0]).toBe(raw.indexes[0]);
    expect(rehydrated.checks?.[0]).toBe(raw.checks?.[0]);
  });
});
