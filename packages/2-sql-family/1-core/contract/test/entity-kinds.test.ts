import { hydrateNamespaceEntities, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { composeSqlEntityKinds, tableEntityKind, valueSetEntityKind } from '../src/entity-kinds';
import { index } from '../src/factories';
import { CheckConstraint } from '../src/ir/check-constraint';
import { StorageTable } from '../src/ir/storage-table';
import { StorageValueSet } from '../src/ir/storage-value-set';
import type { SerializedCheckConstraint } from '../src/serialized-check-constraint';
import type { SerializedIndex } from '../src/serialized-index';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

const valueSetInput = { kind: 'valueSet' as const, values: ['a', 'b'] as const };

describe('tableEntityKind', () => {
  it('construct produces StorageTable instances', () => {
    const result = tableEntityKind.construct(emptyTableInput);
    expect(result).toBeInstanceOf(StorageTable);
  });

  describe('given stored records from contract.json', () => {
    it('hydrates a stored index record into an Index node', () => {
      const serialized: SerializedIndex = {
        name: 'users_email_idx_ab12cd34',
        prefix: 'users_email_idx',
        columns: ['email'],
        unique: true,
      };
      const result = tableEntityKind.construct({
        ...emptyTableInput,
        indexes: [serialized],
      });
      expect(result.indexes).toStrictEqual([
        index('users_email_idx_ab12cd34', ['email'], { prefix: 'users_email_idx', unique: true }),
      ]);
    });

    it('hydrates a stored check record into a CheckConstraint node', () => {
      const serialized: SerializedCheckConstraint = {
        name: 'users_email_check_ab12cd34',
        prefix: 'users_email_check',
        expression: "email <> ''",
      };
      const result = tableEntityKind.construct({
        ...emptyTableInput,
        checks: [serialized],
      });
      expect(result.checks).toStrictEqual([
        new CheckConstraint({
          naming: { kind: 'wire', prefix: 'users_email_check', hash: 'ab12cd34' },
          expression: "email <> ''",
        }),
      ]);
    });
  });

  describe('given IR nodes from authoring or an earlier hydration pass', () => {
    it('keeps an existing Index node as the same instance', () => {
      const idx = index('idx_users_email', ['email'], { unique: true });
      const result = tableEntityKind.construct({
        ...emptyTableInput,
        indexes: [idx],
      });
      expect(result.indexes).toEqual([idx]);
      expect(result.indexes[0]).toBe(idx);
    });

    it('keeps an existing CheckConstraint node as the same instance', () => {
      const check = new CheckConstraint({
        naming: { kind: 'exact', name: 'chk_users_age' },
        expression: 'age >= 0',
      });
      const result = tableEntityKind.construct({
        ...emptyTableInput,
        checks: [check],
      });
      expect(result.checks).toEqual([check]);
      expect(result.checks?.[0]).toBe(check);
    });
  });
});

describe('valueSetEntityKind', () => {
  it('construct produces StorageValueSet instances', () => {
    const result = valueSetEntityKind.construct(valueSetInput);
    expect(result).toBeInstanceOf(StorageValueSet);
  });
});

describe('composeSqlEntityKinds', () => {
  it('includes table and valueSet by default', () => {
    const kinds = composeSqlEntityKinds();
    expect(kinds.has('table')).toBe(true);
    expect(kinds.has('valueSet')).toBe(true);
  });

  it('merges pack descriptors', () => {
    const synth = {
      kind: 'synthetic',
      schema: tableEntityKind.schema,
      construct: (v: unknown) => v,
    };
    const kinds = composeSqlEntityKinds([synth]);
    expect(kinds.has('synthetic')).toBe(true);
  });

  it('throws on a duplicate entity kind', () => {
    const collide = { kind: 'table', schema: tableEntityKind.schema, construct: (v: unknown) => v };
    expect(() => composeSqlEntityKinds([collide])).toThrow(/duplicate entity kind/);
    const collide2 = {
      kind: 'valueSet',
      schema: tableEntityKind.schema,
      construct: (v: unknown) => v,
    };
    expect(() => composeSqlEntityKinds([collide2])).toThrow(/duplicate entity kind/);
  });

  it('duplicate entity kind error carries CONTRACT.PACK_CONTRIBUTION_INVALID', () => {
    const collide = { kind: 'table', schema: tableEntityKind.schema, construct: (v: unknown) => v };
    expect(() => composeSqlEntityKinds([collide])).toThrowError(
      expect.objectContaining({ code: 'CONTRACT.PACK_CONTRIBUTION_INVALID' }) as unknown as Error,
    );
  });
});

describe('hydrateNamespaceEntities with SQL kinds (carry)', () => {
  it('constructs table entries', () => {
    const kinds = composeSqlEntityKinds();
    const result = hydrateNamespaceEntities({ table: { users: emptyTableInput } }, kinds, 'carry');
    expect(result['table']?.['users']).toBeInstanceOf(StorageTable);
  });

  it('constructs valueSet entries', () => {
    const kinds = composeSqlEntityKinds();
    const result = hydrateNamespaceEntities(
      { table: {}, valueSet: { Role: valueSetInput } },
      kinds,
      'carry',
    );
    expect(result['valueSet']?.['Role']).toBeInstanceOf(StorageValueSet);
  });

  it('carries unknown kinds frozen as-is', () => {
    const kinds = composeSqlEntityKinds();
    const bogusMap = Object.freeze({ foo: { x: 1 } });
    const result = hydrateNamespaceEntities(
      { table: {}, bogus: bogusMap } as Record<string, Record<string, unknown>>,
      kinds,
      'carry',
    );
    expect(result['bogus']).toBe(bogusMap);
    expect(Object.isFrozen(result['bogus'])).toBe(true);
  });

  it('handles UNBOUND_NAMESPACE_ID as an entry key without issue', () => {
    const kinds = composeSqlEntityKinds();
    const result = hydrateNamespaceEntities(
      { [UNBOUND_NAMESPACE_ID]: {} as Record<string, unknown>, table: {} },
      kinds,
      'carry',
    );
    expect(result[UNBOUND_NAMESPACE_ID]).toBeDefined();
  });
});
