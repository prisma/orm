import type { CodecDescriptor } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  SqlStorage,
  type SqlStorageTypeEntry,
  type StorageTableInput,
} from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import type { AnyCodecDescriptor } from '../src/ast/codec-types';
import { buildCodecDescriptorRegistry } from '../src/codec-descriptor-registry';

const stub = (codecId: string): AnyCodecDescriptor =>
  ({
    codecId,
    traits: [],
    isParameterized: false,
    paramsSchema: undefined,
    factory: () => () => ({ id: codecId }) as never,
  }) as unknown as AnyCodecDescriptor;

describe('buildCodecDescriptorRegistry', () => {
  it('descriptorFor returns the registered descriptor by codec id', () => {
    const a = stub('lib/a@1');
    const b = stub('lib/b@1');
    const registry = buildCodecDescriptorRegistry([a, b]);

    expect(registry.descriptorFor('lib/a@1')).toBe(a as unknown as CodecDescriptor<unknown>);
    expect(registry.descriptorFor('lib/b@1')).toBe(b as unknown as CodecDescriptor<unknown>);
  });

  it('descriptorFor returns undefined for an unknown codec id', () => {
    const registry = buildCodecDescriptorRegistry([stub('lib/a@1')]);
    expect(registry.descriptorFor('lib/missing@1')).toBeUndefined();
  });

  it('values() yields all registered descriptors in registration order', () => {
    const a = stub('lib/a@1');
    const b = stub('lib/b@1');
    const c = stub('lib/c@1');
    const registry = buildCodecDescriptorRegistry([a, b, c]);

    expect([...registry.values()]).toEqual([a, b, c]);
  });

  it('throws when a codec id is registered twice', () => {
    const a = stub('lib/dup@1');
    const a2 = stub('lib/dup@1');
    expect(() => buildCodecDescriptorRegistry([a, a2])).toThrowError(
      /Duplicate codec descriptor id: 'lib\/dup@1'/,
    );
  });
});

