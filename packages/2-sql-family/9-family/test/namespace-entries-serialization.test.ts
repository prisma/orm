import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { SqlContractSerializerBase } from '../src/core/ir/sql-contract-serializer-base';

/**
 * Exposes the protected `serializeNamespaceEntries` helper for direct
 * assertions. Production serializers (`PostgresContractSerializer`,
 * `SqliteContractSerializer`) call it as part of building a namespace's
 * JSON envelope; this harness isolates the generic walk itself.
 */
class SerializeNamespaceEntriesHarness extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    super(new Map());
  }

  callSerializeNamespaceEntries(
    entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  ) {
    return this.serializeNamespaceEntries(entries);
  }
}

describe('SqlContractSerializerBase — serializeNamespaceEntries', () => {
  it('emits table always, a non-empty extension kind, and omits an empty kind and non-enumerable native_enum', () => {
    const entries: Record<string, Readonly<Record<string, unknown>>> = {
      table: { users: { columns: {} } },
      role: { admin: { name: 'admin' } },
      widget: { w1: { some: 'node' } },
      emptyKind: {},
    };
    Object.defineProperty(entries, 'native_enum', {
      value: { Status: { kind: 'valueSet', values: ['a'] } },
      enumerable: false,
    });

    const harness = new SerializeNamespaceEntriesHarness();
    const result = harness.callSerializeNamespaceEntries(entries);

    expect(result).toEqual({
      table: { users: { columns: {} } },
      role: { admin: { name: 'admin' } },
      widget: { w1: { some: 'node' } },
    });
    expect(Object.hasOwn(result, 'emptyKind')).toBe(false);
    expect(Object.hasOwn(result, 'native_enum')).toBe(false);
  });

  it('emits an empty table rather than omitting it', () => {
    const harness = new SerializeNamespaceEntriesHarness();
    const result = harness.callSerializeNamespaceEntries({ table: {} });
    expect(result).toEqual({ table: {} });
  });

  it('skips an enumerable undefined kind slot without throwing', () => {
    // PostgresSchema can carry an enumerable `valueSet: undefined` own-key
    // (its empty-valueSet normalization); the walk must not call
    // Object.keys(undefined).
    const entries: Record<string, Readonly<Record<string, unknown>>> = { table: {} };
    Object.assign(entries, { valueSet: undefined });

    const harness = new SerializeNamespaceEntriesHarness();
    const result = harness.callSerializeNamespaceEntries(entries);

    expect(result).toEqual({ table: {} });
    expect(Object.hasOwn(result, 'valueSet')).toBe(false);
  });
});
