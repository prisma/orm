import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import type { ForeignKey, SqlStorage } from '@internal/sql-contract/types';
import {
  defineContract,
  extensionModel,
  field,
  model,
  rel,
} from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const supabaseExtensionPackRef = {
  kind: 'extension' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'supabase' as const,
  version: '0.0.1',
};

const int4Column = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;

describe('PSL ↔ TS namespace parity', () => {
  it('produces structurally equivalent Contract IR from PSL and TS builder for a 2-namespace schema with a cross-namespace FK', () => {
    // PSL authoring
    const pslDocument = symbolTableInputFromParseArgs({
      schema: `namespace auth {
  model User {
    id Int @id
    posts public.Post[]
    @@map("user")
  }
}

namespace public {
  model Post {
    id    Int @id
    userId Int
    user  auth.User @relation(fields: [userId], references: [id])
    @@map("post")
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const pslResult = interpretPslDocumentToSqlContract({
      ...pslDocument,
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      createNamespace: createTestSqlNamespace,
      dataTypeLookup: fixtureDataTypeSupport.lookup,
      capabilities: { sql: { scalarList: true } },
    });

    expect(pslResult.ok).toBe(true);
    if (!pslResult.ok) return;

    // TS builder authoring
    const UserBase = model('User', {
      namespace: 'auth',
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'user' });

    const Post = model('Post', {
      namespace: 'public',
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
      relations: { user: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }) },
    }).sql(({ cols, constraints }) => ({
      table: 'post',
      foreignKeys: [constraints.foreignKey(cols.userId, UserBase.refs.id)],
    }));

    const User = UserBase.relations({
      posts: rel.hasMany(() => Post, { by: 'userId' }),
    });

    const tsContract = defineContract({
      family: { kind: 'family', id: 'sql', familyId: 'sql', version: '0.0.1' },
      target: postgresTarget,
      namespaces: ['auth', 'public'] as const,
      models: { User, Post },
      createNamespace: createTestSqlNamespace,
    });

    const pslStorage = pslResult.value.storage as SqlStorage;
    const tsStorage = tsContract.storage as unknown as SqlStorage;

    // Same namespace keys
    expect(Object.keys(pslStorage.namespaces).sort()).toEqual(
      Object.keys(tsStorage.namespaces).sort(),
    );

    // Same per-namespace table keys
    for (const nsId of Object.keys(pslStorage.namespaces)) {
      const pslTables =
        pslStorage.namespaces[nsId] !== undefined
          ? (pslStorage.namespaces[nsId]!.entries.table ?? {})
          : {};
      const tsTables =
        tsStorage.namespaces[nsId] !== undefined
          ? (tsStorage.namespaces[nsId]!.entries.table ?? {})
          : {};
      expect(Object.keys(pslTables).sort()).toEqual(Object.keys(tsTables).sort());
    }

    // Same per-table column shapes
    const pslAuthUser = pslStorage.namespaces['auth']!.entries.table?.['user'];
    const tsAuthUser = tsStorage.namespaces['auth']!.entries.table?.['user'];
    expect(pslAuthUser?.columns).toEqual(tsAuthUser?.columns);

    const pslPublicPost = pslStorage.namespaces['public']!.entries.table?.['post'];
    const tsPublicPost = tsStorage.namespaces['public']!.entries.table?.['post'];
    expect(pslPublicPost?.columns).toEqual(tsPublicPost?.columns);

    // Same FK source/target
    const pslFks: readonly ForeignKey[] = pslPublicPost?.foreignKeys ?? [];
    const tsFks: readonly ForeignKey[] = tsPublicPost?.foreignKeys ?? [];
    expect(pslFks.length).toBe(1);
    expect(tsFks.length).toBe(1);
    expect(pslFks[0]).toMatchObject({
      source: { namespaceId: 'public', tableName: 'post' },
      target: { namespaceId: 'auth', tableName: 'user' },
    });
    expect(tsFks).toEqual(pslFks);
  });

  it('PSL colon-prefix produces byte-identical FK carriers to the TS builder for a cross-contract-space FK', () => {
    // Synthetic supabase extension contract with auth.User → table 'users'.
    const syntheticExtensionContract = blindCast<
      Contract,
      'synthetic extension contract — only domain.namespaces needed for FK table resolution'
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
      storage: { storageHash: coreHash('test'), namespaces: {} },
      capabilities: {},
      extensions: {},
      profileHash: profileHash('test-profile'),
      meta: {},
    });

    // PSL: supabase:auth.User cross-space reference.
    // With composedExtensionContracts provided, the interpreter resolves tableName = 'users'
    // directly from the extension contract — the same value the TS builder produces.
    const pslDocument = symbolTableInputFromParseArgs({
      schema: `model Profile {
  id    Int @id
  userId Int
  user  supabase:auth.User @relation(fields: [userId], references: [id])
  @@map("profile")
}
`,
      sourceId: 'schema.prisma',
    });

    const pslResult = interpretPslDocumentToSqlContract({
      ...pslDocument,
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      composedExtensions: ['supabase'],
      composedExtensionContracts: new Map([['supabase', syntheticExtensionContract]]),
      createNamespace: createTestSqlNamespace,
      dataTypeLookup: fixtureDataTypeSupport.lookup,
      capabilities: { sql: { scalarList: true } },
    });

    expect(pslResult.ok).toBe(true);
    if (!pslResult.ok) return;

    // TS builder: User handle branded with spaceId:'supabase', namespace:'auth', table:'users'.
    const User = extensionModel(
      'User',
      {
        namespace: 'auth',
        fields: { id: field.column({ codecId: 'pg/text@1', nativeType: 'text' }).id() },
        table: 'users',
      },
      'supabase' as const,
    );

    const Profile = model('Profile', {
      fields: {
        id: field.column({ codecId: 'pg/int4@1', nativeType: 'int4' }).id(),
        userId: field.column({ codecId: 'pg/int4@1', nativeType: 'int4' }),
      },
      relations: { user: rel.belongsTo(User, { from: 'userId', to: 'id' }) },
    }).sql(({ cols, constraints }) => ({
      table: 'profile',
      foreignKeys: [constraints.foreignKey(cols.userId, User.refs.id)],
    }));

    const tsContract = defineContract({
      family: { kind: 'family', id: 'sql', familyId: 'sql', version: '0.0.1' },
      target: postgresTarget,
      extensions: { supabase: supabaseExtensionPackRef },
      models: { Profile },
      createNamespace: createTestSqlNamespace,
    });

    const pslStorage = pslResult.value.storage as SqlStorage;
    const tsStorage = tsContract.storage as unknown as SqlStorage;

    const pslProfileTable = pslStorage.namespaces['public']!.entries.table?.['profile'];
    const pslFks: readonly ForeignKey[] = pslProfileTable?.foreignKeys ?? [];

    const tsProfileTable = tsStorage.namespaces['public']!.entries.table?.['profile'];
    const tsFks: readonly ForeignKey[] = tsProfileTable?.foreignKeys ?? [];

    expect(pslFks.length).toBe(1);
    expect(tsFks.length).toBe(1);

    // Both authoring paths produce identical FK carriers including tableName = 'users'.
    expect(tsFks).toEqual(pslFks);
  });

  it('emits PSL_UNKNOWN_CONTRACT_SPACE when the extension contract is absent from composedExtensionContracts', () => {
    // No contract for 'supabase' in the map — the interpreter must fail fast, not fall back to 'user'.
    const pslDocument = symbolTableInputFromParseArgs({
      schema: `model Profile {
  id    Int @id
  userId Int
  user  supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...pslDocument,
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensions: ['supabase'],
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      dataTypeLookup: fixtureDataTypeSupport.lookup,
      capabilities: { sql: { scalarList: true } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNKNOWN_CONTRACT_SPACE',
          data: expect.objectContaining({ space: 'supabase' }),
        }),
      ]),
    );
  });
});
