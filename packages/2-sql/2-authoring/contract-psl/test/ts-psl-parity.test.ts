import type { AuthoringContributions } from '@internal/framework-components/authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { defineIndexTypes } from '@internal/sql-contract/index-types';
import type { ForeignKey, SqlStorage } from '@internal/sql-contract/types';
import { defineContract, field, model, rel } from '@internal/sql-contract-ts/contract-builder';
import { countSemanticLines } from '@repo/test-utils/semantic-lines';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  symbolTableInputFromParseArgs,
  temporalCodecPresetMirrors,
  temporalConvenienceMirrors,
  testEnumEntityContributions,
} from './fixtures';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sql/text@1',
          nativeType: 'text',
        },
      },
      temporal: {
        createdAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'test/timestamp@1',
            nativeType: 'timestamp',
            default: {
              kind: 'function',
              expression: 'now()',
            },
          },
        },
      },
    },
  },
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
          args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 2000 }],
          output: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
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
  field: sqlFamilyPack.authoring.field,
  entityTypes: portablePostgresTargetPack.authoring.entityTypes,
  type: {
    ...portablePostgresTargetPack.authoring.type,
    ...pgvectorExtensionPack.authoring.type,
  },
} as const satisfies AuthoringContributions;

const scalarColumnDescriptors = new Map([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
  ['String', { codecId: 'sql/text@1', nativeType: 'text' }],
  ['DateTime', { codecId: 'test/timestamp@1', nativeType: 'timestamp' }],
  ['Bytes', { codecId: 'pg/bytea@1', nativeType: 'bytea' }],
] as const);

const int4Column = {
  codecId: 'pg/int4@1',
  nativeType: 'int4',
} as const satisfies ColumnTypeDescriptor;

const textColumn = {
  codecId: 'sql/text@1',
  nativeType: 'text',
} as const satisfies ColumnTypeDescriptor;

const bareSqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const sqliteTimestampTargetPack = {
  kind: 'target',
  id: 'sqlite',
  familyId: 'sql',
  targetId: 'sqlite',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
  authoring: {
    field: {
      int: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sqlite/integer@1',
          nativeType: 'integer',
        },
      },
      text: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sqlite/text@1',
          nativeType: 'text',
        },
      },
      temporal: {
        createdAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sqlite/datetime@1',
            nativeType: 'text',
            default: {
              kind: 'function',
              expression: 'now()',
            },
          },
        },
        updatedAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sqlite/datetime@1',
            nativeType: 'text',
            executionDefaults: {
              onCreate: { kind: 'generator', id: 'timestampNow' },
              onUpdate: { kind: 'generator', id: 'timestampNow' },
            },
          },
        },
      },
    },
  },
} as const satisfies TargetPackRef<'sql', 'sqlite'>;

const postgresTimestampTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  authoring: {
    field: {
      int: {
        kind: 'fieldPreset',
        output: {
          codecId: 'pg/int4@1',
          nativeType: 'int4',
        },
      },
      text: {
        kind: 'fieldPreset',
        output: {
          codecId: 'pg/text@1',
          nativeType: 'text',
        },
      },
      temporal: {
        ...temporalConvenienceMirrors.postgres,
        // From `temporalCodecPresetMirrors` in fixtures.ts, which family-sql's
        // temporal-codec-presets.test.ts asserts deep-equals the real factory
        // output — so a factory change cannot leave this parity test passing
        // against a preset that no longer ships.
        timestamptz: temporalCodecPresetMirrors.pgTimestamptz,
      },
    },
  },
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const postgresTimestampScalarTypeDescriptors = new Map([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['DateTime', { codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' }],
  ['Json', { codecId: 'pg/json@1', nativeType: 'json' }],
  ['Jsonb', { codecId: 'pg/jsonb@1', nativeType: 'jsonb' }],
] as const);

const postgresTimestampAuthoringContributions = {
  field: postgresTimestampTargetPack.authoring.field,
} as const satisfies AuthoringContributions;

const sqliteTimestampScalarTypeDescriptors = new Map([
  ['Int', { codecId: 'sqlite/integer@1', nativeType: 'integer' }],
  ['String', { codecId: 'sqlite/text@1', nativeType: 'text' }],
  ['DateTime', { codecId: 'sqlite/datetime@1', nativeType: 'text' }],
  ['Json', { codecId: 'sqlite/json@1', nativeType: 'text' }],
] as const);

const sqliteTimestampAuthoringContributions = {
  field: sqliteTimestampTargetPack.authoring.field,
} as const satisfies AuthoringContributions;

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
}

model Post {
  id Int @id(map: "post_pkey")
  authorId Int
  title String
  author User @relation(fields: [authorId], references: [id], map: "post_author_id_fkey", onDelete: Cascade)
  @@index([authorId], map: "post_author_id_idx")
}
`;

const representativeTsAuthoring = `const Role = enumType('Role', pgText, member('USER', 'user'), member('ADMIN', 'admin'));
defineContract(
  { family: sqlFamilyPack, target: portablePostgresTargetPack, extensions: { pgvector: pgvectorExtensionPack } },
  ({ type, field, model, rel }) => {
    const types = {
      Embedding1536: type.pgvector.Vector(1536),
    } as const;
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id({ name: 'user_pkey' }),
        email: field.text().unique({ name: 'user_email_key' }),
        role: field.namedType(Role),
        embedding: field.namedType(types.Embedding1536).optional(),
        createdAt: field.temporal.createdAt(),
      },
      relations: { posts: rel.hasMany(() => Post, { by: 'authorId' }) },
    }).sql({ table: 'user' });
    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id({ name: 'post_pkey' }),
        authorId: field.column(int4Column),
        title: field.text(),
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

