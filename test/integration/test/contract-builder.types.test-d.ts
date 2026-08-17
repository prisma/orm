// Intentionally uses verbose sql-contract-ts/contract-builder import: this file verifies
// type-level behavior of the base defineContract API (not the facade wrapper).
import {
  int4Column,
  jsonbColumn,
  textColumn,
  timestamptzColumn,
} from '@internal/adapter-postgres/column-types';
import { arktypeJson } from '@internal/extension-arktype-json/column-types';
import arktypeJsonRuntime from '@internal/extension-arktype-json/runtime';
import pgvectorPack from '@internal/extension-pgvector/pack';
import sqlFamilyPack from '@internal/family-sql/pack';
import type { ResultType } from '@internal/framework-components/runtime';
import { sql } from '@internal/sql-builder/runtime';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
  rel,
} from '@internal/sql-contract-ts/contract-builder';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { createStubAdapter, createTestContext } from '@internal/sql-runtime/test/utils';
import type { JsonValue } from '@internal/target-postgres/codec-types';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { type as arktype } from 'arktype';
import { expectTypeOf, test } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../packages/2-sql/9-family/test/test-sql-contract-serializer';
import type { Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };

// The models map for the contract's sole domain namespace, read per-namespace
// from `domain.namespaces[ns].models` (the flat top-level models map is gone).
type SoleNamespaceModels<
  T extends { domain: { namespaces: Record<string, { models: unknown }> } },
> = T['domain']['namespaces'][keyof T['domain']['namespaces']]['models'];

const typecheckOnly = process.env['PN_TYPECHECK_ONLY'] === 'true';

test('builder contract types match fixture contract types', () => {
  const builderContract = defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    createNamespace: postgresCreateNamespace,
    storageHash: 'test-core',
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
          createdAt: field.column(timestamptzColumn),
        },
      }).sql({ table: 'user' }),
    },
  });

  const _validatedBuilderContract = new SqlContractSerializer().deserializeContract(
    builderContract,
  ) as typeof builderContract;
  const _fixtureContract = new SqlContractSerializer().deserializeContract(
    contractJson,
  ) as Contract;

  type BuilderUserTable = NonNullable<
    (typeof _validatedBuilderContract.storage.namespaces)['public']['entries']['table']['user']
  >;
  type FixtureUserTable = NonNullable<
    (typeof _fixtureContract.storage.namespaces)['public']['entries']['table']['user']
  >;

  expectTypeOf<BuilderUserTable>().toHaveProperty('columns');
  expectTypeOf<FixtureUserTable>().toHaveProperty('columns');
});

test('ResultType inference works identically to fixture contract', () => {
  const builderContract = defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    createNamespace: postgresCreateNamespace,
    storageHash: 'test-core',
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
          createdAt: field.column(timestamptzColumn),
        },
      }).sql({ table: 'user' }),
    },
  });

  const validatedBuilderContract = new SqlContractSerializer().deserializeContract(
    builderContract,
  ) as typeof builderContract;
  const adapter = createStubAdapter();
  const context = createTestContext(validatedBuilderContract, adapter);

  const db = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text' } });
  const _plan = db.public.user.select('id', 'email', 'createdAt').build();

  type BuilderRow = ResultType<typeof _plan>;

  const _fixtureContract = new SqlContractSerializer().deserializeContract(
    contractJson,
  ) as Contract;
  const fixtureContext = createTestContext(_fixtureContract, adapter);
  const fixtureDb = sql({
    context: fixtureContext,
    rawCodecInferer: { inferCodec: () => 'pg/text' },
  });
  const _fixturePlan = fixtureDb.public['user']!.select('id', 'email', 'createdAt').build();

  type FixtureRow = ResultType<typeof _fixturePlan>;

  expectTypeOf<BuilderRow>().toEqualTypeOf<FixtureRow>();
  expectTypeOf(_plan).toExtend<SqlQueryPlan<FixtureRow>>();
});

