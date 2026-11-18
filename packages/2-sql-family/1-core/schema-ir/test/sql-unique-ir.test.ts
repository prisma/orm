import { describe, expect, it } from 'vitest';

import { SqlUniqueIR } from '../src/ir/sql-unique-ir';

describe('SqlUniqueIR', () => {
  it('does not alias caller-owned column arrays', () => {
    const columns: string[] = ['a', 'b'];
    const unique = new SqlUniqueIR({ columns });
    columns.push('c');
    expect(unique.columns).toEqual(['a', 'b']);
  });

  it('id is derived from the column tuple, not name', () => {
    const unique = new SqlUniqueIR({ columns: ['email'], name: 'uq_users_email' });
    expect(unique.id).toBe('unique:email');
  });

  it('two unnamed uniques on the same columns share the same id', () => {
    const a = new SqlUniqueIR({ columns: ['tenant_id', 'email'] });
    const b = new SqlUniqueIR({ columns: ['tenant_id', 'email'] });
    expect(a.id).toBe(b.id);
  });

  it('children is empty (a unique constraint is a leaf)', () => {
    const unique = new SqlUniqueIR({ columns: ['email'] });
    expect(unique.children()).toEqual([]);
  });

  describe('isEqualTo', () => {
    it('true when the column tuple matches', () => {
      const a = new SqlUniqueIR({ columns: ['email'] });
      const b = new SqlUniqueIR({ columns: ['email'] });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('false when the column tuple differs', () => {
      const a = new SqlUniqueIR({ columns: ['email'] });
      const b = new SqlUniqueIR({ columns: ['username'] });
      expect(a.isEqualTo(b)).toBe(false);
    });
  });

  describe('dependsOn', () => {
    const dependsOn = [
      [
        { nodeKind: 'sql-schema', id: 'database' },
        { nodeKind: 'sql-table', id: 'users' },
        { nodeKind: 'sql-column', id: 'column:email' },
      ],
    ];

    it('is readable, non-enumerable, and ignored by isEqualTo', () => {
      const withDeps = new SqlUniqueIR({ columns: ['email'], dependsOn });
      const without = new SqlUniqueIR({ columns: ['email'] });
      expect(withDeps.dependsOn).toEqual(dependsOn);
      expect(without.dependsOn).toBeUndefined();
      expect(Object.keys(withDeps)).not.toContain('dependsOn');
      expect(JSON.parse(JSON.stringify(withDeps))).not.toHaveProperty('dependsOn');
      expect(withDeps.isEqualTo(without)).toBe(true);
    });
  });
});
