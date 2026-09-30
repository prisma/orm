import type { ContractEnumAccessor } from '@internal/contract/enum-accessor';
import type { ProfileHashBase, StorageHashBase } from '@internal/contract/types';
import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { MongoContractWithTypeMaps, MongoTypeMaps } from '@internal/mongo-contract';
import type {
  CreateInput,
  IncludedRow,
  MongoCollection,
  MongoQueryPlan,
  MongoRawClient,
  NoIncludes,
} from '@internal/mongo-orm';
import type { MongoExecutionContext } from '@internal/mongo-runtime';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../../../2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract';
import { defineContract, enumType, field, member, model } from '../src/exports/contract-builder';
import type { MongoClient } from '../src/runtime/mongo';
import type { MongoStaticContext } from '../src/static/mongo-static';

type UserRow = IncludedRow<Contract, 'User', NoIncludes>;

// Pin the type chain that `init`'s scaffold relies on. The headline trap was
// `db.orm.X.where(...)` resolving to `never` against an emitted `Contract`
// (lowercased plural roots). These tests fail loudly if a future emitter or
// type-system change reintroduces that regression.

type Db = MongoClient<Contract>;

declare const db: Db;

test('orm exposes lowercased plural roots from the emitted contract', () => {
  expectTypeOf<Db['orm']>().toHaveProperty('users');
  expectTypeOf<Db['orm']>().toHaveProperty('tasks');
});

test('db.orm.users.where(...) returns a chainable collection (not never)', () => {
  const chain = db.orm.users.where({ email: 'a@x' });
  expectTypeOf(chain).not.toBeNever();
  expectTypeOf(chain.where({ name: 'A' })).not.toBeNever();
});

test('db.orm.users.where(...).first() resolves to Promise<row | null>', () => {
  const promised = db.orm.users.where({ email: 'a@x' }).first();
  expectTypeOf(promised).not.toBeNever();
  expectTypeOf(promised).resolves.toEqualTypeOf<UserRow | null>();
});

test('db.orm.users.all() yields rows via AsyncIterableResult', () => {
  const all = db.orm.users.all();
  expectTypeOf(all).not.toBeNever();
  expectTypeOf(all).toEqualTypeOf<AsyncIterableResult<UserRow>>();
});

test('db.orm.tasks.variant("Bug").where(...) narrows to the variant', () => {
  const bugChain = db.orm.tasks.variant('Bug').where({ title: 'X' });
  expectTypeOf(bugChain).not.toBeNever();
});

test('db.orm key set matches the emitted roots (lowercased plurals only)', () => {
  type OrmKeys = keyof Db['orm'];
  expectTypeOf<OrmKeys>().toEqualTypeOf<'tasks' | 'users'>();
});

test('db.raw is MongoRawClient<Contract>', () => {
  expectTypeOf<Db['raw']>().toEqualTypeOf<MongoRawClient<Contract>>();
});

type RoleEnum = {
  readonly codecId: 'mongo/string@1';
  readonly members: readonly [
    { readonly name: 'User'; readonly value: 'user' },
    { readonly name: 'Admin'; readonly value: 'admin' },
  ];
};

type EnumContract = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'enum-facade-test'>;
    readonly capabilities: Record<string, never>;
    readonly extensions: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: Record<string, never>;
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly enum: { readonly Role: RoleEnum };
          readonly models: Record<string, never>;
          readonly valueObjects: Record<string, never>;
        };
      };
    };
    readonly storage: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly id: '__unbound__';
          readonly kind: 'mongo-namespace';
          readonly entries: { readonly collection: Record<string, never> };
        };
      };
      readonly storageHash: StorageHashBase<'enum-facade-storage'>;
    };
  },
  MongoTypeMaps<
    { readonly 'mongo/string@1': { readonly input: string; readonly output: string } },
    Record<string, Record<string, unknown>>,
    Record<string, Record<string, unknown>>
  >
>;

declare const enumDb: MongoClient<EnumContract>;

test('db.enums.Role is a ContractEnumAccessor (unbound projection, no __unbound__ key needed)', () => {
  expectTypeOf<(typeof enumDb)['enums']['Role']>().toMatchTypeOf<ContractEnumAccessor<RoleEnum>>();
});

test('db.enums.Role.values carries the literal member values', () => {
  type Values = (typeof enumDb)['enums']['Role']['values'];
  expectTypeOf<Values[0]>().toEqualTypeOf<'user'>();
  expectTypeOf<Values[1]>().toEqualTypeOf<'admin'>();
  expectTypeOf<Values[number]>().toEqualTypeOf<'user' | 'admin'>();
});

test('db.enums.Role.members.User is the literal "user"', () => {
  expectTypeOf<(typeof enumDb)['enums']['Role']['members']['User']>().toEqualTypeOf<'user'>();
});

const Role = enumType(
  'Role',
  { codecId: 'mongo/string@1', nativeType: 'string' },
  member('User', 'user'),
  member('Admin', 'admin'),
);

const dslContract = defineContract({
  enums: { Role },
  models: {
    Account: model('Account', { collection: 'accounts', fields: { _id: field.objectId() } }),
  },
});