test('refined object contract preserves downstream model token inference', () => {
  const UserBase = model('User', {
    fields: {
      id: field.column(int4Column).id(),
      email: field.column(textColumn),
      createdAt: field.column(timestamptzColumn),
    },
  });

  const Post = model('Post', {
    fields: {
      id: field.column(int4Column).id(),
      userId: field.column(int4Column),
      title: field.column(textColumn),
    },
    relations: {
      user: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }),
    },
  }).sql(({ cols, constraints }) => ({
    table: 'post',
    foreignKeys: [constraints.foreignKey(cols.userId, UserBase.refs.id)],
  }));

  const User = UserBase.relations({
    posts: rel.hasMany(() => Post, { by: 'userId' }),
  }).sql({
    table: 'user',
  });

  const contract = defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    createNamespace: postgresCreateNamespace,
    storageHash: 'test-refined',
    models: {
      User,
      Post,
    },
  });

  const validated = new SqlContractSerializer().deserializeContract(contract) as typeof contract;
  type RefinedUserColumns = NonNullable<
    NonNullable<
      (typeof validated.storage.namespaces)['public']['entries']['table']['user']
    >['columns']
  >;

  expectTypeOf<(typeof validated.storage.namespaces)['public']['entries']['table']>().toExtend<
    Record<string, unknown>
  >();
  expectTypeOf<RefinedUserColumns>().toExtend<Record<string, { readonly codecId: string }>>();
  type ValidatedModels = SoleNamespaceModels<typeof validated>;
  expectTypeOf<ValidatedModels['User']['storage']['table']>().toExtend<string>();
  expectTypeOf<
    NonNullable<ValidatedModels['Post']['storage']['fields']['userId']>['column']
  >().toExtend<string>();
  expectTypeOf(User.refs.id.fieldName).toEqualTypeOf<'id'>();
  expectTypeOf(User.refs.id.modelName).toEqualTypeOf<'User'>();
  expectTypeOf(User.ref('email').fieldName).toEqualTypeOf<'email'>();
  expectTypeOf(User.ref('email').modelName).toEqualTypeOf<'User'>();

  rel.belongsTo(User, { from: 'userId', to: 'id' });
  rel.hasMany(Post, { by: 'userId' });

  // @ts-expect-error relation fields must not appear in model token refs
  User.refs.posts;

  // @ts-expect-error unknown field names must not compile for model token refs
  User.ref('posts');

  // @ts-expect-error relation targets must expose real scalar fields
  rel.belongsTo(User, { from: 'userId', to: 'posts' });

  // @ts-expect-error relation targets must expose real scalar fields
  rel.hasMany(Post, { by: 'posts' });
});

test('integrated callback authoring exposes composition-shaped type helpers', () => {
  const contract = defineContract(
    {
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      extensions: {
        pgvector: pgvectorPack,
      },
    },
    ({ type, field, model }) => {
      const Embedding = type.pgvector.Vector(1536);

      expectTypeOf(Embedding.codecId).toEqualTypeOf<'pg/vector@1'>();
      expectTypeOf(Embedding.typeParams.length).toEqualTypeOf<1536>();

      return {
        types: {
          Embedding,
        },
        models: {
          User: model('User', {
            fields: {
              id: field.int().defaultSql('autoincrement()').id(),
              email: field.text().unique(),
              age: field.int(),
              isActive: field.boolean().default(true),
              score: field.float().optional(),
              profile: field.json().optional(),
              embedding: field.namedType(Embedding).optional(),
              createdAt: field.temporal.createdAt(),
            },
          }).sql({
            table: 'user',
          }),
        },
      };
    },
  );

  type CallbackStorageTypes = NonNullable<typeof contract.storage.types>;

  expectTypeOf<CallbackStorageTypes['Embedding']['codecId']>().toEqualTypeOf<'pg/vector@1'>();
  expectTypeOf(
    contract.storage.namespaces['public'].entries.table.user.columns.id.codecId,
  ).toEqualTypeOf<'pg/int4@1'>();
  expectTypeOf(
    contract.storage.namespaces['public'].entries.table.user.columns.email.codecId,
  ).toEqualTypeOf<'pg/text@1'>();
  expectTypeOf(
    contract.storage.namespaces['public'].entries.table.user.columns.age.codecId,
  ).toEqualTypeOf<'pg/int4@1'>();
  expectTypeOf(
    contract.storage.namespaces['public'].entries.table.user.columns.isActive.codecId,
  ).toEqualTypeOf<'pg/bool@1'>();
  expectTypeOf(
    contract.storage.namespaces['public'].entries.table.user.columns.score.codecId,
  ).toEqualTypeOf<'pg/float8@1'>();
  expectTypeOf(
    contract.storage.namespaces['public'].entries.table.user.columns.profile.codecId,
  ).toEqualTypeOf<'pg/jsonb@1'>();
  expectTypeOf(
    contract.storage.namespaces['public'].entries.table.user.columns.createdAt.codecId,
  ).toEqualTypeOf<'pg/timestamptz-temporal@1'>();
  // `role.typeRef` and `embedding.typeRef` capture is gated on the
  // descriptor-level generic forwarding noted above; the contract
  // still carries the correct typeRef strings at runtime.
  expectTypeOf(
    contract.storage.namespaces['public'].entries.table.user.columns.embedding.typeRef,
  ).toEqualTypeOf<'Embedding'>();
});

