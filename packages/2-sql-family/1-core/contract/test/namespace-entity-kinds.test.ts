import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { composeSqlEntityKinds } from '../src/entity-kinds';
import {
  createNamespaceEntrySchema,
  createSqlStorageSchema,
  StorageValueSetSchema,
} from '../src/validators';

// Synthetic pack-contributed schema used to test descriptor dispatch without
// depending on a target-specific schema.
const SyntheticPackEntrySchema = type({
  kind: "'synthetic-kind'",
  'name?': 'string',
  values: type.string.array().readonly(),
});

// ---------------------------------------------------------------------------
// Minimal valid fixtures
// ---------------------------------------------------------------------------

const minimalTable = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
};

function makeStorage(entries: Record<string, unknown>) {
  return {
    storageHash: 'test',
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// createNamespaceEntrySchema — entity-kind descriptor dispatch
// ---------------------------------------------------------------------------

describe('createNamespaceEntrySchema — descriptor-driven validation', () => {
  it('accepts a namespace with core-registered table entries', () => {
    const schema = createNamespaceEntrySchema(composeSqlEntityKinds());
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: { users: minimalTable } },
    });
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('accepts a namespace with core-registered valueSet entries', () => {
    const schema = createNamespaceEntrySchema(composeSqlEntityKinds());
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: { users: minimalTable },
        valueSet: { Role: { kind: 'valueSet', values: ['user', 'admin'] } },
      },
    });
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('rejects a namespace with an unregistered entries key naming the kind', () => {
    const schema = createNamespaceEntrySchema(composeSqlEntityKinds());
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: { users: minimalTable },
        bogus: { Foo: { kind: 'bogus', name: 'Foo' } },
      },
    });
    expect(result).toBeInstanceOf(type.errors);
    expect(String(result)).toMatch(/bogus/);
  });

  it('accepts a namespace with a pack-contributed entries key', () => {
    const kinds = composeSqlEntityKinds([
      { kind: 'synth', schema: SyntheticPackEntrySchema, construct: (v) => v },
    ]);
    const schema = createNamespaceEntrySchema(kinds);
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {},
        synth: { Foo: { kind: 'synthetic-kind', values: ['a', 'b'], name: 'Foo' } },
      },
    });
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('rejects a pack-contributed entry with a non-conforming value', () => {
    const kinds = composeSqlEntityKinds([
      { kind: 'synth', schema: SyntheticPackEntrySchema, construct: (v) => v },
    ]);
    const schema = createNamespaceEntrySchema(kinds);
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {},
        synth: { Foo: { kind: 'synthetic-kind' } },
      },
    });
    expect(result).toBeInstanceOf(type.errors);
  });

  it('rejects an unknown entries key even when a pack descriptor is provided', () => {
    const kinds = composeSqlEntityKinds([
      { kind: 'synth', schema: SyntheticPackEntrySchema, construct: (v) => v },
    ]);
    const schema = createNamespaceEntrySchema(kinds);
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {},
        synth: {},
        unknown: { X: { kind: 'unknown' } },
      },
    });
    expect(result).toBeInstanceOf(type.errors);
    expect(String(result)).toMatch(/unknown/);
  });

  it('rejects a Date passed as an inner entries map', () => {
    const schema = createNamespaceEntrySchema(composeSqlEntityKinds());
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: new Date() },
    });
    expect(result).toBeInstanceOf(type.errors);
  });

  it('rejects a Map passed as an inner entries map', () => {
    const schema = createNamespaceEntrySchema(composeSqlEntityKinds());
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: new Map([['users', minimalTable]]) },
    });
    expect(result).toBeInstanceOf(type.errors);
  });

  it('rejects core kinds when given a truly empty entity-kind descriptor map — no hidden fallback tier', () => {
    const schema = createNamespaceEntrySchema(new Map());
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: { users: minimalTable } },
    });
    expect(result).toBeInstanceOf(type.errors);
    expect(String(result)).toMatch(/table/);
  });

  it('unregistered-kind error names the kind and the namespace id', () => {
    const schema = createNamespaceEntrySchema(composeSqlEntityKinds());
    const result = schema({
      id: 'analytics',
      entries: { bogus: { Foo: {} } },
    });
    expect(result).toBeInstanceOf(type.errors);
    expect(String(result)).toMatch(/bogus/);
    expect(String(result)).toMatch(/analytics/);
  });
});

// ---------------------------------------------------------------------------
// createSqlStorageSchema — storage-level validation with entity-kind descriptors
// ---------------------------------------------------------------------------

describe('createSqlStorageSchema — descriptor-driven storage validation', () => {
  it('accepts storage with core-registered table + valueSet entries', () => {
    const schema = createSqlStorageSchema(composeSqlEntityKinds());
    const result = schema(
      makeStorage({
        table: { users: minimalTable },
        valueSet: { Role: { kind: 'valueSet', values: ['user', 'admin'] } },
      }),
    );
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('rejects storage with an unregistered entries key, error names the kind', () => {
    const schema = createSqlStorageSchema(composeSqlEntityKinds());
    const result = schema(
      makeStorage({
        table: { users: minimalTable },
        bogus: { Foo: { kind: 'bogus' } },
      }),
    );
    expect(result).toBeInstanceOf(type.errors);
    expect(String(result)).toMatch(/bogus/);
  });

  it('accepts storage with a pack-contributed entries key', () => {
    const kinds = composeSqlEntityKinds([
      { kind: 'synth', schema: SyntheticPackEntrySchema, construct: (v) => v },
    ]);
    const schema = createSqlStorageSchema(kinds);
    const result = schema(
      makeStorage({
        table: {},
        synth: { Foo: { kind: 'synthetic-kind', values: ['a', 'b'], name: 'Foo' } },
      }),
    );
    expect(result).not.toBeInstanceOf(type.errors);
  });
});

// ---------------------------------------------------------------------------
// StorageValueSetSchema — kind literal updated to 'valueSet' (post-rebase)
// ---------------------------------------------------------------------------

describe('StorageValueSetSchema', () => {
  it("accepts a value-set with kind 'valueSet'", () => {
    const result = StorageValueSetSchema({ kind: 'valueSet', values: ['a', 'b'] });
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it("rejects a value-set with the old kind 'value-set'", () => {
    const result = StorageValueSetSchema({ kind: 'value-set', values: ['a', 'b'] });
    expect(result).toBeInstanceOf(type.errors);
  });
});
