import type { Contract, ContractModel } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import type { ForeignKey, SqlModelStorage, SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import { fixtureGeneratorFunctions } from './fixture-generator-functions';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresScalarTypeDescriptors,
  postgresTarget,
  sqliteScalarColumnDescriptors,
  sqliteTarget,
} from './fixtures';

function makeSupabaseExtensionContract(): Contract {
  return blindCast<
    Contract,
    'synthetic supabase extension contract for interpreter FK resolution tests'
  >({
    target: 'postgres',
    targetFamily: 'sql',
    roots: {},
    domain: {
      namespaces: {
        auth: {
          models: {
            User: { fields: {}, relations: {}, storage: { table: 'users' } },
          },
        },
      },
    },
    storage: {
      storageHash: coreHash(`${'a'.repeat(64)}`),
      namespaces: {
        auth: {
          id: 'auth',
          entries: {
            table: {
              users: {
                columns: { id: { type: 'int4', nullable: false } },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    },
    capabilities: {},
    extensions: {},
    profileHash: profileHash(`${'b'.repeat(64)}`),
    meta: {},
  });
}

function makeSupabaseExtensionContractUnbound(): Contract {
  return blindCast<
    Contract,
    'synthetic supabase extension contract with __unbound__ namespace for interpreter FK resolution tests'
  >({
    target: 'postgres',
    targetFamily: 'sql',
    roots: {},
    domain: {
      namespaces: {
        __unbound__: {
          models: {
            User: { fields: {}, relations: {}, storage: { table: 'users' } },
          },
        },
      },
    },
    storage: {
      storageHash: coreHash(`${'c'.repeat(64)}`),
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          entries: {
            table: {
              users: {
                columns: { id: { type: 'int4', nullable: false } },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    },
    capabilities: {},
    extensions: {},
    profileHash: profileHash(`${'d'.repeat(64)}`),
    meta: {},
  });
}

const baseInput = {
  ...fixtureInterpreterTypes,
  target: postgresTarget,
  scalarColumnDescriptors: postgresScalarTypeDescriptors,
  controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  generatorFunctions: fixtureGeneratorFunctions,
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

describe('un-namespaced PG model defaults to public namespace (TML-2916)', () => {
  it('places a bare model in domain.namespaces.public and storage.namespaces.public, with no __unbound__ slot', () => {
    const result = interpretSqlContract(
      `model user {
  id String @id @onCreate(uuid())
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { domain, storage } = result.value;
    expect(domain.namespaces['public']).toBeDefined();
    expect(domain.namespaces['__unbound__']).toBeUndefined();
    expect((storage as SqlStorage).namespaces['public']).toBeDefined();
    expect((storage as SqlStorage).namespaces['__unbound__']).toBeUndefined();
  });
});

describe('interpretPslDocumentToSqlContract cross-namespace FK resolution', () => {
  it('lowers a qualified relation field type to a FK with target.namespaceId from the qualifier', () => {
    const result = interpretSqlContract(
      `namespace public {
  model Post {
    id Int @id
    userId Int
    user auth.User @relation(fields: [userId], references: [id])
  }
}

namespace auth {
  model User {
    id Int @id
    @@map("user")
  }
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    const postTable = storage.namespaces['public']!.entries.table?.['Post'];
    expect(postTable).toBeDefined();

    const fks: readonly ForeignKey[] = postTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: { namespaceId: 'auth', tableName: 'user' },
    });
  });

  it('carries the related-model namespace into a 1:N backrelation toNamespaceId', () => {
    const result = interpretSqlContract(
      `namespace public {
  model User {
    id Int @id
    posts blog.Post[]
  }
}

namespace blog {
  model Post {
    id Int @id
    authorId Int
    author public.User @relation(fields: [authorId], references: [id])
  }
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const publicModels = result.value.domain.namespaces['public']?.models as
      | Record<string, ContractModel<SqlModelStorage>>
      | undefined;
    expect(publicModels?.['User']?.relations?.['posts']).toMatchObject({
      cardinality: '1:N',
      to: { model: 'Post', namespace: 'blog' },
    });
  });

  it('refuses an unqualified relation to a model in a sibling namespace', () => {
    const result = interpretSqlContract(
      `namespace public {
  model Post {
    id Int @id
    userId Int
    user User @relation(fields: [userId], references: [id])
  }
}

namespace auth {
  model User {
    id Int @id
    @@map("user")
  }
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNRESOLVED_REFERENCE',
          message: expect.stringContaining('Cannot find type "User"'),
        }),
      ]),
    );
  });

  it('lowers an unqualified relation from another namespace to top-level and namespace public models', () => {
    const result = interpretSqlContract(
      [
        'model Account {\n  id Int @id\n}',
        'namespace public {\n  model Invoice {\n    id Int @id\n  }\n}',
        'namespace auth {\n  model Session {\n    id Int @id\n    accountId Int\n    invoiceId Int',
        '    account Account @relation(fields: [accountId], references: [id])',
        '    invoice Invoice @relation(fields: [invoiceId], references: [id])\n  }\n}\n',
      ].join('\n'),
      { ...baseInput },
    );

    expect(result.ok ? [] : result.failure.diagnostics).toEqual([]);
    if (!result.ok) return;
    const session = (result.value.storage as SqlStorage).namespaces['auth']!.entries.table?.[
      'Session'
    ];
    expect(session?.foreignKeys?.map((fk) => fk.target)).toEqual([
      { namespaceId: 'public', tableName: 'Account', columns: ['id'] },
      { namespaceId: 'public', tableName: 'Invoice', columns: ['id'] },
    ]);
  });

  it('on SQLite, reads unbound.User as the top-level User and emits the same contract', () => {
    const sqlite = {
      ...baseInput,
      target: sqliteTarget,
      scalarColumnDescriptors: sqliteScalarColumnDescriptors,
    };
    const schema = (type: string) =>
      `model User {\n  id Int @id\n}\nmodel Post {\n  id Int @id\n  userId Int\n  user ${type} @relation(fields: [userId], references: [id])\n}\n`;
    const bare = interpretSqlContract(schema('User'), sqlite);
    const qualified = interpretSqlContract(schema('unbound.User'), sqlite);

    expect(bare.ok && qualified.ok).toBe(true);
    if (!bare.ok || !qualified.ok) return;
    expect(qualified.value).toEqual(bare.value);
    expect(Object.keys((qualified.value.storage as SqlStorage).namespaces)).toEqual([
      '__unbound__',
    ]);
  });

  it('lowers the same bare table name in two namespaces with differing columns and a cross-namespace FK', () => {
    const result = interpretSqlContract(
      `namespace public {
  model User {
    id Int @id
    email String
    @@map("users")
  }
  model Profile {
    id Int @id
    userId Int
    user auth.User @relation(fields: [userId], references: [id])
    @@map("profile")
  }
}

namespace auth {
  model User {
    id Int @id
    token String
    @@map("users")
  }
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    const publicUsers = storage.namespaces['public']!.entries.table?.['users'];
    const authUsers = storage.namespaces['auth']!.entries.table?.['users'];
    expect(Object.keys(publicUsers?.columns ?? {}).sort()).toEqual(['email', 'id']);
    expect(Object.keys(authUsers?.columns ?? {}).sort()).toEqual(['id', 'token']);

    const fks: readonly ForeignKey[] =
      storage.namespaces['public']!.entries.table?.['profile']?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({ target: { namespaceId: 'auth', tableName: 'users' } });

    const publicModels = result.value.domain.namespaces['public']?.models as
      | Record<string, ContractModel<SqlModelStorage>>
      | undefined;
    const authModels = result.value.domain.namespaces['auth']?.models as
      | Record<string, ContractModel<SqlModelStorage>>
      | undefined;
    expect(publicModels?.['User']?.storage.table).toBe('users');
    expect(publicModels?.['User']?.storage.namespaceId).toBe('public');
    expect(authModels?.['User']?.storage.table).toBe('users');
    expect(authModels?.['User']?.storage.namespaceId).toBe('auth');
    expect(publicModels?.['Profile']?.relations?.['user']?.to).toEqual({
      namespace: 'auth',
      model: 'User',
    });
  });
});

describe('interpretPslDocumentToSqlContract cross-contract-space FK (PSL colon-prefix)', () => {
  it('refuses a field typed by another contract space without @relation', () => {
    const result = interpretSqlContract(
      `model Profile {
  id Int @id
  user supabase:auth.User
}
`,
      {
        ...baseInput,
        composedExtensions: ['supabase'],
        composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContract()]]),
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message:
          'Field "Profile.user" type "User" is a type of contract space "supabase"; only a relation field can name a type of another contract space.',
      },
    ]);
  });

  it('lowers supabase:auth.User to a FK with spaceId=supabase and namespaceId=auth', () => {
    const result = interpretSqlContract(
      `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      {
        ...baseInput,
        composedExtensions: ['supabase'],
        composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContract()]]),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    // Unbound namespace (no explicit namespace block)
    const profileTable = Object.values(storage.namespaces)
      .flatMap((ns) => Object.values(ns.entries.table ?? {}))
      .find((t) => t !== undefined);
    expect(profileTable).toBeDefined();

    const fks: readonly ForeignKey[] = profileTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: {
        spaceId: 'supabase',
        namespaceId: 'auth',
        columns: ['id'],
      },
    });
  });

  it('lowers supabase:User (no-namespace form) with namespaceId=__unbound__ (AC3)', () => {
    const result = interpretSqlContract(
      `model Profile {
  id Int @id
  userId Int
  user supabase:User @relation(fields: [userId], references: [id])
}
`,
      {
        ...baseInput,
        composedExtensions: ['supabase'],
        composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContractUnbound()]]),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    const profileTable = Object.values(storage.namespaces)
      .flatMap((ns) => Object.values(ns.entries.table ?? {}))
      .find((t) => t !== undefined);
    const fks: readonly ForeignKey[] = profileTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: {
        spaceId: 'supabase',
        namespaceId: '__unbound__',
        columns: ['id'],
      },
    });
  });

  it('emits PSL_UNKNOWN_CONTRACT_SPACE when the space is not in composedExtensions', () => {
    // supabase is NOT in composedExtensions
    const result = interpretSqlContract(
      `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNKNOWN_CONTRACT_SPACE',
          message: expect.stringContaining('supabase'),
        }),
      ]),
    );
  });

  it('F-list: cross-space list relation emits PSL_UNSUPPORTED_CROSS_SPACE_LIST diagnostic instead of silently dropping it', () => {
    const result = interpretSqlContract(
      `model Profile {
  id Int @id
  userId Int
  posts supabase:auth.Post[] @relation(fields: [userId], references: [id])
}
`,
      {
        ...baseInput,
        composedExtensions: ['supabase'],
      },
    );

    // The result should fail with a diagnostic (not silently succeed with 0 FKs)
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_CROSS_SPACE_LIST',
          message: expect.stringContaining('posts'),
        }),
      ]),
    );
  });

  it('cross-space FK with onDelete:cascade emits no diagnostic (AC4)', () => {
    const result = interpretSqlContract(
      `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
`,
      {
        ...baseInput,
        composedExtensions: ['supabase'],
        composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContract()]]),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    const profileTable = Object.values(storage.namespaces)
      .flatMap((ns) => Object.values(ns.entries.table ?? {}))
      .find((t) => t !== undefined);
    const fks: readonly ForeignKey[] = profileTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: { spaceId: 'supabase' },
      onDelete: 'cascade',
    });
  });

  it('resolves FK target.tableName from the extension contract when composedExtensionContracts is provided', () => {
    const result = interpretSqlContract(
      `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      {
        ...baseInput,
        composedExtensions: ['supabase'],
        composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContract()]]),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    const profileTable = Object.values(storage.namespaces)
      .flatMap((ns) => Object.values(ns.entries.table ?? {}))
      .find((t) => t !== undefined);
    const fks: readonly ForeignKey[] = profileTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: {
        spaceId: 'supabase',
        namespaceId: 'auth',
        tableName: 'users',
        columns: ['id'],
      },
    });
  });

  it('emits PSL_UNKNOWN_CONTRACT_SPACE when the named space has no entry in composedExtensionContracts (fail-fast, no toLowerCase fallback)', () => {
    // supabase IS in composedExtensions but NOT in composedExtensionContracts
    const result = interpretSqlContract(
      `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      {
        ...baseInput,
        composedExtensions: ['supabase'],
        composedExtensionContracts: new Map(), // empty — no contract for supabase
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNKNOWN_CONTRACT_SPACE',
          message: expect.stringContaining('supabase'),
        }),
      ]),
    );
    // Confirm the old toLowerCase fallback ('user') is NOT silently produced
    expect(
      result.failure.diagnostics.every((d) => d.code !== 'PSL_UNKNOWN_CROSS_SPACE_TARGET'),
    ).toBe(true);
  });

  it('emits PSL_UNKNOWN_CROSS_SPACE_TARGET when the extension contract is provided but the model is not found', () => {
    const result = interpretSqlContract(
      `model Profile {
  id Int @id
  userId Int
  user supabase:auth.NonExistentModel @relation(fields: [userId], references: [id])
}
`,
      {
        ...baseInput,
        composedExtensions: ['supabase'],
        composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContract()]]),
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNKNOWN_CROSS_SPACE_TARGET',
          message: expect.stringContaining('NonExistentModel'),
        }),
      ]),
    );
  });
});