test('integrated callback authoring hides extension namespaces when packs are absent', () => {
  defineContract(
    {
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
    },
    ({ type }) => {
      if (typecheckOnly) {
        // @ts-expect-error extension-owned helper requires the corresponding pack
        type.pgvector.Vector(1536);
      }

      return {
        models: {},
      };
    },
  );
});

test('local field and belongsTo sql overlays stay typed', () => {
  defineContract(
    {
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
    },
    ({ field }) => {
      const User = model('User', {
        fields: {
          id: field.id.uuidv4String().sql({ id: { name: 'user_pkey' } }),
          email: field
            .text()
            .unique()
            .sql({ unique: { name: 'user_email_key' } }),
        },
      });

      const Post = model('Post', {
        fields: {
          id: field.id.uuidv4String(),
          authorId: field.uuidString().sql({ column: 'author_id' }),
        },
        relations: {
          author: rel
            .belongsTo(User, { from: 'authorId', to: 'id' })
            .sql({ fk: { name: 'post_author_id_fkey', onDelete: 'cascade' } }),
        },
      });

      expectTypeOf(User.buildAttributesSpec()).toEqualTypeOf<undefined>();
      expectTypeOf(Post.buildSqlSpec()).toExtend<
        | {
            readonly table?: string;
            readonly indexes?: readonly unknown[];
            readonly foreignKeys?: readonly unknown[];
          }
        | undefined
      >();

      if (typecheckOnly) {
        // @ts-expect-error relation-local sql is only supported on belongsTo relations
        rel.hasMany(Post, { by: 'authorId' }).sql({ fk: { name: 'post_author_id_fkey' } });
      }

      return { models: {} };
    },
  );
});

test('explicit generated id helpers stay typed', () => {
  defineContract(
    {
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
    },
    ({ field }) => {
      const ShortLink = model('ShortLink', {
        fields: {
          id: field.id.nanoid({ size: 16 }, { name: 'short_link_pkey' }),
          ownerId: field.uuidString(),
          publicId: field.nanoid({ size: 16 }),
        },
      }).sql({
        table: 'short_link',
      });

      expectTypeOf(ShortLink.buildSqlSpec()).toExtend<
        | {
            readonly table?: string;
            readonly indexes?: readonly unknown[];
            readonly foreignKeys?: readonly unknown[];
          }
        | undefined
      >();

      if (typecheckOnly) {
        // @ts-expect-error uuidv7String helper accepts only an optional trailing PK-name object
        field.id.uuidv7String({ size: 16 });

        // @ts-expect-error nanoid size must be a number
        field.id.nanoid({ size: '16' });

        // @ts-expect-error scalar nanoid size must be a number
        field.nanoid({ size: '16' });
      }

      return { models: {} };
    },
  );
});

