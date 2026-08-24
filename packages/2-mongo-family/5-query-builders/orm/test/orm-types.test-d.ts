import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import type {
  CodecTypes,
  Contract,
} from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import type { MongoCollection } from '../src/collection';
import type {
  DotPath,
  FieldAccessor,
  FieldExpression,
  FieldOperation,
  ResolveDotPathType,
} from '../src/field-accessor';
import type { MongoOrmClient } from '../src/mongo-orm';
import type {
  CreateInput,
  EmbedRelationKeys,
  IncludedRow,
  InferFullRow,
  InferRootRow,
  MongoIncludeSpec,
  MongoWhereFilter,
  ReferenceRelationKeys,
  ResolvedCreateInput,
  VariantCreateInput,
  VariantModelRow,
  VariantNames,
} from '../src/types';

// --- Root accessors ---

test('ORM client has root accessors matching roots section', () => {
  type Client = MongoOrmClient<Contract>;
  expectTypeOf<Client>().toHaveProperty('tasks');
  expectTypeOf<Client>().toHaveProperty('users');
});

test('root accessors are MongoCollection instances', () => {
  type Client = MongoOrmClient<Contract>;
  expectTypeOf<Client['tasks']>().toExtend<MongoCollection<Contract, 'Task'>>();
  expectTypeOf<Client['users']>().toExtend<MongoCollection<Contract, 'User'>>();
});

// --- Default row includes embedded fields ---

test('InferFullRow for User includes embedded addresses', () => {
  type UserRow = InferFullRow<Contract, 'User'>;
  expectTypeOf<UserRow>().toHaveProperty('_id');
  expectTypeOf<UserRow>().toHaveProperty('name');
  expectTypeOf<UserRow>().toHaveProperty('email');
  expectTypeOf<UserRow>().toHaveProperty('addresses');
});

test('embedded 1:N relation is an array of the embedded model row', () => {
  type UserRow = InferFullRow<Contract, 'User'>;
  type AddressRow = { street: string; city: string; zip: string };
  expectTypeOf<UserRow['addresses']>().toExtend<AddressRow[]>();
});

test('InferFullRow for Task includes embedded comments', () => {
  type TaskRow = InferFullRow<Contract, 'Task'>;
  expectTypeOf<TaskRow>().toHaveProperty('comments');
});

test('InferFullRow for models without embeds matches field row', () => {
  type AddressRow = InferFullRow<Contract, 'Address'>;
  expectTypeOf<AddressRow>().toHaveProperty('street');
  expectTypeOf<AddressRow>().toHaveProperty('city');
  expectTypeOf<AddressRow>().toHaveProperty('zip');
});

// --- Where filter keys constrained to model fields ---

test('where filter keys are constrained to model field names', () => {
  type UserFilter = MongoWhereFilter<Contract, 'User', CodecTypes>;
  expectTypeOf<UserFilter>().toHaveProperty('_id');
  expectTypeOf<UserFilter>().toHaveProperty('name');
  expectTypeOf<UserFilter>().toHaveProperty('email');
});

test('where filter rejects invalid field names', () => {
  type UserFilter = MongoWhereFilter<Contract, 'User', CodecTypes>;
  // @ts-expect-error 'nonexistent' is not a field on User
  void ({ nonexistent: 'value' } satisfies UserFilter);
});

test('where filter enforces value types from codec', () => {
  type UserFilter = MongoWhereFilter<Contract, 'User', CodecTypes>;
  void ({ name: 'Alice' } satisfies UserFilter);
});

test('object-based where() accepts MongoWhereFilter', () => {
  const col = {} as MongoCollection<Contract, 'User'>;
  const filtered = col.where({ name: 'Alice' });
  expectTypeOf(filtered).toExtend<MongoCollection<Contract, 'User'>>();
});

// --- Include constrained to reference relations only ---

test('ReferenceRelationKeys picks only reference relations', () => {
  type TaskRefKeys = ReferenceRelationKeys<Contract, 'Task'>;
  expectTypeOf<TaskRefKeys>().toEqualTypeOf<'assignee'>();
});

test('EmbedRelationKeys picks only embed relations', () => {
  type TaskEmbedKeys = EmbedRelationKeys<Contract, 'Task'>;
  expectTypeOf<TaskEmbedKeys>().toEqualTypeOf<'comments'>();
});

test('MongoIncludeSpec only allows reference relation keys', () => {
  type TaskInclude = MongoIncludeSpec<Contract, 'Task'>;
  expectTypeOf<TaskInclude>().toHaveProperty('assignee');
  expectTypeOf<TaskInclude>().not.toHaveProperty('comments');
});

