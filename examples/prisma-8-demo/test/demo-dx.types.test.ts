/**
 * Type tests for demo DX with split Contract + TypeMaps.
 *
 * Verifies emitted workflow uses Contract and TypeMaps for correct lane inference,
 * and that runtime Contract value aligns with type (no HMR/type divergence).
 *
 * Spec: agent-os/specs/2026-02-15-runtime-dx-ir-shaped-contract-mappings-on-executioncontext/spec.md
 */

import type { ResultType } from '@prisma/orm-postgres/components/runtime';
import type { EnumMemberNames, EnumValues } from '@prisma/orm-postgres/contract/enum-accessor';
import type { Scalars, Shape } from '@prisma/orm-postgres/family-contract/types';
import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { PostgresContractSerializer } from '@prisma/orm-postgres/target/runtime';
import { expectTypeOf, test } from 'vitest';
import { createOrmClient } from '../src/orm-client/client';
import { ormClientGetUserProfile, type UserProfile } from '../src/orm-client/get-user-profile';
import type {
  AddressOutput,
  CodecTypes,
  Contract,
  Models as EmittedModels,
  FieldOutputTypes,
  models,
  TypeMaps,
} from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import { db } from '../src/prisma/db';
import type { getPostsByPriority } from '../src/queries/get-posts-by-priority';

// Models resolve per-namespace from the domain plane (no flat top-level Models export).
type Models = Contract['domain']['namespaces']['public']['models'];

test('contract.d.ts exports Contract and TypeMaps separately', () => {
  expectTypeOf<Contract>().toHaveProperty('domain');
  expectTypeOf<TypeMaps>().toHaveProperty('codecTypes');
  expectTypeOf<TypeMaps>().toHaveProperty('queryOperationTypes');
});

test('SPI deserializeContract output is assignable to visualization shape', () => {
  const contract = new PostgresContractSerializer().deserializeContract<Contract>(contractJson);

  expectTypeOf<Models>().toHaveProperty('User');
  expectTypeOf<Models>().toHaveProperty('Post');
  expectTypeOf(contract.storage.namespaces['public'].entries.table).toHaveProperty('user');
  expectTypeOf(contract.storage.namespaces['public'].entries.table).toHaveProperty('post');
  expectTypeOf(contract.domain.namespaces['public']!.models.User.storage.fields).toHaveProperty(
    'email',
  );
  expectTypeOf(contract.domain.namespaces['public']!.models.Post.storage.fields).toHaveProperty(
    'userId',
  );
});

test('emitted contract.d.ts types Post.priority as the value union, not number', () => {
  type PriorityOutput = FieldOutputTypes['public']['Post']['priority'];
  expectTypeOf<PriorityOutput>().toEqualTypeOf<0 | 1 | 2>();
  expectTypeOf<PriorityOutput>().not.toEqualTypeOf<number>();
});

// Emit vs no-emit agreement. The emitted `FieldOutputTypes` enum field type
// (produced on the emit path via the codec seam) must equal the enum's authored
// value union carried by `db.enums` (the no-emit reference — the authored member
// values propagated without serialization). Same enum, both paths, one union.
test('emitted Post.priority field type equals the no-emit db.enums value union', () => {
  type EmittedPriority = FieldOutputTypes['public']['Post']['priority'];
  type NoEmitPriorityValues = EnumValues<typeof db.enums.public.Priority>;
  expectTypeOf<EmittedPriority>().toEqualTypeOf<NoEmitPriorityValues>();
});

test('emitted contract: db.sql.public.post SELECT priority yields the value union', () => {
  const plan = db.sql.public.post.select('id', 'priority').build();
  type Row = ResultType<typeof plan>;
  expectTypeOf<Row['priority']>().toEqualTypeOf<0 | 1 | 2>();
  expectTypeOf<Row['priority']>().not.toEqualTypeOf<number>();
});

test('emitted contract: getPostsByPriority rows have priority typed as the value union', async () => {
  type Rows = Awaited<ReturnType<typeof getPostsByPriority>>;
  type RowPriority = Rows[number]['priority'];
  expectTypeOf<RowPriority>().toEqualTypeOf<0 | 1 | 2>();
  expectTypeOf<RowPriority>().not.toEqualTypeOf<number>();
});

test('emitted contract: db.sql.public.post INSERT rejects values outside the union', () => {
  db.sql.public.post.insert([{ id: 'a', title: 'ok', userId: 'u', priority: 1 }]).build();

  db.sql.public.post.insert([
    // @ts-expect-error 3 is not a Priority member value
    { id: 'b', title: 'bad', userId: 'u', priority: 3 },
  ]);
});

test('emitted contract: db.enums.public.Priority yields literal types through the emitted contract.d.ts', () => {
  type MemberHigh = (typeof db.enums.public.Priority)['members']['High'];
  type Values = (typeof db.enums.public.Priority)['values'];

  expectTypeOf<MemberHigh>().toEqualTypeOf<1>();
  expectTypeOf<MemberHigh>().not.toEqualTypeOf<number>();

  expectTypeOf<Values[0]>().toEqualTypeOf<0>();
  expectTypeOf<Values[1]>().toEqualTypeOf<1>();
  expectTypeOf<Values[2]>().toEqualTypeOf<2>();
  expectTypeOf<Values[0]>().not.toEqualTypeOf<number>();
});