test('codec type inference via type option', () => {
  const contract = defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    createNamespace: postgresCreateNamespace,
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
          createdAt: field.column(timestamptzColumn),
        },
      }).sql({ table: 'user' }),
    },
  });

  const validated = new SqlContractSerializer().deserializeContract(contract) as typeof contract;
  const context = createTestContext(validated, createStubAdapter());

  const db = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text' } });
  const _plan = db.public.user.select('id', 'email', 'createdAt').build();

  type Row = ResultType<typeof _plan>;

  expectTypeOf<Row>().toHaveProperty('id');
  expectTypeOf<Row>().toHaveProperty('email');
  expectTypeOf<Row>().toHaveProperty('createdAt');

  const _testRow: Row = {
    id: 1,
    email: 'test@example.com',
    createdAt: new Date('2024-01-01T00:00:00Z'),
  } as Row;

  expectTypeOf(_testRow).toEqualTypeOf<Row>();
});

test('contract structure type matches Contract', () => {
  const contract = defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    createNamespace: postgresCreateNamespace,
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column),
          email: field.column(textColumn),
        },
      }).sql({ table: 'user' }),
    },
  });

  expectTypeOf(contract).toHaveProperty('target');
  expectTypeOf(contract).toHaveProperty('targetFamily');
  expectTypeOf(contract).toHaveProperty('domain');
  expectTypeOf(contract).toHaveProperty('storage');
});

test('arktypeJson and jsonbColumn currently resolve to never in no-emit type path (known gap)', () => {
  // Phase C: schema-typed JSON ships from per-library extension packages
  // now (`@internal/extension-arktype-json` for arktype). The
  // adapter's `jsonbColumn` is the untyped fallback.
  const payloadSchema = arktype({
    action: 'string',
    actorId: 'number',
  });

  const contract = defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    createNamespace: postgresCreateNamespace,
    models: {
      Event: model('Event', {
        fields: {
          id: field.column(int4Column).id(),
          payload: field.column(arktypeJson(payloadSchema)),
          meta: field.column(jsonbColumn),
        },
      }).sql({ table: 'event' }),
    },
  });

  const validated = new SqlContractSerializer().deserializeContract(contract) as typeof contract;
  // The arktype runtime pack contributes the `arktype/json@1` codec
  // descriptor; without it the AST-bound integrity check refuses to build a
  // context for the `payload` column.
  const context = createTestContext(validated, createStubAdapter(), {
    extensions: [arktypeJsonRuntime],
  });

  const db = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text' } });
  const _plan = db.public.event.select('payload', 'meta').build();

  type Row = ResultType<typeof _plan>;

  // The DSL derives codec types from the pack's phantom __codecTypes
  // field. Because the pack declares __codecTypes as optional, the type
  // resolver cannot narrow the codec output for jsonb columns in the
  // no-emit path, so ResultType falls back to never. The chain builder's
  // explicit <CodecTypes> parameter resolved this to unknown. Tracked as
  // a known DSL type-inference gap to fix when __codecTypes becomes
  // required on packs.
  expectTypeOf<Row['payload']>().toEqualTypeOf(undefined as never);
  expectTypeOf<Row['meta']>().toEqualTypeOf(undefined as never);
});

type ResolveStandardSchemaOutput<P> = P extends { readonly schema: infer Schema }
  ? Schema extends { readonly infer: infer Output }
    ? Output
    : Schema extends {
          readonly '~standard': { readonly types?: { readonly output?: infer Output } };
        }
      ? Output extends undefined
        ? JsonValue
        : Output
      : JsonValue
  : JsonValue;

test('ResolveStandardSchemaOutput resolves Arktype schema via .infer', () => {
  const profileSchema = arktype({ displayName: 'string', active: 'boolean' });
  type Resolved = ResolveStandardSchemaOutput<{ readonly schema: typeof profileSchema }>;

  expectTypeOf<Resolved>().toEqualTypeOf<{ displayName: string; active: boolean }>();
});

