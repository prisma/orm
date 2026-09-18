import type { Contract, ContractModel } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import type { ForeignKey, SqlModelStorage, SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  sqliteScalarColumnDescriptors,
  sqliteTarget,
  symbolTableInputFromParseArgs,
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
  target: postgresTarget,
  scalarColumnDescriptors: postgresScalarTypeDescriptors,
  controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

describe('reopened namespace interpretation', () => {
  const wrap = (body: string, name = 'blog') => `namespace ${name} {\n${body}\n}`;
  const user = 'model User {\n id Int @id\n posts Post[]\n @@map("users")\n}';
  const post =
    'model Post {\n id Int @id\n userId Int\n user User @relation(fields: [userId], references: [id])\n address Address?\n @@map("posts")\n}';
  const address = 'type Address {\n street String\n}';
  const interpret = (schema: string) =>
    interpretPslDocumentToSqlContract({
      ...baseInput,
      ...symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' }),
      authoringContributions: {
        type: postgresScalarAuthoringTypes,
        valueObjectStorageType: 'Jsonb',
      },
    });

  it('preserves complete contract semantics across consolidated, split and reversed blocks', () => {
    const consolidated = interpret(wrap([user, post, address].join('\n')));
    expect(consolidated.ok).toBe(true);
    if (!consolidated.ok) throw new Error(consolidated.failure.summary);
    for (const members of [
      [user, post, address],
      [address, post, user],
    ]) {
      const result = interpret(members.map((member) => wrap(member)).join('\n'));
      expect(result).toEqual(consolidated);
    }
    const storage = consolidated.value.storage as SqlStorage;
    expect(storage.namespaces['blog']?.entries.table?.['posts']?.foreignKeys).toEqual([
      expect.objectContaining({
        source: { namespaceId: 'blog', tableName: 'posts', columns: ['userId'] },
        target: { namespaceId: 'blog', tableName: 'users', columns: ['id'] },
      }),
    ]);
    expect(consolidated.value.domain.namespaces['blog']?.models['Post']?.relations).toMatchObject({
      user: { to: { model: 'User', namespace: 'blog' }, cardinality: 'N:1' },
    });
    expect(
      consolidated.value.domain.namespaces['blog']?.models['Post']?.fields['address'],
    ).toBeDefined();
  });

  it.each([
    'model Shared {\n id Int @id\n}',
    'model Shared {\n other Int @id\n}',
    'type Shared {\n other String\n}',
  ])('preserves one later-name duplicate diagnostic for %s', (later) => {
    const schema = `${wrap('model Shared {\n id Int @id\n}')}\n${wrap(later)}`;
    const input = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
    expect(input.seedDiagnostics).toHaveLength(1);
    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...input });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected duplicate rejection');
    expect(result.failure.diagnostics).toEqual(input.seedDiagnostics);
    expect(result.failure.diagnostics[0]).toMatchObject({
      code: 'PSL_DUPLICATE_DECLARATION',
      message: 'Duplicate declaration of "Shared"',
      span: {
        start: { offset: schema.lastIndexOf('Shared') },
        end: { offset: schema.lastIndexOf('Shared') + 6 },
      },
    });
  });

  it.each([
    ['enum Role {\n Admin\n}', 'PSL_ENUM_NAMESPACE_NOT_SUPPORTED'],
    ['mystery Later {\n}', 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK'],
  ])('rejects a forbidden block in a later reopening: %s', (block, code) => {
    const result = interpret(`${wrap('model A {\n id Int @id\n}')}\n${wrap(block)}`);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected unsupported block rejection');
    expect(result.failure.diagnostics).toEqual([expect.objectContaining({ code })]);
  });

  it.each(['blog', '__proto__'])('preserves SQLite namespace rejection for %s', (name) => {
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...symbolTableInputFromParseArgs({
        schema: `${wrap('', name)}\n${wrap('model A {\n id Int @id\n}', name)}`,
      }),
      target: sqliteTarget,
      scalarColumnDescriptors: sqliteScalarColumnDescriptors,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected SQLite namespace rejection');
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({ code: 'PSL_UNSUPPORTED_NAMESPACE_BLOCK' }),
    ]);
  });

  it('rejects an unbound Postgres model in a later reopening alongside a named sibling', () => {
    const result = interpret(
      `${wrap('', '__unbound__')}\n${wrap('model A {\n id Int @id\n}', '__unbound__')}\n${wrap('model B {\n id Int @id\n}')}`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected reserved namespace rejection');
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({ code: 'PSL_RESERVED_NAMESPACE_NAME' }),
    ]);
  });

  it('preserves unqualified relation resolution into a reopened sibling namespace', () => {
    const result = interpret(
      `${wrap('model Post {\n id Int @id\n userId Int\n user User @relation(fields: [userId], references: [id])\n}')}\n${wrap('', 'auth')}\n${wrap('model User {\n id Int @id\n}', 'auth')}`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failure.summary);
    expect(
      (result.value.storage as SqlStorage).namespaces['blog']?.entries.table?.['Post']?.foreignKeys,
    ).toEqual([
      expect.objectContaining({
        target: { namespaceId: 'auth', tableName: 'User', columns: ['id'] },
      }),
    ]);
  });
});

describe('un-namespaced PG model defaults to public namespace (TML-2916)', () => {
  it('places a bare model in domain.namespaces.public and storage.namespaces.public, with no __unbound__ slot', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model user {
  id String @id @default(uuid())
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

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
    const document = symbolTableInputFromParseArgs({
      schema: `namespace public {
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
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

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
    const document = symbolTableInputFromParseArgs({
      schema: `namespace public {
  model User {
    id Int @id
    posts blog.Post[]
  }
}

namespace blog {
  model Post {
    id Int @id
    authorId Int
    author User @relation(fields: [authorId], references: [id])
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

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

  it('lowers an unqualified relation to a model that lives in another namespace', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `namespace public {
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
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    const postTable = storage.namespaces['public']!.entries.table?.['Post'];
    const fks: readonly ForeignKey[] = postTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: { namespaceId: 'auth', tableName: 'user' },
    });
  });

  it('lowers the same bare table name in two namespaces with differing columns and a cross-namespace FK', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `namespace public {
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
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

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

  it('emits PSL_INVALID_RELATION_TARGET when qualifier names a non-existent namespace', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `namespace public {
  model Post {
    id Int @id
    userId Int
    user wrong.User @relation(fields: [userId], references: [id])
  }
}

namespace auth {
  model User {
    id Int @id
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_RELATION_TARGET',
          message: expect.stringContaining('wrong.User'),
        }),
      ]),
    );
  });
});

describe('interpretPslDocumentToSqlContract cross-contract-space FK (PSL colon-prefix)', () => {
  it('lowers supabase:auth.User to a FK with spaceId=supabase and namespaceId=auth', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: ['supabase'],
      composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContract()]]),
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: ['supabase'],
      composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContractUnbound()]]),
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    // supabase is NOT in composedExtensions
    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Profile {
  id Int @id
  userId Int
  posts supabase:auth.Post[] @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: ['supabase'],
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: ['supabase'],
      composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContract()]]),
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: ['supabase'],
      composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContract()]]),
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    // supabase IS in composedExtensions but NOT in composedExtensionContracts
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: ['supabase'],
      composedExtensionContracts: new Map(), // empty — no contract for supabase
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:auth.NonExistentModel @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: ['supabase'],
      composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContract()]]),
    });

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
