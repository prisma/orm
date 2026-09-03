import type { ContractRelationThrough } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  assertDistinctOnCapability,
  assertReturningCapability,
  hasContractCapability,
  isToOneCardinality,
  resolveIncludeRelation,
  resolveModelRelations,
  resolveModelTableName,
  resolvePolymorphismInfo,
  resolvePrimaryKeyColumn,
  resolveRowIdentityColumns,
  resolveThrough,
  resolveUpsertConflictColumns,
} from '../src/collection-contract';
import {
  buildExecutionDefaultJunctionContract,
  buildMixedPolyContract,
  getTestContract,
  withPatchedDomainModels,
} from './helpers';
import { unboundTables } from './unbound-tables';

describe('collection-contract capability detection', () => {
  it('detects top-level capability flags', () => {
    const contract = getTestContract();
    const withTopLevelCapability = {
      ...contract,
      capabilities: { returning: true },
    } as unknown as typeof contract;

    expect(hasContractCapability(withTopLevelCapability, 'returning')).toBe(true);
  });

  it('detects target-scoped capability flags from generated contracts', () => {
    const contract = getTestContract();
    const withTargetCapability = {
      ...contract,
      capabilities: {
        postgres: {
          returning: true,
          lateral: true,
        },
      },
    } as typeof contract;

    expect(hasContractCapability(withTargetCapability, 'returning')).toBe(true);
    expect(hasContractCapability(withTargetCapability, 'lateral')).toBe(true);
  });

  it('assertReturningCapability accepts target-scoped returning flags', () => {
    const contract = getTestContract();
    const withTargetCapability = {
      ...contract,
      capabilities: {
        postgres: {
          returning: true,
        },
      },
    } as typeof contract;

    expect(() => assertReturningCapability(withTargetCapability, 'create()')).not.toThrow();
  });

  it('assertReturningCapability throws when returning is unavailable', () => {
    const contract = { ...getTestContract(), capabilities: {} };
    expect(() => assertReturningCapability(contract, 'create()')).toThrow(
      /requires contract capability "returning"/,
    );
  });

  it('assertDistinctOnCapability accepts postgres.distinctOn', () => {
    const contract = getTestContract();
    const withDistinctOn = {
      ...contract,
      capabilities: {
        postgres: {
          distinctOn: true,
        },
      },
    } as typeof contract;

    expect(() => assertDistinctOnCapability(withDistinctOn, 'distinctOn')).not.toThrow();
  });

  it('assertDistinctOnCapability throws ORM.CAPABILITY_MISSING when distinctOn is unavailable', () => {
    const contract = { ...getTestContract(), capabilities: {} };
    expect(() => assertDistinctOnCapability(contract, 'distinctOn')).toThrow(
      'distinctOn() requires capability postgres.distinctOn',
    );
    expect(() => assertDistinctOnCapability(contract, 'distinctOn')).toThrow(
      expect.objectContaining({ code: 'ORM.CAPABILITY_MISSING' }),
    );
  });

  it('resolveIncludeRelation() reads relation metadata from model.relations', () => {
    const contract = getTestContract();

    expect(resolveIncludeRelation(contract, 'public', 'User', 'posts')).toEqual({
      relatedModelName: 'Post',
      relatedNamespaceId: 'public',
      relatedTableName: 'posts',
      localTableName: 'users',
      targetColumns: ['user_id'],
      localColumns: ['id'],
      cardinality: '1:N',
    });
  });

  it('resolveIncludeRelation() resolves every column of a composite foreign key', () => {
    const composite = withPatchedDomainModels(getTestContract(), (models) => {
      const user = models['User'] as Record<string, unknown>;
      return {
        ...models,
        User: {
          ...user,
          relations: {
            ...(user['relations'] as Record<string, unknown>),
            posts: {
              to: { model: 'Post', namespace: 'public' },
              cardinality: '1:N',
              on: { localFields: ['id', 'email'], targetFields: ['userId', 'title'] },
            },
          },
        },
      };
    });

    expect(resolveIncludeRelation(composite, 'public', 'User', 'posts')).toEqual({
      relatedModelName: 'Post',
      relatedNamespaceId: 'public',
      relatedTableName: 'posts',
      localTableName: 'users',
      targetColumns: ['user_id', 'title'],
      localColumns: ['id', 'email'],
      cardinality: '1:N',
    });
  });

  it('keeps the 1:1 profile relation backed by a unique child key', () => {
    const contract = getTestContract();

    expect(unboundTables(contract.storage)['profiles']!.uniques).toContainEqual({
      columns: ['user_id'],
    });
  });

  it('resolveIncludeRelation() throws for missing or malformed relations', () => {
    const contract = getTestContract();

    expect(() => resolveIncludeRelation(contract, 'public', 'User', 'missing')).toThrow(
      /not found/,
    );

    const malformed = withPatchedDomainModels(contract, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        relations: {
          posts: {
            to: { model: 'Post', namespace: '__unbound__' },
            on: { localFields: 'id', targetFields: ['userId'] },
          },
        },
      },
    }));

    expect(() => resolveIncludeRelation(malformed, 'public', 'User', 'posts')).toThrow(/not found/);
  });

  it('resolveIncludeRelation() handles incomplete relation metadata', () => {
    const contract = getTestContract();

    const incompleteRelation = withPatchedDomainModels(contract, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        relations: {
          posts: {
            to: { model: 'Post', namespace: '__unbound__' },
            cardinality: 'unsupported',
            on: {
              localFields: [],
              targetFields: [],
            },
          },
        },
      },
    }));

    expect(() => resolveIncludeRelation(incompleteRelation, 'public', 'User', 'posts')).toThrow(
      /incomplete join metadata/,
    );
  });

  it('resolveIncludeRelation() throws when composite key arrays have unequal length', () => {
    const unequal = withPatchedDomainModels(getTestContract(), (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        relations: {
          posts: {
            to: { model: 'Post', namespace: 'public' },
            cardinality: '1:N',
            on: { localFields: ['id', 'email'], targetFields: ['userId'] },
          },
        },
      },
    }));

    expect(() => resolveIncludeRelation(unequal, 'public', 'User', 'posts')).toThrow(
      /incomplete join metadata/,
    );
  });

  it('resolveIncludeRelation() throws when a later composite key pair is empty', () => {
    const emptyLater = withPatchedDomainModels(getTestContract(), (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        relations: {
          posts: {
            to: { model: 'Post', namespace: 'public' },
            cardinality: '1:N',
            on: { localFields: ['id', 'email'], targetFields: ['userId', ''] },
          },
        },
      },
    }));

    expect(() => resolveIncludeRelation(emptyLater, 'public', 'User', 'posts')).toThrow(
      /incomplete join metadata/,
    );
  });

  it('resolveUpsertConflictColumns() maps explicit criteria and falls back to primary key', () => {
    const contract = getTestContract();

    expect(
      resolveUpsertConflictColumns(contract, 'public', 'Post', { userId: 'x', title: 'y' }),
    ).toEqual(['user_id', 'title']);
    expect(resolveUpsertConflictColumns(contract, 'public', 'Post', undefined)).toEqual(['id']);
    expect(resolveUpsertConflictColumns(contract, 'public', 'Post', {})).toEqual(['id']);
  });

  it('resolveUpsertConflictColumns() falls back for unmapped fields and unknown models', () => {
    const contract = getTestContract();

    expect(resolveUpsertConflictColumns(contract, 'public', 'Post', { unknownField: 'x' })).toEqual(
      ['unknownField'],
    );
    expect(resolveUpsertConflictColumns(contract, 'public', 'UnknownModel', { custom: 1 })).toEqual(
      ['custom'],
    );
  });

  it('resolveModelTableName() resolves from storage.table and throws when missing', () => {
    const contract = getTestContract();

    expect(resolveModelTableName(contract, 'public', 'User')).toBe('users');
    expect(() => resolveModelTableName(contract, 'public', 'UnknownModel')).toThrow(
      'Model "UnknownModel" has invalid or missing storage.table in namespace "public"',
    );
    expect(resolvePrimaryKeyColumn(contract, 'public', 'users')).toBe('id');
    expect(resolvePrimaryKeyColumn(contract, 'public', 'unknown_table')).toBe('id');
  });

  it('resolveModelTableName() reads from storage.table and throws for invalid values', () => {
    const contract = getTestContract();
    const withStorageFallback = withPatchedDomainModels(contract, (models) => ({
      ...models,
      User: {
        ...(models['User'] as { storage: Record<string, unknown> }),
        storage: {
          ...(models['User'] as { storage: Record<string, unknown> }).storage,
          table: 'users_from_storage',
        },
      },
    }));

    expect(resolveModelTableName(withStorageFallback, 'public', 'User')).toBe('users_from_storage');

    const invalidStorageTable = withPatchedDomainModels(contract, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        storage: {
          table: 123,
        },
      },
    }));

    expect(() => resolveModelTableName(invalidStorageTable, 'public', 'User')).toThrow(
      'Model "User" has invalid or missing storage.table in namespace "public"',
    );
  });

  it('hasContractCapability() checks nested object flags and invalid target entries', () => {
    const contract = getTestContract();
    const withNestedCapability = {
      ...contract,
      capabilities: {
        postgres: {
          returning: {
            enabled: true,
          },
        },
        sqlite: 'unsupported',
      },
    } as unknown as typeof contract;

    expect(hasContractCapability(withNestedCapability, 'returning')).toBe(true);
    expect(hasContractCapability(withNestedCapability, 'jsonAgg')).toBe(false);
  });

  it('hasContractCapability() returns false when no capabilities are set', () => {
    const contract = getTestContract();
    const withEmptyCapabilities = {
      ...contract,
      capabilities: {},
    } as typeof contract;

    expect(hasContractCapability(withEmptyCapabilities, 'returning')).toBe(false);
  });

  it('isToOneCardinality() identifies to-one relations', () => {
    expect(isToOneCardinality('1:1')).toBe(true);
    expect(isToOneCardinality('N:1')).toBe(true);
    expect(isToOneCardinality('1:N')).toBe(false);
    expect(isToOneCardinality('N:M')).toBe(false);
    expect(isToOneCardinality(undefined)).toBe(false);
  });

  describe('resolveRowIdentityColumns()', () => {
    const buildContract = (table: {
      primaryKey?: { columns: readonly string[] };
      uniques?: ReadonlyArray<{ columns: readonly string[] }>;
    }) =>
      ({
        storage: {
          namespaces: {
            __unbound__: {
              id: '__unbound__',
              entries: {
                table: {
                  t: {
                    primaryKey: table.primaryKey,
                    uniques: table.uniques ?? [],
                  },
                },
              },
            },
          },
        },
      }) as unknown as Parameters<typeof resolveRowIdentityColumns>[0];

    it('returns primary key columns when present', () => {
      expect(
        resolveRowIdentityColumns(
          buildContract({ primaryKey: { columns: ['id'] } }),
          '__unbound__',
          't',
        ),
      ).toEqual(['id']);
    });

    it('returns composite primary key columns when present', () => {
      expect(
        resolveRowIdentityColumns(
          buildContract({ primaryKey: { columns: ['a', 'b'] } }),
          '__unbound__',
          't',
        ),
      ).toEqual(['a', 'b']);
    });

    it('falls back to first unique constraint when no primary key', () => {
      expect(
        resolveRowIdentityColumns(
          buildContract({ uniques: [{ columns: ['email'] }, { columns: ['handle'] }] }),
          '__unbound__',
          't',
        ),
      ).toEqual(['email']);
    });

    it('returns composite unique columns when no primary key', () => {
      expect(
        resolveRowIdentityColumns(
          buildContract({ uniques: [{ columns: ['tenant_id', 'slug'] }] }),
          '__unbound__',
          't',
        ),
      ).toEqual(['tenant_id', 'slug']);
    });

    it('returns empty array when neither primary key nor uniques are defined', () => {
      expect(resolveRowIdentityColumns(buildContract({}), '__unbound__', 't')).toEqual([]);
    });

    it('returns empty array for unknown tables', () => {
      expect(
        resolveRowIdentityColumns(
          buildContract({ primaryKey: { columns: ['id'] } }),
          '__unbound__',
          'missing',
        ),
      ).toEqual([]);
    });
  });
});