describe('buildCodecDescriptorRegistry — codecRefForColumn', () => {
  function storageWith(parts: {
    tables: Record<string, StorageTableInput>;
    types?: Record<string, SqlStorageTypeEntry>;
  }): SqlStorage {
    return new SqlStorage({
      storageHash: 'test' as SqlStorage['storageHash'],
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: parts.tables },
        }),
      },
      ...ifDefined('types', parts.types),
    });
  }

  const descriptors = [stub('pg/vector@1'), stub('pg/text@1')];

  it('returns undefined when the registry was built without storage', () => {
    const registry = buildCodecDescriptorRegistry(descriptors);
    expect(registry.codecRefForColumn(UNBOUND_NAMESPACE_ID, 'Doc', 'embedding')).toBeUndefined();
  });

  it('derives `{codecId, typeParams}` from `storage.types` for a typeRef column', () => {
    const storage = storageWith({
      tables: {
        Doc: {
          columns: {
            embedding: {
              nativeType: 'vector',
              codecId: 'pg/vector@1',
              nullable: false,
              typeRef: 'Vector1536',
            },
          },
          primaryKey: { columns: ['embedding'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      types: {
        Vector1536: {
          kind: 'codec-instance',
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      },
    });

    const registry = buildCodecDescriptorRegistry(descriptors, storage);
    expect(registry.codecRefForColumn(UNBOUND_NAMESPACE_ID, 'Doc', 'embedding')).toEqual({
      codecId: 'pg/vector@1',
      typeParams: { length: 1536 },
    });
  });

  it('derives `{codecId, typeParams}` from inline `column.typeParams` when no typeRef is set', () => {
    const storage = storageWith({
      tables: {
        Doc: {
          columns: {
            embedding: {
              nativeType: 'vector',
              codecId: 'pg/vector@1',
              nullable: false,
              typeParams: { length: 768 },
            },
          },
          primaryKey: { columns: ['embedding'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const registry = buildCodecDescriptorRegistry(descriptors, storage);
    expect(registry.codecRefForColumn(UNBOUND_NAMESPACE_ID, 'Doc', 'embedding')).toEqual({
      codecId: 'pg/vector@1',
      typeParams: { length: 768 },
    });
  });

  it('emits `{codecId}` (typeParams undefined) for a non-parameterized column', () => {
    const storage = storageWith({
      tables: {
        User: {
          columns: {
            email: {
              nativeType: 'text',
              codecId: 'pg/text@1',
              nullable: false,
            },
          },
          primaryKey: { columns: ['email'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const registry = buildCodecDescriptorRegistry(descriptors, storage);
    const ref = registry.codecRefForColumn(UNBOUND_NAMESPACE_ID, 'User', 'email');
    expect(ref).toEqual({ codecId: 'pg/text@1' });
    expect(ref?.typeParams).toBeUndefined();
  });

  it('returns undefined for an unknown table or column', () => {
    const storage = storageWith({
      tables: {
        User: {
          columns: {
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['email'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const registry = buildCodecDescriptorRegistry(descriptors, storage);
    expect(registry.codecRefForColumn(UNBOUND_NAMESPACE_ID, 'User', 'nope')).toBeUndefined();
    expect(
      registry.codecRefForColumn(UNBOUND_NAMESPACE_ID, 'NoSuchTable', 'whatever'),
    ).toBeUndefined();
  });

  it('returns undefined when the typeRef points at an undefined storage type', () => {
    const storage = storageWith({
      tables: {
        Doc: {
          columns: {
            embedding: {
              nativeType: 'vector',
              codecId: 'pg/vector@1',
              nullable: false,
              typeRef: 'Missing',
            },
          },
          primaryKey: { columns: ['embedding'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const registry = buildCodecDescriptorRegistry(descriptors, storage);
    expect(registry.codecRefForColumn(UNBOUND_NAMESPACE_ID, 'Doc', 'embedding')).toBeUndefined();
  });
});

describe('buildCodecDescriptorRegistry — codecRefForColumn namespace coordinate', () => {
  const descriptors = [stub('pg/int4@1'), stub('pg/text@1'), stub('pg/varchar@1')];

  function table(columns: Record<string, string>): StorageTableInput {
    return {
      columns: Object.fromEntries(
        Object.entries(columns).map(([name, codecId]) => [
          name,
          { nativeType: codecId, codecId, nullable: false },
        ]),
      ),
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    };
  }

  // Two namespaces declare a table with the same bare name `users` but with
  // differing columns/codecs. The registry must discriminate by the namespace
  // coordinate it is handed rather than scanning and first-matching.
  function twoNamespaceStorage(): SqlStorage {
    return new SqlStorage({
      storageHash: 'test' as SqlStorage['storageHash'],
      namespaces: {
        public: createTestSqlNamespace({
          id: 'public',
          entries: { table: { users: table({ id: 'pg/int4@1', email: 'pg/text@1' }) } },
        }),
        auth: createTestSqlNamespace({
          id: 'auth',
          entries: { table: { users: table({ id: 'pg/int4@1', token: 'pg/varchar@1' }) } },
        }),
      },
    });
  }

  it('resolves the per-namespace codec ref for a same bare table name, discriminating by coordinate', () => {
    const registry = buildCodecDescriptorRegistry(descriptors, twoNamespaceStorage());

    expect(registry.codecRefForColumn('public', 'users', 'email')).toEqual({
      codecId: 'pg/text@1',
    });
    expect(registry.codecRefForColumn('auth', 'users', 'token')).toEqual({
      codecId: 'pg/varchar@1',
    });

    // A column present only in the other namespace must not resolve here — proves
    // the resolution honours the coordinate rather than first-matching by name.
    expect(registry.codecRefForColumn('public', 'users', 'token')).toBeUndefined();
    expect(registry.codecRefForColumn('auth', 'users', 'email')).toBeUndefined();
  });
});