test('ReferenceRelationKeys picks reference relations on User', () => {
  type UserRefKeys = ReferenceRelationKeys<Contract, 'User'>;
  expectTypeOf<UserRefKeys>().toEqualTypeOf<'tasks'>();
});

// --- Polymorphic root returns discriminated union ---

test('InferRootRow for polymorphic model returns union with literal discriminator values', () => {
  type TaskRow = InferRootRow<Contract, 'Task'>;

  type BugRowPart = { severity: string };
  type FeatureRowPart = { priority: string; targetRelease: string };

  expectTypeOf<TaskRow>().toExtend<
    | ({ _id: string; title: string; type: 'bug'; assigneeId: string } & BugRowPart)
    | ({ _id: string; title: string; type: 'feature'; assigneeId: string } & FeatureRowPart)
  >();
});

test('TaskRow type field carries literal discriminator values', () => {
  type TaskRow = InferRootRow<Contract, 'Task'>;
  expectTypeOf<TaskRow['type']>().toEqualTypeOf<'bug' | 'feature'>();
});

test('discriminator narrows to Bug fields exclusively', () => {
  type TaskRow = InferRootRow<Contract, 'Task'>;
  const r = {} as TaskRow;
  if (r.type === 'bug') {
    expectTypeOf(r.severity).toMatchTypeOf<string>();
    // @ts-expect-error priority only exists on Feature variant
    r.priority;
    // @ts-expect-error targetRelease only exists on Feature variant
    r.targetRelease;
  }
});

test('discriminator narrows to Feature fields exclusively', () => {
  type TaskRow = InferRootRow<Contract, 'Task'>;
  const r = {} as TaskRow;
  if (r.type === 'feature') {
    expectTypeOf(r.priority).toMatchTypeOf<string>();
    expectTypeOf(r.targetRelease).toMatchTypeOf<string>();
    // @ts-expect-error severity only exists on Bug variant
    r.severity;
  }
});

test('InferRootRow for non-polymorphic model returns plain row', () => {
  type UserRow = InferRootRow<Contract, 'User'>;
  expectTypeOf<UserRow>().toHaveProperty('_id');
  expectTypeOf<UserRow>().toHaveProperty('name');
  expectTypeOf<UserRow>().toHaveProperty('email');
  expectTypeOf<UserRow>().toHaveProperty('addresses');
});

// --- VariantNames / VariantModelRow ---

test('VariantNames extracts variant names from polymorphic model', () => {
  type Names = VariantNames<Contract, 'Task'>;
  expectTypeOf<Names>().toEqualTypeOf<'Bug' | 'Feature'>();
});

test('VariantNames is never for non-polymorphic model', () => {
  type Names = VariantNames<Contract, 'User'>;
  expectTypeOf<Names>().toBeNever();
});

test('VariantModelRow narrows to Bug-specific fields', () => {
  type BugRow = VariantModelRow<Contract, 'Task', 'Bug'>;
  expectTypeOf<BugRow>().toHaveProperty('severity');
  expectTypeOf<BugRow>().toHaveProperty('_id');
  expectTypeOf<BugRow>().toHaveProperty('title');
  expectTypeOf<BugRow['type']>().toEqualTypeOf<'bug'>();
});

test('VariantModelRow narrows to Feature-specific fields', () => {
  type FeatureRow = VariantModelRow<Contract, 'Task', 'Feature'>;
  expectTypeOf<FeatureRow>().toHaveProperty('priority');
  expectTypeOf<FeatureRow>().toHaveProperty('targetRelease');
  expectTypeOf<FeatureRow['type']>().toEqualTypeOf<'feature'>();
});

// --- Collection API type constraints ---

test('all() returns AsyncIterableResult of InferRootRow', () => {
  type Col = MongoCollection<Contract, 'User'>;
  type AllResult = ReturnType<Col['all']>;
  expectTypeOf<AllResult>().toExtend<AsyncIterableResult<InferRootRow<Contract, 'User'>>>();
});

test('first() returns Promise of InferRootRow or null', () => {
  type Col = MongoCollection<Contract, 'User'>;
  type FirstResult = ReturnType<Col['first']>;
  expectTypeOf<FirstResult>().toExtend<Promise<InferRootRow<Contract, 'User'> | null>>();
});

