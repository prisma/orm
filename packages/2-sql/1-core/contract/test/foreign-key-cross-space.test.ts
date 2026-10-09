import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { createContract } from '@repo/test-utils';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { col, fk, table } from '../src/factories';
import { ForeignKey } from '../src/ir/foreign-key';
import { ForeignKeyReference } from '../src/ir/foreign-key-reference';
import { StorageTable } from '../src/ir/storage-table';
import type { SqlStorage } from '../src/types';
import {
  ForeignKeyReferenceSchema,
  ForeignKeySchema,
  ForeignKeySourceSchema,
  validateSqlContractFully,
  validateStorage,
} from '../src/validators';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unboundTables<T extends Record<string, unknown>>(tables: T) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'test-sql-namespace',
        entries: { table: tables },
      },
    },
  };
}

function makeLocalFk(): ForeignKey {
  return new ForeignKey({
    source: {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'post',
      columns: ['author_id'],
    },
    target: {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'user',
      columns: ['id'],
    },
  });
}

function makeSpaceFk(): ForeignKey {
  return new ForeignKey({
    source: {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'post',
      columns: ['author_id'],
    },
    target: {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'user',
      columns: ['id'],
      spaceId: 'auth-service',
    },
  });
}

// ---------------------------------------------------------------------------
// ForeignKeyReference constructor and property tests
// ---------------------------------------------------------------------------

describe('ForeignKeyReference', () => {
  describe('local reference (spaceId absent)', () => {
    it('constructs with no spaceId field', () => {
      const ref = new ForeignKeyReference({
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'user',
        columns: ['id'],
      });
      expect(ref.namespaceId).toBe(UNBOUND_NAMESPACE_ID);
      expect(ref.tableName).toBe('user');
      expect(ref.columns).toEqual(['id']);
      expect(ref.spaceId).toBeUndefined();
    });

    it('serializes without spaceId field (JSON-clean local)', () => {
      const ref = new ForeignKeyReference({
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'user',
        columns: ['id'],
      });
      const json = JSON.stringify(ref);
      const parsed: Record<string, unknown> = JSON.parse(json);
      expect(parsed).not.toHaveProperty('spaceId');
      expect(parsed).toEqual({
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'user',
        columns: ['id'],
      });
    });
  });

  describe('cross-space reference (spaceId present)', () => {
    it('constructs with spaceId', () => {
      const ref = new ForeignKeyReference({
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'user',
        columns: ['id'],
        spaceId: 'auth-service',
      });
      expect(ref.spaceId).toBe('auth-service');
      expect(ref.namespaceId).toBe(UNBOUND_NAMESPACE_ID);
    });

    it('serializes spaceId into JSON but not origin', () => {
      const ref = new ForeignKeyReference({
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'user',
        columns: ['id'],
        spaceId: 'auth-service',
      });
      const json = JSON.stringify(ref);
      const parsed: Record<string, unknown> = JSON.parse(json);
      expect(parsed).toEqual({
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'user',
        columns: ['id'],
        spaceId: 'auth-service',
      });
      expect(parsed).not.toHaveProperty('origin');
    });
  });
});

// ---------------------------------------------------------------------------
// local FK JSON must be byte-identical to pre-discriminator shape
// ---------------------------------------------------------------------------