test('ResolveStandardSchemaOutput resolves Standard Schema via ~standard.types.output', () => {
  type BareStandardSchema = {
    readonly '~standard': {
      readonly types: {
        readonly output: { rank: number; verified: boolean };
      };
    };
  };

  type Resolved = ResolveStandardSchemaOutput<{ readonly schema: BareStandardSchema }>;

  expectTypeOf<Resolved>().toEqualTypeOf<{ rank: number; verified: boolean }>();
});

test('ResolveStandardSchemaOutput falls back to JsonValue without schema', () => {
  type Resolved = ResolveStandardSchemaOutput<Record<never, never>>;

  expectTypeOf<Resolved>().toEqualTypeOf<JsonValue>();
});

// ---------------------------------------------------------------------------
// Enum value-union narrowing — the behavior spec for read output / write input.
// Exercised through the real codec types + the full select().build() lane so a
// widening to string (or a spurious | null on a non-null enum) is caught here.
// ---------------------------------------------------------------------------

const Role = enumType('Role', textColumn, member('User', 'user'), member('Admin', 'admin'));
const Status = enumType(
  'Status',
  textColumn,
  member('Active', 'active'),
  member('Inactive', 'inactive'),
);
const PriorityInt = enumType('PriorityInt', int4Column, member('Low', 1), member('High', 10));

const enumContract = defineContract({
  family: sqlFamilyPack,
  target: postgresPack,
  createNamespace: postgresCreateNamespace,
  storageHash: 'test-enum',
  enums: { Role, Status, PriorityInt },
  models: {
    Account: model('Account', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        createdAt: field.column(timestamptzColumn),
        role: field.namedType(Role),
        status: field.namedType(Status).optional(),
        priority: field.namedType(PriorityInt),
      },
    }).sql({ table: 'account' }),
  },
});

const enumValidated = new SqlContractSerializer().deserializeContract(
  enumContract,
) as typeof enumContract;
const enumDb = sql({
  context: createTestContext(enumValidated, createStubAdapter()),
  rawCodecInferer: { inferCodec: () => 'pg/text' },
});

test('read: non-null text enum is exactly the value union (no | null)', () => {
  const plan = enumDb.public.account.select('role').build();
  type Row = ResultType<typeof plan>;
  expectTypeOf<Row['role']>().toEqualTypeOf<'user' | 'admin'>();
  expectTypeOf<Row['role']>().not.toEqualTypeOf<string>();
});

test('read: nullable text enum is value union | null', () => {
  const plan = enumDb.public.account.select('status').build();
  type Row = ResultType<typeof plan>;
  expectTypeOf<Row['status']>().toEqualTypeOf<'active' | 'inactive' | null>();
});

test('read: non-null int-backed enum narrows to its int value union (not number)', () => {
  const plan = enumDb.public.account.select('priority').build();
  type Row = ResultType<typeof plan>;
  expectTypeOf<Row['priority']>().toEqualTypeOf<1 | 10>();
  expectTypeOf<Row['priority']>().not.toEqualTypeOf<number>();
});

test('read: non-enum fields keep their codec output, unchanged from main', () => {
  const plan = enumDb.public.account.select('id', 'email', 'createdAt').build();
  type Row = ResultType<typeof plan>;
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();
  expectTypeOf<Row['createdAt']>().toEqualTypeOf<Date>();
});

test('write: enum insert accepts the value union and rejects out-of-union literals', () => {
  enumDb.public.account.insert([{ id: 1, email: 'a@b.c', role: 'user', priority: 1 }]);
  enumDb.public.account.insert([
    { id: 2, email: 'a@b.c', role: 'admin', status: 'active', priority: 10 },
  ]);
  enumDb.public.account.insert([
    { id: 3, email: 'a@b.c', role: 'user', status: null, priority: 10 },
  ]);

  enumDb.public.account.insert([
    // @ts-expect-error 'nope' is not a Role member value.
    { id: 4, email: 'a@b.c', role: 'nope', priority: 1 },
  ]);
  enumDb.public.account.insert([
    // @ts-expect-error 99 is not a PriorityInt member value.
    { id: 5, email: 'a@b.c', role: 'user', priority: 99 },
  ]);
});