test('include() accepts reference relation keys', () => {
  type Col = MongoCollection<Contract, 'Task'>;
  type IncludeParam = Parameters<Col['include']>[0];
  expectTypeOf<'assignee'>().toExtend<IncludeParam>();
});

test('include() rejects embed relation keys', () => {
  type Col = MongoCollection<Contract, 'Task'>;
  type IncludeParam = Parameters<Col['include']>[0];
  expectTypeOf<'comments'>().not.toExtend<IncludeParam>();
});

test('select() accepts model field keys', () => {
  type Col = MongoCollection<Contract, 'User'>;
  type SelectParam = Parameters<Col['select']>;
  expectTypeOf<['_id', 'name']>().toExtend<SelectParam>();
});

test('select() rejects unknown field names', () => {
  type Col = MongoCollection<Contract, 'User'>;
  type SelectParam = Parameters<Col['select']>[0];
  expectTypeOf<'nonexistent'>().not.toExtend<SelectParam>();
});

test('orderBy() accepts model field keys', () => {
  type Col = MongoCollection<Contract, 'User'>;
  type OrderParam = Parameters<Col['orderBy']>[0];
  expectTypeOf<{ name: 1 }>().toExtend<OrderParam>();
});

test('orderBy() rejects unknown field names', () => {
  type Col = MongoCollection<Contract, 'User'>;
  type OrderParam = Parameters<Col['orderBy']>[0];
  expectTypeOf<{ nonexistent: 1 }>().not.toExtend<OrderParam>();
});

// --- Chained method result types ---

test('where().select().all() returns AsyncIterableResult<InferRootRow>', () => {
  const col = {} as MongoCollection<Contract, 'User'>;
  const result = col
    .where({} as never)
    .select('name')
    .all();
  expectTypeOf(result).toExtend<AsyncIterableResult<InferRootRow<Contract, 'User'>>>();
});

test('include().first() returns row with included relation field', () => {
  const col = {} as MongoCollection<Contract, 'Task'>;
  const result = col.include('assignee').first();
  expectTypeOf(result).toExtend<
    Promise<
      (InferRootRow<Contract, 'Task'> & { assignee: InferFullRow<Contract, 'User'> | null }) | null
    >
  >();
});

test('include().all() returns rows with included relation field', () => {
  const col = {} as MongoCollection<Contract, 'Task'>;
  const result = col.include('assignee').all();
  expectTypeOf(result).toExtend<
    AsyncIterableResult<
      InferRootRow<Contract, 'Task'> & { assignee: InferFullRow<Contract, 'User'> | null }
    >
  >();
});

test('all() without include() does not have relation field', () => {
  type Row = IncludedRow<Contract, 'Task'>;
  expectTypeOf<Row>().not.toHaveProperty('assignee');
});

test('where().orderBy().offset().limit().all() preserves row type', () => {
  const col = {} as MongoCollection<Contract, 'User'>;
  const result = col
    .where({} as never)
    .orderBy({ name: 1 })
    .offset(10)
    .limit(5)
    .all();
  expectTypeOf(result).toExtend<AsyncIterableResult<InferRootRow<Contract, 'User'>>>();
});

test('select() rejects nonexistent field after chaining', () => {
  const col = {} as MongoCollection<Contract, 'User'>;
  const chained = col.where({} as never);
  type SelectParam = Parameters<typeof chained.select>[0];
  expectTypeOf<'nonexistent'>().not.toExtend<SelectParam>();
});

// --- VariantCreateInput ---

test('VariantCreateInput includes base + variant fields minus _id and discriminator', () => {
  type BugCreate = VariantCreateInput<Contract, 'Task', 'Bug'>;
  expectTypeOf<BugCreate>().toHaveProperty('title');
  expectTypeOf<BugCreate>().toHaveProperty('assigneeId');
  expectTypeOf<BugCreate>().toHaveProperty('severity');
  expectTypeOf<BugCreate>().not.toHaveProperty('type');
});

test('VariantCreateInput excludes other variant fields', () => {
  type BugCreate = VariantCreateInput<Contract, 'Task', 'Bug'>;
  expectTypeOf<BugCreate>().not.toHaveProperty('priority');
  expectTypeOf<BugCreate>().not.toHaveProperty('targetRelease');
});

test('ResolvedCreateInput falls through to CreateInput when TVariant is never', () => {
  type Resolved = ResolvedCreateInput<Contract, 'Task', never>;
  type Expected = CreateInput<Contract, 'Task'>;
  expectTypeOf<Resolved>().toEqualTypeOf<Expected>();
});