describe('resolvePolymorphismInfo()', () => {
  it('returns undefined for non-polymorphic models', () => {
    const contract = getTestContract();
    expect(resolvePolymorphismInfo(contract, 'public', 'User')).toBeUndefined();
  });

  it('classifies Bug as STI (same table as Task)', () => {
    const contract = buildMixedPolyContract();
    const info = resolvePolymorphismInfo(contract, 'public', 'Task');
    expect(info).toBeDefined();
    const bugVariant = info!.variants.get('Bug');
    expect(bugVariant).toBeDefined();
    expect(bugVariant!.strategy).toBe('sti');
    expect(bugVariant!.table).toBe('tasks');
    expect(bugVariant!.value).toBe('bug');
  });

  it('classifies Feature as MTI (different table from Task)', () => {
    const contract = buildMixedPolyContract();
    const info = resolvePolymorphismInfo(contract, 'public', 'Task');
    expect(info).toBeDefined();
    const featureVariant = info!.variants.get('Feature');
    expect(featureVariant).toBeDefined();
    expect(featureVariant!.strategy).toBe('mti');
    expect(featureVariant!.table).toBe('features');
    expect(featureVariant!.value).toBe('feature');
  });

  it('resolves discriminator field and column', () => {
    const contract = buildMixedPolyContract();
    const info = resolvePolymorphismInfo(contract, 'public', 'Task')!;
    expect(info.discriminatorField).toBe('type');
    expect(info.discriminatorColumn).toBe('type');
    expect(info.baseTable).toBe('tasks');
  });

  it('populates variantsByValue keyed by discriminator value', () => {
    const contract = buildMixedPolyContract();
    const info = resolvePolymorphismInfo(contract, 'public', 'Task')!;
    expect(info.variantsByValue.get('bug')?.modelName).toBe('Bug');
    expect(info.variantsByValue.get('feature')?.modelName).toBe('Feature');
  });

  it('populates mtiVariants with only MTI variants', () => {
    const contract = buildMixedPolyContract();
    const info = resolvePolymorphismInfo(contract, 'public', 'Task')!;
    expect(info.mtiVariants).toHaveLength(1);
    expect(info.mtiVariants[0]!.modelName).toBe('Feature');
  });

  it('caches results per (contract, modelName)', () => {
    const contract = buildMixedPolyContract();
    const first = resolvePolymorphismInfo(contract, 'public', 'Task');
    const second = resolvePolymorphismInfo(contract, 'public', 'Task');
    expect(first).toBe(second);
  });

  it('returns undefined for variant models themselves', () => {
    const contract = buildMixedPolyContract();
    expect(resolvePolymorphismInfo(contract, 'public', 'Bug')).toBeUndefined();
    expect(resolvePolymorphismInfo(contract, 'public', 'Feature')).toBeUndefined();
  });

  it('throws when a declared variant model is missing from the contract', () => {
    const contract = buildMixedPolyContract();
    const withoutBug = withPatchedDomainModels(contract, (models) => {
      const { Bug: _removed, ...rest } = models;
      return rest;
    });
    expect(() => resolvePolymorphismInfo(withoutBug, 'public', 'Task')).toThrow(
      /declares variant "Bug", but that model is missing/,
    );
  });
});