test('emitted contract: EnumValues<Priority> resolves to the literal value union via emitted contract', () => {
  type Priority = typeof db.enums.public.Priority;
  expectTypeOf<EnumValues<Priority>>().toEqualTypeOf<0 | 1 | 2>();
  expectTypeOf<EnumValues<Priority>>().not.toEqualTypeOf<number>();
});

test('emitted contract: EnumMemberNames<Priority> resolves to the literal name union via emitted contract', () => {
  type Priority = typeof db.enums.public.Priority;
  expectTypeOf<EnumMemberNames<Priority>>().toEqualTypeOf<'Low' | 'High' | 'Urgent'>();
  expectTypeOf<EnumMemberNames<Priority>>().not.toEqualTypeOf<string>();
});

test('emitted models constant and Models namespace name the same type, and an ORM include equals Shape', () => {
  type User = typeof models.public.User;
  expectTypeOf<User>().toEqualTypeOf<EmittedModels.public_User>();
  expectTypeOf<Scalars<User>>().toEqualTypeOf<ResultType<typeof db.orm.public.User>>();

  type PostTag = typeof models.public.PostTag;
  const postTagsWithTag = () => db.orm.public.PostTag.include('tag');
  expectTypeOf<ResultType<ReturnType<typeof postTagsWithTag>>>().toEqualTypeOf<
    Shape<PostTag, { '+': 'tag' }>
  >();

  const usersWithTasks = () => db.orm.public.User.include('tasks');
  expectTypeOf<ResultType<ReturnType<typeof usersWithTasks>>>().toEqualTypeOf<
    Shape<EmittedModels.public_User, { '+': 'tasks' }>
  >();
});

test('an endpoint declares its response with Shape and the compiler checks the body at the return', () => {
  type UserResponse = Shape<
    EmittedModels.public_User,
    { '-': 'email'; posts: { '+': 'id' | 'title' | 'tags' } }
  >;

  async function getUserWithPosts(
    userId: EmittedModels.public_User['id'],
  ): Promise<UserResponse | null> {
    const user = await db.orm.public.User.where({ id: userId })
      .include('posts', (posts) => posts.include('tags'))
      .first();
    if (user === null) return null;
    const { email: _email, ...rest } = user;
    return { ...rest, posts: user.posts.map(({ id, title, tags }) => ({ id, title, tags })) };
  }
  expectTypeOf(getUserWithPosts).returns.resolves.toEqualTypeOf<{
    id: CodecTypes['pg/uuid@1']['output'];
    displayName: CodecTypes['pg/text@1']['output'];
    createdAt: CodecTypes['pg/timestamptz-temporal@1']['output'];
    kind: 'admin' | 'user';
    address: AddressOutput | null;
    posts: {
      id: CodecTypes['pg/uuid@1']['output'];
      title: CodecTypes['pg/text@1']['output'];
      tags: { id: CodecTypes['pg/uuid@1']['output']; label: CodecTypes['pg/text@1']['output'] }[];
    }[];
  } | null>();

  // @ts-expect-error the body omits posts, which the shape declares
  const withoutPosts = (row: Scalars<EmittedModels.public_User>): UserResponse => row;
  expectTypeOf(withoutPosts).returns.toEqualTypeOf<UserResponse>();
});

test('the demo user-profile endpoint returns the Shape it declares, and a body without the tags include is rejected', () => {
  type UserProfileResponse = {
    id: CodecTypes['pg/uuid@1']['output'];
    displayName: CodecTypes['pg/text@1']['output'];
    createdAt: CodecTypes['pg/timestamptz-temporal@1']['output'];
    kind: 'admin' | 'user';
    address: AddressOutput | null;
    posts: {
      id: CodecTypes['pg/uuid@1']['output'];
      title: CodecTypes['pg/text@1']['output'];
      tags: { id: CodecTypes['pg/uuid@1']['output']; label: CodecTypes['pg/text@1']['output'] }[];
    }[];
  };
  expectTypeOf<UserProfile>().toEqualTypeOf<UserProfileResponse>();
  expectTypeOf(
    ormClientGetUserProfile,
  ).returns.resolves.toEqualTypeOf<UserProfileResponse | null>();

  async function withoutTags(
    userId: EmittedModels.public_User['id'],
    runtime: Runtime,
  ): Promise<UserProfile | null> {
    const user = await createOrmClient(runtime).User.where({ id: userId }).include('posts').first();
    if (user === null) return null;
    const { email: _email, ...rest } = user;
    // @ts-expect-error the body omits the tags include, which the shape declares on posts
    return { ...rest, posts: user.posts.map(({ id, title }) => ({ id, title })) };
  }
  expectTypeOf(withoutTags).returns.resolves.toEqualTypeOf<UserProfile | null>();
});