test('ResolvedCreateInput resolves to VariantCreateInput when variant is specified', () => {
  type Resolved = ResolvedCreateInput<Contract, 'Task', 'Bug'>;
  type Expected = VariantCreateInput<Contract, 'Task', 'Bug'>;
  expectTypeOf<Resolved>().toEqualTypeOf<Expected>();
});

test('variant().create() accepts variant-specific fields without discriminator', () => {
  const col = {} as MongoCollection<Contract, 'Task'>;
  const bug = col.variant('Bug');
  type CreateParam = Parameters<typeof bug.create>[0];
  expectTypeOf<CreateParam>().toHaveProperty('title');
  expectTypeOf<CreateParam>().toHaveProperty('severity');
  expectTypeOf<CreateParam>().not.toHaveProperty('type');
});

test('non-variant create() uses base CreateInput', () => {
  const col = {} as MongoCollection<Contract, 'Task'>;
  type CreateParam = Parameters<typeof col.create>[0];
  expectTypeOf<CreateParam>().toHaveProperty('type');
  expectTypeOf<CreateParam>().toHaveProperty('title');
});

test('variant() preserves TVariant through chaining', () => {
  const col = {} as MongoCollection<Contract, 'Task'>;
  const chained = col
    .variant('Bug')
    .where({} as never)
    .limit(10);
  type CreateParam = Parameters<typeof chained.create>[0];
  expectTypeOf<CreateParam>().toHaveProperty('severity');
  expectTypeOf<CreateParam>().not.toHaveProperty('type');
});

// --- 1:N reference relation include ---

test('include() on 1:N reference relation returns array type', () => {
  const col = {} as MongoCollection<Contract, 'User'>;
  const result = col.include('tasks').first();
  expectTypeOf(result).toExtend<
    Promise<(InferRootRow<Contract, 'User'> & { tasks: InferFullRow<Contract, 'Task'>[] }) | null>
  >();
});

test('include() on 1:N reference relation all() returns array type', () => {
  const col = {} as MongoCollection<Contract, 'User'>;
  const result = col.include('tasks').all();
  expectTypeOf(result).toExtend<
    AsyncIterableResult<
      InferRootRow<Contract, 'User'> & { tasks: InferFullRow<Contract, 'Task'>[] }
    >
  >();
});

// --- Field accessor types ---

test('FieldAccessor has FieldExpression for scalar fields', () => {
  type Accessor = FieldAccessor<Contract, 'User', CodecTypes>;
  expectTypeOf<Accessor['name']>().toExtend<FieldExpression<string>>();
  expectTypeOf<Accessor['loginCount']>().toMatchTypeOf<{
    set: (v: unknown) => FieldOperation;
    unset: () => FieldOperation;
  }>();
});

test('FieldAccessor has FieldExpression for array fields', () => {
  type Accessor = FieldAccessor<Contract, 'User', CodecTypes>;
  expectTypeOf<Accessor['tags']>().toExtend<FieldExpression<string[]>>();
});

test('FieldAccessor resolves value-object field to concrete type, not unknown', () => {
  type Accessor = FieldAccessor<Contract, 'User', CodecTypes>;
  type HomeAddressExpr = Accessor['homeAddress'];

  // @ts-expect-error set() rejects a number when field type is value-object
  void ({} as HomeAddressExpr).set(42);
});

test('DotPath resolves value object dot-paths', () => {
  type Paths = DotPath<Contract, 'User'>;
  expectTypeOf<'homeAddress.city'>().toExtend<Paths>();
  expectTypeOf<'homeAddress.country'>().toExtend<Paths>();
});

test('DotPath rejects invalid paths', () => {
  type Paths = DotPath<Contract, 'User'>;
  expectTypeOf<'homeAddress.nonexistent'>().not.toExtend<Paths>();
  expectTypeOf<'nonexistent.field'>().not.toExtend<Paths>();
});

test('ResolveDotPathType resolves to scalar type', () => {
  type CityType = ResolveDotPathType<Contract, 'User', 'homeAddress.city'>;
  expectTypeOf<CityType>().toEqualTypeOf<string>();
});

test('FieldExpression inc/mul restricted to numeric types', () => {
  type StringExpr = FieldExpression<string>;
  type NumberExpr = FieldExpression<number>;

  // @ts-expect-error inc is not available on string fields
  void ({} as StringExpr).inc(1);
  // @ts-expect-error mul is not available on string fields
  void ({} as StringExpr).mul(2);

  void ({} as NumberExpr).inc(1);
  void ({} as NumberExpr).mul(2);
});
