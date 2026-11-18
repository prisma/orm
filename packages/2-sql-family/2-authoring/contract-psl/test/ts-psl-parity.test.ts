import type { AuthoringContributions } from '@internal/framework-components/authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { defineIndexTypes } from '@internal/sql-contract/index-types';
import type { ForeignKey, SqlStorage } from '@internal/sql-contract/types';
import { defineContract, field, model, rel, sql } from '@internal/sql-contract-ts/contract-builder';
import { countSemanticLines } from '@repo/test-utils/semantic-lines';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes, fixtureTypeLookups } from './fixture-codec-descriptors';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {},
} as const satisfies FamilyPackRef<'sql'>;

const portablePostgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  authoring: {
    entityTypes: testEnumEntityContributions,
    pslBlockDescriptors: { enum: testEnumPslBlockDescriptor },
    type: {},
  },
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const pgvectorExtensionPack = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    type: {
      pgvector: {
        Vector: {
          kind: 'typeConstructor',
          args: [{ kind: 'value', dataType: 'pg/int4', name: 'length' }],
          output: {
            codecId: 'pg/vector@1',
            typeParams: {
              length: { kind: 'arg', index: 0 },
            },
          },
        },
      },
    },
  },
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

const authoringContributions = {
  entityTypes: portablePostgresTargetPack.authoring.entityTypes,
  type: {
    ...portablePostgresTargetPack.authoring.type,
    ...pgvectorExtensionPack.authoring.type,
  },
} as const satisfies AuthoringContributions;

const scalarColumnDescriptors = new Map([
  ['Int', { codecId: 'pg/int4@1' }],
  ['String', { codecId: 'sql/text@1' }],
  ['DateTime', { codecId: 'test/timestamp@1' }],
  ['Bytes', { codecId: 'pg/bytea@1' }],
] as const);

const int4Column = {
  codecId: 'pg/int4@1',
} as const satisfies ColumnTypeDescriptor;

const textColumn = {
  codecId: 'sql/text@1',
} as const satisfies ColumnTypeDescriptor;

const representativePslSchema = `types {
  Embedding1536 = pgvector.Vector(1536)
}

enum Role {
  @@type("pg/text@1")
  USER  = "user"
  ADMIN = "admin"
}

model User {
  id Int @id(map: "user_pkey")
  email String @unique(map: "user_email_key")
  role Role
  embedding Embedding1536?
  createdAt DateTime @default(now())
  posts Post[]
  @@map("user")
}

model Post {
  id Int @id(map: "post_pkey")
  authorId Int
  title String
  author User @relation(fields: [authorId], references: [id], map: "post_author_id_fkey", onDelete: Cascade)
  @@index([authorId], map: "post_author_id_idx")
  @@map("post")
}
`;

const representativeTsAuthoring = `const Role = enumType('Role', pgText, member('USER', 'user'), member('ADMIN', 'admin'));
defineContract(
  { ...fixtureTypeLookups, family: sqlFamilyPack, target: portablePostgresTargetPack, extensions: { pgvector: pgvectorExtensionPack } },
  ({ type, field, model, rel }) => {
    const types = {
      Embedding1536: type.pgvector.Vector(1536),
    } as const;
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id({ name: 'user_pkey' }),
        email: field.column(type.String()).unique({ name: 'user_email_key' }),
        role: field.namedType(Role),
        embedding: field.namedType(types.Embedding1536).optional(),
        createdAt: field.column(type.temporal.CreatedAt()),
      },
      relations: { posts: rel.hasMany(() => Post, { by: 'authorId' }) },
    }).sql({ table: 'user' });
    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id({ name: 'post_pkey' }),
        authorId: field.column(int4Column),
        title: field.column(type.String()),
      },
      relations: { author: rel.belongsTo(User, { from: 'authorId', to: 'id' }) },
    }).sql(({ cols, constraints }) => ({
      table: 'post',
      indexes: [constraints.index([cols.authorId], { name: 'post_author_id_idx' })],
      foreignKeys: [constraints.foreignKey(cols.authorId, User.refs.id, { name: 'post_author_id_fkey', onDelete: 'cascade' })],
    }));
    return { enums: { Role }, types, models: { User, Post } };
  },
)`;