describe('local FK backward-compatibility', () => {
  it('local FK serializes to the same JSON shape as before the discriminator was added', () => {
    const localFk = makeLocalFk();
    const serialized = JSON.parse(JSON.stringify(localFk)) as Record<string, unknown>;

    // Exact shape that existed before this change
    expect(serialized).toEqual({
      source: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'post',
        columns: ['author_id'],
      },
      target: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'user',
        columns: ['id'],
      },
    });
    // Confirm no origin/spaceId leaks
    const target = serialized['target'] as Record<string, unknown>;
    expect(target).not.toHaveProperty('origin');
    expect(target).not.toHaveProperty('spaceId');
  });

  it('a contract with only local FKs round-trips through validateStorage without error', () => {
    const s = createContract<SqlStorage>({
      storage: unboundTables({
        user: table({ id: col('pg/int4', 'pg/int4@1') }),
        post: table(
          { id: col('pg/int4', 'pg/int4@1'), author_id: col('pg/int4', 'pg/int4@1') },
          { fks: [fk('post', ['author_id'], 'user', ['id'])] },
        ),
      }),
    }).storage;
    expect(() => validateStorage(s)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// round-trip with mixed local + cross-space FK carriers
// ---------------------------------------------------------------------------

describe('round-trips mixed local and cross-space FK carriers', () => {
  it('serialize → JSON → deserialize preserves both local and cross-space FKs', () => {
    const localRef = new ForeignKeyReference({
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'user',
      columns: ['id'],
    });
    const spaceRef = new ForeignKeyReference({
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'user',
      columns: ['id'],
      spaceId: 'auth-service',
    });

    const localFkInstance = makeLocalFk();
    const spaceFkInstance = makeSpaceFk();

    // Serialize to plain JSON
    const localJson = JSON.parse(JSON.stringify(localRef)) as Record<string, unknown>;
    const spaceJson = JSON.parse(JSON.stringify(spaceRef)) as Record<string, unknown>;

    // Deserialize back into ForeignKeyReference instances
    const localRoundTripped = new ForeignKeyReference(
      blindCast<
        ConstructorParameters<typeof ForeignKeyReference>[0],
        'JSON.parse(JSON.stringify(...)) round-trip of a ForeignKeyReference; shape is preserved'
      >(localJson),
    );
    const spaceRoundTripped = new ForeignKeyReference(
      blindCast<
        ConstructorParameters<typeof ForeignKeyReference>[0],
        'JSON.parse(JSON.stringify(...)) round-trip of a ForeignKeyReference; shape is preserved'
      >(spaceJson),
    );

    expect(localRoundTripped.spaceId).toBeUndefined();
    expect(localRoundTripped.namespaceId).toBe(UNBOUND_NAMESPACE_ID);

    expect(spaceRoundTripped.spaceId).toBe('auth-service');
    expect(spaceRoundTripped.namespaceId).toBe(UNBOUND_NAMESPACE_ID);

    // Full FK round-trip
    const localFkJson = JSON.parse(JSON.stringify(localFkInstance)) as Record<string, unknown>;
    const spaceFkJson = JSON.parse(JSON.stringify(spaceFkInstance)) as Record<string, unknown>;

    const localFkRoundTripped = new ForeignKey(
      blindCast<
        ConstructorParameters<typeof ForeignKey>[0],
        'JSON.parse(JSON.stringify(...)) round-trip of a ForeignKey; shape is preserved'
      >(localFkJson),
    );
    const spaceFkRoundTripped = new ForeignKey(
      blindCast<
        ConstructorParameters<typeof ForeignKey>[0],
        'JSON.parse(JSON.stringify(...)) round-trip of a ForeignKey; shape is preserved'
      >(spaceFkJson),
    );

    expect(localFkRoundTripped.target.spaceId).toBeUndefined();
    expect(spaceFkRoundTripped.target.spaceId).toBe('auth-service');
  });

  it('StorageTable with mixed FKs round-trips through JSON construction', () => {
    const mixedTable = new StorageTable({
      columns: {
        id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
        author_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
        org_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
      },
      uniques: [],
      indexes: [],
      foreignKeys: [makeLocalFk(), makeSpaceFk()],
    });

    const json = JSON.parse(JSON.stringify(mixedTable)) as Record<string, unknown>;
    const reconstructed = new StorageTable(
      blindCast<
        ConstructorParameters<typeof StorageTable>[0],
        'JSON.parse(JSON.stringify(...)) round-trip of a StorageTable; shape is preserved'
      >(json),
    );

    expect(reconstructed.foreignKeys).toHaveLength(2);
    const [localFk, spaceFk] = reconstructed.foreignKeys;
    expect(localFk?.target.spaceId).toBeUndefined();
    expect(spaceFk?.target.spaceId).toBe('auth-service');
  });
});

// ---------------------------------------------------------------------------
// ArkType validator tests
// ---------------------------------------------------------------------------

describe('ForeignKeyReferenceSchema', () => {
  it('accepts a well-formed local reference (no spaceId)', () => {
    const input = {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'user',
      columns: ['id'],
    };
    const result = ForeignKeyReferenceSchema(input);
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('accepts a cross-space reference with spaceId', () => {
    const input = {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'user',
      columns: ['id'],
      spaceId: 'auth-service',
    };
    const result = ForeignKeyReferenceSchema(input);
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('rejects an unknown origin key (stale input)', () => {
    const input = {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'user',
      columns: ['id'],
      origin: 'space',
      spaceId: 'auth-service',
    };
    const result = ForeignKeyReferenceSchema(input);
    expect(result).toBeInstanceOf(type.errors);
  });

  it('rejects any origin key since origin is no longer part of the schema', () => {
    const input = {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'user',
      columns: ['id'],
      origin: 'local',
    };
    const result = ForeignKeyReferenceSchema(input);
    expect(result).toBeInstanceOf(type.errors);
  });
});

describe('ForeignKeySourceSchema', () => {
  it('accepts a well-formed local source (no spaceId)', () => {
    const result = ForeignKeySourceSchema({
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'post',
      columns: ['author_id'],
    });
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('rejects a source carrying spaceId', () => {
    const result = ForeignKeySourceSchema({
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'post',
      columns: ['author_id'],
      spaceId: 'auth-service',
    });
    expect(result).toBeInstanceOf(type.errors);
  });
});

describe('ForeignKeySchema', () => {
  it('accepts an FK with a cross-space target', () => {
    const input = {
      source: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'post',
        columns: ['author_id'],
      },
      target: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'user',
        columns: ['id'],
        spaceId: 'auth-service',
      },
    };
    const result = ForeignKeySchema(input);
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('rejects an FK whose source carries spaceId', () => {
    const result = ForeignKeySchema({
      source: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'post',
        columns: ['author_id'],
        spaceId: 'auth-service',
      },
      target: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'user',
        columns: ['id'],
      },
    });
    expect(result).toBeInstanceOf(type.errors);
  });

  it('accepts an FK with a local source and local target', () => {
    const result = ForeignKeySchema({
      source: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'post',
        columns: ['author_id'],
      },
      target: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'user',
        columns: ['id'],
      },
    });
    expect(result).not.toBeInstanceOf(type.errors);
  });
});

// ---------------------------------------------------------------------------
// validateSqlContractFully: cross-space FK does not trigger the
// "references non-existent table" check (target is in another contract-space)
// ---------------------------------------------------------------------------

describe('validateSqlContractFully with cross-space FKs', () => {
  it('accepts a contract with a cross-space FK target that is not present in storage', () => {
    // The target table ('user') lives in another contract-space (auth-service),
    // so it is not present in this contract's storage. The validator must NOT
    // reject this as a missing table reference.
    const rawContract = createContract({
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                    author_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [
                    {
                      source: {
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        tableName: 'post',
                        columns: ['author_id'],
                      },
                      target: {
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        tableName: 'user',
                        columns: ['id'],
                        spaceId: 'auth-service',
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });
    expect(() => validateSqlContractFully(rawContract)).not.toThrow();
  });

  it('still rejects a local FK whose target table is missing', () => {
    // A local FK (no spaceId) pointing at a non-existent table must still fail.
    const rawContract = createContract({
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                    author_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [
                    {
                      source: {
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        tableName: 'post',
                        columns: ['author_id'],
                      },
                      target: {
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        tableName: 'ghost_table',
                        columns: ['id'],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });
    expect(() => validateSqlContractFully(rawContract)).toThrow(/non-existent table/);
  });
});