describe('resolveModelRelations() through descriptor', () => {
  it('populates through descriptor for a simple single-column M:N relation', () => {
    const contract = getTestContract();

    const relations = resolveModelRelations(contract, 'public', 'User');
    expect(relations['tags']?.through).toEqual({
      table: 'user_tags',
      parentColumns: ['user_id'],
      childColumns: ['tag_id'],
      targetColumns: ['id'],
      requiredPayloadColumns: [],
      namespaceId: 'public',
    });
  });

  it('populates through descriptor for a composite-key M:N junction', () => {
    const contract = getTestContract();

    const through = resolveModelRelations(contract, 'public', 'Project')['related']?.through;
    expect(through?.parentColumns).toEqual(['src_tenant_id', 'src_id']);
    expect(through?.childColumns).toEqual(['dst_tenant_id', 'dst_id']);
    expect(through?.targetColumns).toEqual(['tenant_id', 'id']);
    expect(through?.requiredPayloadColumns).toEqual([]);
  });

  it('includes NOT-NULL no-default non-FK columns in requiredPayloadColumns', () => {
    const contract = getTestContract();

    expect(
      resolveModelRelations(contract, 'public', 'User')['roles']?.through?.requiredPayloadColumns,
    ).toEqual(['level']);
  });

  it('excludes nullable and defaulted non-FK columns from requiredPayloadColumns', () => {
    const contract = getTestContract();

    // user_tags carries a nullable `note` column and a `created_at` column with a
    // now() default alongside its FK pair, so neither belongs in the payload.
    expect(
      resolveModelRelations(contract, 'public', 'User')['tags']?.through?.requiredPayloadColumns,
    ).toEqual([]);
  });

  it('excludes execution-defaulted non-FK columns from requiredPayloadColumns', () => {
    // `user_roles.level` is NOT NULL with no storage default; its `field.generated`
    // execution onCreate default is the only thing that keeps it out of the
    // required-payload set.
    const contract = buildExecutionDefaultJunctionContract();

    expect(
      resolveModelRelations(contract, 'public', 'User')['roles']?.through?.requiredPayloadColumns,
    ).toEqual([]);
  });

  it('omits through when the junction table is absent from its declared namespace', () => {
    // A `through` pointing at a table that isn't in storage can't be authored —
    // it's a defensive guard, so exercise resolveThrough directly with a real
    // contract and a typed through whose table is missing (a guard input, not a
    // contract).
    const contract = getTestContract();
    const missingThrough: ContractRelationThrough = {
      table: 'missing_junction',
      namespaceId: 'public',
      parentColumns: ['user_id'],
      childColumns: ['tag_id'],
      targetColumns: ['id'],
    };

    expect(resolveThrough(contract, missingThrough)).toBeUndefined();
  });
});