describe('TS and PSL authoring parity', () => {
  it('keeps the contract DSL within the terseness threshold for the same contract', () => {
    const pslLines = countSemanticLines(representativePslSchema);
    const tsLines = countSemanticLines(representativeTsAuthoring);

    expect(tsLines).toBeLessThanOrEqual(Math.ceil(pslLines * 1.6));
  });

  it('PSL and TS lower the same cross-namespace FK shape to identical contract IR', () => {
    const pslContract = interpretSqlContract(
      `namespace auth {
  model User {
    id Int @id
    posts Post[]
    @@map("user")
  }
}

model Post {
  id Int @id
  authorId Int
  author auth.User @relation(fields: [authorId], references: [id])
  @@map("post")
}
`,
      {
        target: portablePostgresTargetPack,
        scalarColumnDescriptors,
        composedExtensionContracts: new Map(),
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
        authoringContributions,
        createNamespace: createTestSqlNamespace,
        ...fixtureInterpreterTypes,
        capabilities: { sql: { scalarList: true } },
      },
    );

    expect(pslContract.ok).toBe(true);
    if (!pslContract.ok) return;

    const UserBase = model('User', {
      namespace: 'auth',
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'user' });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
        authorId: field.column(int4Column),
      },
      relations: { author: rel.belongsTo(UserBase, { from: 'authorId', to: 'id' }) },
    }).sql(({ cols, constraints }) => ({
      table: 'post',
      foreignKeys: [constraints.foreignKey(cols.authorId, UserBase.refs.id)],
    }));

    const User = UserBase.relations({
      posts: rel.hasMany(() => Post, { by: 'authorId' }),
    });

    const tsContract = defineContract({
      ...fixtureTypeLookups,
      family: sqlFamilyPack,
      target: portablePostgresTargetPack,
      namespaces: ['auth'],
      models: { User, Post },
      createNamespace: createTestSqlNamespace,
    });

    const pslStorage = pslContract.value.storage as unknown as SqlStorage;
    const tsStorage = tsContract.storage as unknown as SqlStorage;
    const pslFks: readonly ForeignKey[] =
      pslStorage.namespaces['public']!.entries.table?.['post']?.foreignKeys ?? [];
    const tsFks: readonly ForeignKey[] =
      tsStorage.namespaces['public']!.entries.table?.['post']?.foreignKeys ?? [];

    expect(tsFks.length).toBe(1);
    expect(pslFks.length).toBe(1);
    expect(tsFks[0]).toMatchObject({
      source: { namespaceId: 'public', tableName: 'post' },
      target: { namespaceId: 'auth', tableName: 'user' },
    });
    expect(pslFks[0]).toMatchObject({
      source: { namespaceId: 'public', tableName: 'post' },
      target: { namespaceId: 'auth', tableName: 'user' },
    });
    expect(tsFks).toEqual(pslFks);
  });

  it('PSL and TS lower the same expression index to identical wire-named IR (wire name pinned)', () => {
    const pslContract = interpretSqlContract(
      `model User {
  id    Int    @id
  email String
  @@index(expression: sql\`lower(email)\`, name: "users_email_eq")
  @@map("user")
}
`,
      {
        target: portablePostgresTargetPack,
        scalarColumnDescriptors,
        composedExtensionContracts: new Map(),
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
        authoringContributions,
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
        ...fixtureInterpreterTypes,
      },
    );
    expect(pslContract.ok).toBe(true);
    if (!pslContract.ok) return;

    const tsContract = defineContract({
      ...fixtureTypeLookups,
      family: sqlFamilyPack,
      target: portablePostgresTargetPack,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ constraints }) => ({
          table: 'user',
          indexes: [constraints.index({ expression: sql`lower(email)`, name: 'users_email_eq' })],
        })),
      },
      createNamespace: createTestSqlNamespace,
    });

    const pslIndexes = (pslContract.value.storage as unknown as SqlStorage).namespaces['public']
      ?.entries.table?.['user']?.indexes;
    const tsIndexes = (tsContract.storage as unknown as SqlStorage).namespaces['public']?.entries
      .table?.['user']?.indexes;
    expect(pslIndexes).toEqual([
      {
        name: 'users_email_eq_17273133',
        prefix: 'users_email_eq',
        expression: 'lower(email)',
        unique: false,
      },
    ]);
    expect(tsIndexes).toEqual(pslIndexes);
  });

  it('PSL and TS lower the full matrix (expression+where+unique+type) to identical IR', () => {
    const indexTypesPack = {
      kind: 'extension',
      id: 'parity-index-types',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      indexTypes: defineIndexTypes().add('bm25', { options: type('object') }),
    } as const;

    const pslContract = interpretSqlContract(
      `model User {
  id    Int    @id
  email String
  @@index(expression: sql\`eql_v3.eq_term(email)\`, where: sql\`(deleted_at IS NULL)\`, unique: true, name: "users_email_eq", type: "bm25", options: {})
  @@map("user")
}
`,
      {
        target: portablePostgresTargetPack,
        scalarColumnDescriptors,
        composedExtensions: [indexTypesPack.id],
        composedExtensionPackRefs: [indexTypesPack],
        composedExtensionContracts: new Map(),
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
        authoringContributions,
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
        ...fixtureInterpreterTypes,
      },
    );
    expect(pslContract.ok).toBe(true);
    if (!pslContract.ok) return;

    const tsContract = defineContract(
      {
        ...fixtureTypeLookups,
        family: sqlFamilyPack,
        target: portablePostgresTargetPack,
        extensions: { indexTypes: indexTypesPack },
        createNamespace: createTestSqlNamespace,
      },
      ({ model: helperModel, field: helperField }) => ({
        models: {
          User: helperModel('User', {
            fields: {
              id: helperField.column(int4Column).id(),
              email: helperField.column(textColumn),
            },
          }).sql(({ constraints }) => ({
            table: 'user',
            indexes: [
              constraints.index({
                expression: sql`eql_v3.eq_term(email)`,
                where: sql`(deleted_at IS NULL)`,
                unique: true,
                name: 'users_email_eq',
                type: 'bm25',
                options: {},
              }),
            ],
          })),
        },
      }),
    );

    const pslIndexes = (pslContract.value.storage as unknown as SqlStorage).namespaces['public']
      ?.entries.table?.['user']?.indexes;
    const tsIndexes = (tsContract.storage as unknown as SqlStorage).namespaces['public']?.entries
      .table?.['user']?.indexes;
    expect(pslIndexes).toEqual([
      {
        name: 'users_email_eq_afd32a8f',
        prefix: 'users_email_eq',
        expression: 'eql_v3.eq_term(email)',
        where: '(deleted_at IS NULL)',
        unique: true,
        type: 'bm25',
        options: {},
      },
    ]);
    expect(tsIndexes).toEqual(pslIndexes);
  });

  it('PSL map: and TS map: lower the same exact fields index', () => {
    const pslContract = interpretSqlContract(
      `model User {
  id    Int    @id
  email String
  @@index([email], map: "users_email_adopted")
  @@map("user")
}
`,
      {
        target: portablePostgresTargetPack,
        scalarColumnDescriptors,
        composedExtensionContracts: new Map(),
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
        authoringContributions,
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
        ...fixtureInterpreterTypes,
      },
    );
    expect(pslContract.ok).toBe(true);
    if (!pslContract.ok) return;

    const tsContract = defineContract({
      ...fixtureTypeLookups,
      family: sqlFamilyPack,
      target: portablePostgresTargetPack,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [constraints.index([cols.email], { map: 'users_email_adopted' })],
        })),
      },
      createNamespace: createTestSqlNamespace,
    });

    const pslIndexes = (pslContract.value.storage as unknown as SqlStorage).namespaces['public']
      ?.entries.table?.['user']?.indexes;
    const tsIndexes = (tsContract.storage as unknown as SqlStorage).namespaces['public']?.entries
      .table?.['user']?.indexes;
    expect(pslIndexes).toEqual([
      { name: 'users_email_adopted', columns: ['email'], unique: false },
    ]);
    expect(tsIndexes).toEqual(pslIndexes);
  });

  it('PSL name: and TS name: lower the same wire-named fields index (wire name pinned)', () => {
    const pslContract = interpretSqlContract(
      `model User {
  id    Int    @id
  email String
  @@index([email], name: "user_email_lookup")
  @@map("user")
}
`,
      {
        target: portablePostgresTargetPack,
        scalarColumnDescriptors,
        composedExtensionContracts: new Map(),
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
        authoringContributions,
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
        ...fixtureInterpreterTypes,
      },
    );
    expect(pslContract.ok).toBe(true);
    if (!pslContract.ok) return;

    const tsContract = defineContract({
      ...fixtureTypeLookups,
      family: sqlFamilyPack,
      target: portablePostgresTargetPack,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [constraints.index([cols.email], { name: 'user_email_lookup' })],
        })),
      },
      createNamespace: createTestSqlNamespace,
    });

    const pslIndexes = (pslContract.value.storage as unknown as SqlStorage).namespaces['public']
      ?.entries.table?.['user']?.indexes;
    const tsIndexes = (tsContract.storage as unknown as SqlStorage).namespaces['public']?.entries
      .table?.['user']?.indexes;
    expect(pslIndexes).toEqual([
      {
        name: 'user_email_lookup_46df9cad',
        prefix: 'user_email_lookup',
        columns: ['email'],
        unique: false,
      },
    ]);
    expect(tsIndexes).toEqual(pslIndexes);
  });

  it('PSL and TS lower the same unnamed index to identical wire-named IR (wire names pinned)', () => {
    const pslContract = interpretSqlContract(
      `model User {
  id Int @id
  email String @map("email")
  @@index([email])
  @@map("user")
}
`,
      {
        target: portablePostgresTargetPack,
        scalarColumnDescriptors,
        composedExtensionContracts: new Map(),
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
        authoringContributions,
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
        ...fixtureInterpreterTypes,
      },
    );

    expect(pslContract.ok).toBe(true);
    if (!pslContract.ok) return;

    const tsContract = defineContract({
      ...fixtureTypeLookups,
      family: sqlFamilyPack,
      target: portablePostgresTargetPack,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [constraints.index([cols.email])],
        })),
      },
      createNamespace: createTestSqlNamespace,
    });

    const pslStorage = pslContract.value.storage as unknown as SqlStorage;
    const tsStorage = tsContract.storage as unknown as SqlStorage;
    const pslIndexes = pslStorage.namespaces['public']?.entries.table?.['user']?.indexes;
    const tsIndexes = tsStorage.namespaces['public']?.entries.table?.['user']?.indexes;

    expect(pslIndexes).toEqual([
      {
        name: 'user_email_idx_46df9cad',
        prefix: 'user_email_idx',
        columns: ['email'],
        unique: false,
      },
    ]);
    expect(tsIndexes).toEqual(pslIndexes);
  });
});
