import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { computeCheckContentHash } from '@internal/sql-schema-ir/naming';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { composeSqlEntityKinds } from '../src/entity-kinds';
import { CheckConstraint } from '../src/ir/check-constraint';
import { StorageTable } from '../src/ir/storage-table';
import { checkConstraintInputFromSerialized } from '../src/serialized-check-constraint';
import { createSqlStorageSchema } from '../src/validators';

const expression = `"role" IN ('user', 'admin')`;
const hash = computeCheckContentHash(expression);
const wireName = `user_role_check_${hash}`;

describe('CheckConstraint', () => {
  it('a wire naming flattens to name + prefix', () => {
    const check = new CheckConstraint({
      naming: { kind: 'wire', prefix: 'user_role_check', hash },
      expression,
    });
    expect({ name: check.name, prefix: check.prefix, expression: check.expression }).toEqual({
      name: wireName,
      prefix: 'user_role_check',
      expression,
    });
  });

  it('an exact naming carries the name verbatim and no prefix', () => {
    const check = new CheckConstraint({
      naming: { kind: 'exact', name: 'user_role_check' },
      expression,
    });
    expect(check.name).toBe('user_role_check');
    expect(check.prefix).toBeUndefined();
  });

  it('is frozen', () => {
    const check = new CheckConstraint({
      naming: { kind: 'exact', name: 'user_role_check' },
      expression,
    });
    expect(Object.isFrozen(check)).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(() => new CheckConstraint({ naming: { kind: 'exact', name: '' }, expression })).toThrow(
      /full physical name/,
    );
  });
});

describe('checkConstraintInputFromSerialized', () => {
  it('round-trips a wire-named check through the flat storage shape', () => {
    const check = new CheckConstraint(
      checkConstraintInputFromSerialized({
        name: wireName,
        prefix: 'user_role_check',
        expression,
      }),
    );
    expect({ name: check.name, prefix: check.prefix, expression: check.expression }).toEqual({
      name: wireName,
      prefix: 'user_role_check',
      expression,
    });
  });

  it('round-trips an exact-named check', () => {
    const check = new CheckConstraint(
      checkConstraintInputFromSerialized({ name: 'legacy_check', expression }),
    );
    expect({ name: check.name, prefix: check.prefix }).toEqual({
      name: 'legacy_check',
      prefix: undefined,
    });
  });

  it('rejects a prefix that does not parse back out of the name', () => {
    expect(() =>
      checkConstraintInputFromSerialized({
        name: 'user_role_check_zzzz',
        prefix: 'user_role_check',
        expression,
      }),
    ).toThrow(/does not match the wire name/);
  });
});

describe('StorageTable with optional checks', () => {
  const baseTable = {
    columns: {
      id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
      role: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
    },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  it('leaves checks absent when not provided', () => {
    expect(new StorageTable(baseTable).checks).toBeUndefined();
  });

  it('materializes checks from plain inputs', () => {
    const table = new StorageTable({
      ...baseTable,
      checks: [{ naming: { kind: 'exact', name: 'user_role_check' }, expression }],
    });
    expect(table.checks).toHaveLength(1);
    expect(table.checks?.[0]).toBeInstanceOf(CheckConstraint);
    expect({ name: table.checks?.[0]?.name, expression: table.checks?.[0]?.expression }).toEqual({
      name: 'user_role_check',
      expression,
    });
  });

  it('carries pre-constructed CheckConstraint instances through', () => {
    const check = new CheckConstraint({
      naming: { kind: 'wire', prefix: 'user_role_check', hash },
      expression,
    });
    expect(new StorageTable({ ...baseTable, checks: [check] }).checks?.[0]).toBe(check);
  });

  it('table with checks is frozen', () => {
    const table = new StorageTable({
      ...baseTable,
      checks: [{ naming: { kind: 'exact', name: 'user_role_check' }, expression }],
    });
    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.isFrozen(table.checks)).toBe(true);
  });
});

describe('StorageTableSchema validates checks', () => {
  const storageSchema = createSqlStorageSchema(composeSqlEntityKinds());

  function makeRawStorage(tableExtra: Record<string, unknown>) {
    return {
      storageHash: 'test',
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  role: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
                ...tableExtra,
              },
            },
          },
        },
      },
    };
  }

  it('accepts a table without checks', () => {
    expect(storageSchema(makeRawStorage({}))).not.toBeInstanceOf(type.errors);
  });

  it('accepts a wire-named check', () => {
    const result = storageSchema(
      makeRawStorage({ checks: [{ name: wireName, prefix: 'user_role_check', expression }] }),
    );
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('accepts an exact-named check', () => {
    const result = storageSchema(
      makeRawStorage({ checks: [{ name: 'user_role_check', expression }] }),
    );
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('rejects a check with a missing name', () => {
    expect(storageSchema(makeRawStorage({ checks: [{ expression }] }))).toBeInstanceOf(type.errors);
  });

  it('rejects a check with a missing expression', () => {
    expect(storageSchema(makeRawStorage({ checks: [{ name: 'user_role_check' }] }))).toBeInstanceOf(
      type.errors,
    );
  });

  it('rejects an unknown key on a check', () => {
    const result = storageSchema(
      makeRawStorage({ checks: [{ name: 'user_role_check', expression, column: 'role' }] }),
    );
    expect(result).toBeInstanceOf(type.errors);
  });
});