function buildSqliteTimestampTsContract() {
  return defineContract(
    {
      family: bareSqlFamilyPack,
      target: sqliteTimestampTargetPack,
      createNamespace: createTestSqlNamespace,
    },
    ({ field, model }) => ({
      models: {
        User: model('User', {
          fields: {
            id: field.int().id(),
            email: field.text(),
            createdAt: field.temporal.createdAt(),
            updatedAt: field.temporal.updatedAt(),
          },
        }).sql({ table: 'user' }),
      },
    }),
  );
}

function buildPostgresTimestampTsContract() {
  return defineContract(
    {
      family: bareSqlFamilyPack,
      target: postgresTimestampTargetPack,
      createNamespace: createTestSqlNamespace,
    },
    ({ field, model }) => ({
      models: {
        User: model('User', {
          fields: {
            id: field.int().id(),
            email: field.text(),
            createdAt: field.temporal.createdAt(),
            updatedAt: field.temporal.updatedAt(),
          },
        }).sql({ table: 'user' }),
      },
    }),
  );
}

describe('TS and PSL authoring parity', () => {
  it('keeps the contract DSL within the terseness threshold for the same contract', () => {
    const pslLines = countSemanticLines(representativePslSchema);
    const tsLines = countSemanticLines(representativeTsAuthoring);

    expect(tsLines).toBeLessThanOrEqual(Math.ceil(pslLines * 1.6));
  });

  // The shared timestamp parity schema both SQL targets exercise. Lives at module scope so the per-target tests below read as data + a single call into `expectTimestampParity`.
  const timestampParityPslSchema = `model User {
  id Int @id
  email String
  createdAt DateTime @default(now())
  updatedAt temporal.updatedAt()
}`;

  function expectTimestampParity(target: {
    readonly buildTsContract: () => unknown;
    readonly targetPack: TargetPackRef<'sql', string>;
    readonly scalarColumnDescriptors: ReadonlyMap<string, ColumnTypeDescriptor>;
    readonly authoringContributions: AuthoringContributions;
  }): void {
    const tsContract = target.buildTsContract();
    const pslDocument = symbolTableInputFromParseArgs({
      schema: timestampParityPslSchema,
      sourceId: 'schema.prisma',
    });

    const interpreted = interpretPslDocumentToSqlContract({
      ...pslDocument,
      target: target.targetPack,
      scalarColumnDescriptors: target.scalarColumnDescriptors,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      authoringContributions: target.authoringContributions,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;
    expect(interpreted.value).toEqual(tsContract);
  }

  it('lowers SQLite timestamp helpers to the same contract as PSL timestamp attributes', () => {
    expectTimestampParity({
      buildTsContract: buildSqliteTimestampTsContract,
      targetPack: sqliteTimestampTargetPack,
      scalarColumnDescriptors: sqliteTimestampScalarTypeDescriptors,
      authoringContributions: sqliteTimestampAuthoringContributions,
    });
  });

  it('lowers Postgres timestamp helpers to the same contract as PSL timestamp attributes', () => {
    expectTimestampParity({
      buildTsContract: buildPostgresTimestampTsContract,
      targetPack: postgresTimestampTargetPack,
      scalarColumnDescriptors: postgresTimestampScalarTypeDescriptors,
      authoringContributions: postgresTimestampAuthoringContributions,
    });
  });

  it('PSL and TS lower the same cross-namespace FK shape to identical contract IR', () => {
    const pslDocument = symbolTableInputFromParseArgs({
      schema: `namespace auth {
  model User {
    id Int @id
    posts Post[]
  }
}

model Post {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const pslContract = interpretPslDocumentToSqlContract({
      ...pslDocument,
      target: portablePostgresTargetPack,
      scalarColumnDescriptors,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      authoringContributions,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });

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
    const pslDocument = symbolTableInputFromParseArgs({
      schema: `model User {
  id    Int    @id
  email String
  @@index(expression: "lower(email)", name: "users_email_eq")
}
`,
      sourceId: 'schema.prisma',
    });
    const pslContract = interpretPslDocumentToSqlContract({
      ...pslDocument,
      target: portablePostgresTargetPack,
      scalarColumnDescriptors,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      authoringContributions,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });
    expect(pslContract.ok).toBe(true);
    if (!pslContract.ok) return;

    const tsContract = defineContract({
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
          indexes: [constraints.index({ expression: 'lower(email)', name: 'users_email_eq' })],
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

    const pslDocument = symbolTableInputFromParseArgs({
      schema: `model User {
  id    Int    @id
  email String
  @@index(expression: "eql_v3.eq_term(email)", where: "(deleted_at IS NULL)", unique: true, name: "users_email_eq", type: "bm25", options: {})
}
`,
      sourceId: 'schema.prisma',
    });
    const pslContract = interpretPslDocumentToSqlContract({
      ...pslDocument,
      target: portablePostgresTargetPack,
      scalarColumnDescriptors,
      composedExtensions: [indexTypesPack.id],
      composedExtensionPackRefs: [indexTypesPack],
      composedExtensionContracts: new Map(),
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      authoringContributions,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });
    expect(pslContract.ok).toBe(true);
    if (!pslContract.ok) return;

    const tsContract = defineContract(
      {
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
                expression: 'eql_v3.eq_term(email)',
                where: '(deleted_at IS NULL)',
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
    const pslDocument = symbolTableInputFromParseArgs({
      schema: `model User {
  id    Int    @id
  email String
  @@index([email], map: "users_email_adopted")
}
`,
      sourceId: 'schema.prisma',
    });
    const pslContract = interpretPslDocumentToSqlContract({
      ...pslDocument,
      target: portablePostgresTargetPack,
      scalarColumnDescriptors,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      authoringContributions,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });
    expect(pslContract.ok).toBe(true);
    if (!pslContract.ok) return;

    const tsContract = defineContract({
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
    const pslDocument = symbolTableInputFromParseArgs({
      schema: `model User {
  id    Int    @id
  email String
  @@index([email], name: "user_email_lookup")
}
`,
      sourceId: 'schema.prisma',
    });
    const pslContract = interpretPslDocumentToSqlContract({
      ...pslDocument,
      target: portablePostgresTargetPack,
      scalarColumnDescriptors,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      authoringContributions,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });
    expect(pslContract.ok).toBe(true);
    if (!pslContract.ok) return;

    const tsContract = defineContract({
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
    const pslDocument = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  email String @map("email")
  @@index([email])
}
`,
      sourceId: 'schema.prisma',
    });

    const pslContract = interpretPslDocumentToSqlContract({
      ...pslDocument,
      target: portablePostgresTargetPack,
      scalarColumnDescriptors,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      authoringContributions,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });

    expect(pslContract.ok).toBe(true);
    if (!pslContract.ok) return;

    const tsContract = defineContract({
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

  // `temporal.updatedAt()` is a convenience spelling of
  // `temporal.timestamptz(onCreate: now, onUpdate: now)`, so all three
  // spellings must lower to byte-identical contracts. The two are separately
  // authored descriptors sharing no code, so only these assertions hold them
  // equal.
  describe('temporal.updatedAt() three-way byte-identity', () => {
    const interpretTemporalPsl = (field: string) => {
      const document = symbolTableInputFromParseArgs({
        schema: `model User {
  id Int @id
  stamped ${field}
}`,
        sourceId: 'schema.prisma',
      });
      const result = interpretPslDocumentToSqlContract({
        ...document,
        target: postgresTimestampTargetPack,
        scalarColumnDescriptors: postgresTimestampScalarTypeDescriptors,
        composedExtensionContracts: new Map(),
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
        authoringContributions: postgresTimestampAuthoringContributions,
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('interpretation failed');
      return result.value;
    };

    const buildTsFullForm = () =>
      defineContract(
        {
          family: bareSqlFamilyPack,
          target: postgresTimestampTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field, model }) => ({
          models: {
            User: model('User', {
              fields: {
                id: field.int().id(),
                stamped: field.temporal.timestamptz(undefined, 'now', 'now'),
              },
            }).sql({ table: 'user' }),
          },
        }),
      );

    const buildTsConvenienceForm = () =>
      defineContract(
        {
          family: bareSqlFamilyPack,
          target: postgresTimestampTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field, model }) => ({
          models: {
            User: model('User', {
              fields: {
                id: field.int().id(),
                stamped: field.temporal.updatedAt(),
              },
            }).sql({ table: 'user' }),
          },
        }),
      );

    it('PSL full form === PSL convenience form', () => {
      expect(interpretTemporalPsl('temporal.timestamptz(onCreate: now, onUpdate: now)')).toEqual(
        interpretTemporalPsl('temporal.updatedAt()'),
      );
    });

    it('TS full form === TS convenience form', () => {
      expect(buildTsFullForm()).toEqual(buildTsConvenienceForm());
    });

    it('PSL full form === TS full form', () => {
      expect(interpretTemporalPsl('temporal.timestamptz(onCreate: now, onUpdate: now)')).toEqual(
        buildTsFullForm(),
      );
    });
  });
});