declare const dslDb: MongoClient<typeof dslContract>;

test('TS DSL defineContract: db.enums.Role.values resolves to the literal tuple', () => {
  type Values = (typeof dslDb)['enums']['Role']['values'];
  expectTypeOf<Values>().toEqualTypeOf<readonly ['user', 'admin']>();
});

test('TS DSL defineContract: db.enums.Role.members.User resolves to "user" literal', () => {
  expectTypeOf<(typeof dslDb)['enums']['Role']['members']['User']>().toEqualTypeOf<'user'>();
});

test('TS DSL defineContract: namespace enum slot is typed without a cast', () => {
  // MongoDomainNamespaceFromDefinition now includes enum?, so reading the
  // entries from a built contract doesn't need a RuntimeNs cast.
  type Ns = (typeof dslContract)['domain']['namespaces']['__unbound__'];
  type RoleEntry = NonNullable<Ns['enum']>['Role'];
  type MemberValue = RoleEntry['members'][number]['value'];
  expectTypeOf<MemberValue>().toEqualTypeOf<'user' | 'admin'>();
});

const R5Role = enumType(
  'R5Role',
  { codecId: 'mongo/string@1', nativeType: 'string' },
  member('User', 'user'),
  member('Admin', 'admin'),
);

const r5Contract = defineContract({
  enums: { R5Role },
  models: {
    Account: model('Account', {
      collection: 'accounts',
      fields: {
        _id: field.objectId(),
        role: field.namedType(R5Role),
        mood: field.namedType(R5Role).optional(),
        tags: field.namedType(R5Role).many(),
        moodTags: field.namedType(R5Role).optional().many(),
      },
    }),
  },
});

type R5CreateInput = CreateInput<typeof r5Contract, 'Account'>;

test('R5: scalar enum input narrows to the value union', () => {
  expectTypeOf<R5CreateInput['role']>().toEqualTypeOf<'user' | 'admin'>();
});

test('R5: nullable enum input accepts the value union or null, or may be left out', () => {
  expectTypeOf<R5CreateInput['mood']>().toEqualTypeOf<'user' | 'admin' | null | undefined>();
});

test('R5: many enum input accepts an array of the value union', () => {
  expectTypeOf<R5CreateInput['tags']>().toEqualTypeOf<('user' | 'admin')[]>();
});

test('R5: nullable+many enum input resolves to Base[] | null (precedence)', () => {
  expectTypeOf<R5CreateInput['moodTags']>().toEqualTypeOf<
    ('user' | 'admin')[] | null | undefined
  >();
  expectTypeOf<R5CreateInput['moodTags']>().not.toEqualTypeOf<('user' | 'admin' | null)[]>();
});

test('R5: invalid enum literal is rejected by the create() input field type', () => {
  // Non-vacuous: targets the `role` field type specifically. 'nope' must not be
  // assignable to the value union; a valid member must be. If the narrowing
  // regresses to `string`/codec output, the first assertion starts passing
  // (wrongly extends) and this test fails.
  expectTypeOf<'nope'>().not.toExtend<R5CreateInput['role']>();
  expectTypeOf<'user'>().toExtend<R5CreateInput['role']>();
});

test('R5: create() accepts an in-union literal, rejects an out-of-union literal', () => {
  const col = {} as MongoCollection<typeof r5Contract, 'Account'>;
  col.create({ role: 'user', mood: null, tags: [], moodTags: null });
  col.create({
    // @ts-expect-error 'nope' is not in the R5Role value union ('user' | 'admin')
    role: 'nope',
    mood: null,
    tags: [],
    moodTags: null,
  });
});

// db.context type tests

declare const contextDb: MongoClient<Contract>;
declare const staticCtx: MongoStaticContext<Contract>;

test('MongoClient exposes context typed as MongoExecutionContext<TContract>', () => {
  expectTypeOf<(typeof contextDb)['context']>().toMatchTypeOf<MongoExecutionContext<Contract>>();
});

test('db.context.contract is typed as TContract (not unknown)', () => {
  expectTypeOf<(typeof contextDb)['context']['contract']>().toEqualTypeOf<Contract>();
});

// MongoStaticContext type tests

test('MongoStaticContext carries the right members', () => {
  expectTypeOf<(typeof staticCtx)['context']>().toMatchTypeOf<MongoExecutionContext<Contract>>();
  expectTypeOf<(typeof staticCtx)['contract']>().toEqualTypeOf<Contract>();
});

test('MongoStaticContext.context.contract is TContract (not unknown)', () => {
  expectTypeOf<(typeof staticCtx)['context']['contract']>().toEqualTypeOf<Contract>();
});

type QueryRow = { id: string };
declare const queryPlan: MongoQueryPlan<QueryRow>;

test('MongoClient has no row execute facade', () => {
  expectTypeOf<MongoClient<Contract>>().not.toHaveProperty('execute');
});

test('db.runtime().query(plan) is typed AsyncIterableResult<Row>', async () => {
  const runtime = await enumDb.runtime();
  const result = runtime.query(queryPlan);
  expectTypeOf(result).toEqualTypeOf<AsyncIterableResult<QueryRow>>();
});
