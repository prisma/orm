import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { uuidv4 } from '@internal/ids';
import { expectTypeOf, test } from 'vitest';
import type { DefaultModelRow, MutationCreateInput, MutationUpdateInput } from '../src/types';
import { defineContract, field, model, rel } from './contract-builder';
import type { Contract } from './fixtures/generated/contract';
import type { Contract as JunctionNsContract } from './fixtures/junction-namespaces/generated/contract';

type RoleCreate = MutationCreateInput<Contract, 'Role'>;
type TagCreate = MutationCreateInput<Contract, 'Tag'>;
type RoleUpdate = MutationUpdateInput<Contract, 'Role'>;

const roleCreate = { id: 'admin', name: 'Admin' } as RoleCreate;
const tagCreate = { id: 'featured', name: 'Featured' } as TagCreate;
const roleCriterion = { id: 'admin' } as { readonly id: DefaultModelRow<Contract, 'Role'>['id'] };
const tagCriterion = { id: 'featured' } as { readonly id: DefaultModelRow<Contract, 'Tag'>['id'] };
const roleUpdate = { name: 'Admin' } as RoleUpdate;

// An execution-only-defaulted junction payload column: `level` is NOT NULL with
// no storage default, and `field.generated` is the sole source of its onCreate
// value. Authoring it through the DSL is the only way the runtime gate sees an
// execution onCreate default (runtime counterpart: insertJunctionLink applies
// the default before the INSERT). Derived with `typeof` — no synthetic types.
const ExecRole = model('Role', {
  fields: {
    id: field.column(textColumn).id(),
    name: field.column(textColumn).unique(),
  },
}).sql({ table: 'roles' });

const ExecUserRole = model('UserRole', {
  fields: {
    userId: field.column(int4Column).column('user_id'),
    roleId: field.column(textColumn).column('role_id'),
    // NOT NULL payload column whose only default is the execution-time onCreate
    // generator — the arm that keeps create/connect enabled.
    token: field.generated(uuidv4()),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.userId, fields.roleId]),
  }))
  .sql({ table: 'user_roles' });

const ExecUser = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
    email: field.column(textColumn).unique(),
  },
})
  .relations({
    roles: rel.manyToMany(() => ExecRole, {
      through: () => ExecUserRole,
      from: 'userId',
      to: 'roleId',
    }),
  })
  .sql({ table: 'users' });

const executionDefaultContract = defineContract({
  models: { User: ExecUser, Role: ExecRole, UserRole: ExecUserRole },
});

type ExecutionDefaultedContract = typeof executionDefaultContract;
type ExecRoleCreate = MutationCreateInput<ExecutionDefaultedContract, 'Role'>;
const execRoleCreate = { id: 'admin', name: 'Admin' } as ExecRoleCreate;
const execRoleCriterion = { id: 'admin' } as { readonly id: NonNullable<ExecRoleCreate['id']> };

// A pure-junction M:N whose junction lives in a non-`public` namespace: the
// relation lookup must resolve the junction through its declared namespace, not
// `public`. Authored through the DSL with a declared `shadow` namespace.
const ShadowTarget = model('Target', {
  fields: {
    id: field.column(int4Column).id(),
    label: field.column(textColumn).unique(),
  },
}).sql({ table: 'targets' });

const ShadowLink = model('UserTarget', {
  namespace: 'shadow',
  fields: {
    userId: field.column(int4Column).column('user_id'),
    targetId: field.column(int4Column).column('target_id'),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.userId, fields.targetId]),
  }))
  .sql({ table: 'user_targets' });

const shadowContract = defineContract({
  namespaces: ['shadow'],
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        name: field.column(textColumn),
        email: field.column(textColumn).unique(),
      },
    })
      .relations({
        targets: rel.manyToMany(() => ShadowTarget, {
          through: () => ShadowLink,
          from: 'userId',
          to: 'targetId',
        }),
      })
      .sql({ table: 'users' }),
    Target: ShadowTarget,
    UserTarget: ShadowLink,
  },
});

type ShadowedContract = typeof shadowContract;
type ShadowTargetCreate = MutationCreateInput<ShadowedContract, 'Target'>;
const shadowTargetCreate = { id: 1, label: 'first' } as ShadowTargetCreate;
const shadowTargetCriterion = { id: 1 } as {
  readonly id: NonNullable<ShadowTargetCreate['id']>;
};

// Emitted two-namespace fixture where `public` and `shadow` each declare the
// SAME junction table `user_roles` with the SAME payload column `token`, but
// only `public.user_roles.token` carries an execution-time onCreate default.
// Execution-default refs are namespace-scoped, so the junction-payload type gate
// must match `(namespace, table, column)`: `shadow.user_roles.token` is a
// required payload column with no default and must NOT borrow `public`'s.
// Sourced from an emitted fixture (not a DSL `typeof`) so the gate's
// namespace-keyed model resolution has literal namespace keys to work against.
type JnsPublicRoleCreate = MutationCreateInput<JunctionNsContract, 'Role'>;
const jnsPublicRoleCreate = { id: 'admin', name: 'Admin' } as JnsPublicRoleCreate;
type JnsShadowRoleCreate = MutationCreateInput<JunctionNsContract, 'ShadowRole'>;
const jnsShadowRoleCreate = { id: 'admin', name: 'Admin' } as JnsShadowRoleCreate;

test('nested create on a relation whose junction has a required payload column is a type error', () => {
  type Input = MutationCreateInput<Contract, 'User'>;

  const input: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    roles: (mutator) =>
      // @ts-expect-error - User.roles junction `user_roles` carries required column `level` the relation API can't populate, so nested create is disabled
      mutator.create(roleCreate),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('connect on a required-payload junction relation is a type error', () => {
  type Input = MutationCreateInput<Contract, 'User'>;

  const input: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    roles: (mutator) =>
      // @ts-expect-error - connect also INSERTs a junction row and can't supply the required `level` payload column
      mutator.connect(roleCriterion),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('disconnect is unavailable on a junction relation in create input', () => {
  type Input = MutationCreateInput<Contract, 'User'>;

  const input: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    roles: (mutator) =>
      // @ts-expect-error - disconnect() is update-only; createGraph rejects junction disconnect during create()
      mutator.disconnect([roleCriterion]),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('bare disconnect on a junction relation is a type error', () => {
  type Input = MutationUpdateInput<Contract, 'User'>;

  const input: Input = {
    tags: (mutator) =>
      // @ts-expect-error - junction disconnect requires a target criterion to avoid broad junction deletes
      mutator.disconnect(),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('connect on a required-payload junction relation is a type error in update input', () => {
  type Input = MutationUpdateInput<Contract, 'User'>;

  const input: Input = {
    roles: (mutator) =>
      // @ts-expect-error - update connect also INSERTs a junction row and can't supply the required `level` payload column
      mutator.connect(roleCriterion),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('criteria disconnect remains available on a required-payload junction relation in update input', () => {
  type Input = MutationUpdateInput<Contract, 'User'>;

  const input: Input = {
    roles: (mutator) => mutator.disconnect([roleCriterion]),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('update payloads remain available for target models behind required-payload junctions', () => {
  expectTypeOf(roleUpdate).toExtend<RoleUpdate>();
});

test('nested create on a pure junction relation is allowed', () => {
  type Input = MutationCreateInput<Contract, 'User'>;

  const input: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    tags: (mutator) => mutator.create(tagCreate),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('pure junction relation lookup is namespace-aware', () => {
  type Input = MutationCreateInput<ShadowedContract, 'User'>;

  const connectInput: Input = {
    id: 1,
    name: 'Alice',
    email: 'alice@test.com',
    targets: (mutator) => mutator.connect(shadowTargetCriterion),
  };

  const createInput: Input = {
    id: 1,
    name: 'Alice',
    email: 'alice@test.com',
    targets: (mutator) => mutator.create(shadowTargetCreate),
  };

  expectTypeOf(connectInput).toExtend<Input>();
  expectTypeOf(createInput).toExtend<Input>();
});

test('connect stays available but disconnect is unavailable on a pure junction relation in create input', () => {
  type Input = MutationCreateInput<Contract, 'User'>;

  const connectInput: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    tags: (mutator) => mutator.connect(tagCriterion),
  };

  const disconnectInput: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    tags: (mutator) =>
      // @ts-expect-error - disconnect() is update-only; createGraph rejects junction disconnect during create()
      mutator.disconnect([tagCriterion]),
  };

  expectTypeOf(connectInput).toExtend<Input>();
  expectTypeOf(disconnectInput).toExtend<Input>();
});

test('criteria disconnect stays available on a pure junction relation in update input', () => {
  type Input = MutationUpdateInput<Contract, 'User'>;

  const input: Input = {
    tags: (mutator) => mutator.disconnect([tagCriterion]),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('bare disconnect stays accepted for a plain 1:N relation', () => {
  type Input = MutationUpdateInput<Contract, 'User'>;

  const input: Input = {
    posts: (mutator) => mutator.disconnect(),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('nullable junction payload column keeps create and connect enabled', () => {
  // The emitted `User.tags` junction `user_tags` carries a nullable `note`
  // column alongside its FK pair, so the nullable-payload arm keeps create and
  // connect open.
  type Input = MutationCreateInput<Contract, 'User'>;

  const connectInput: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    tags: (mutator) => mutator.connect(tagCriterion),
  };

  const createInput: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    tags: (mutator) => mutator.create(tagCreate),
  };

  expectTypeOf(connectInput).toExtend<Input>();
  expectTypeOf(createInput).toExtend<Input>();
});

test('storage-defaulted junction payload column keeps create and connect enabled', () => {
  // The same `user_tags` junction also carries a NOT NULL `created_at` column
  // with a `now()` storage default, so the storage-default arm likewise keeps
  // create and connect open.
  type Input = MutationCreateInput<Contract, 'User'>;

  const connectInput: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    tags: (mutator) => mutator.connect(tagCriterion),
  };

  const createInput: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    tags: (mutator) => mutator.create(tagCreate),
  };

  expectTypeOf(connectInput).toExtend<Input>();
  expectTypeOf(createInput).toExtend<Input>();
});

test('execution-defaulted junction payload column keeps create and connect enabled', () => {
  type Input = MutationCreateInput<ExecutionDefaultedContract, 'User'>;

  const connectInput: Input = {
    id: 1,
    name: 'Alice',
    email: 'alice@test.com',
    roles: (mutator) => mutator.connect(execRoleCriterion),
  };

  const createInput: Input = {
    id: 1,
    name: 'Alice',
    email: 'alice@test.com',
    roles: (mutator) => mutator.create(execRoleCreate),
  };

  expectTypeOf(connectInput).toExtend<Input>();
  expectTypeOf(createInput).toExtend<Input>();
});

test('execution default keeps create enabled in its own namespace (public side of a collision)', () => {
  type Input = MutationCreateInput<JunctionNsContract, 'User'>;

  const createInput: Input = {
    id: 1,
    name: 'Alice',
    email: 'alice@test.com',
    roles: (mutator) => mutator.create(jnsPublicRoleCreate),
  };

  expectTypeOf(createInput).toExtend<Input>();
});

test('execution default does not leak across namespaces to a same-named junction column', () => {
  type Input = MutationCreateInput<JunctionNsContract, 'ShadowUser'>;

  const createInput: Input = {
    id: 1,
    name: 'Alice',
    email: 'alice@test.com',
    roles: (mutator) =>
      // @ts-expect-error - shadow.user_roles.token is a required payload column with no default in `shadow`; public's execution default for the same-named column must not make it look optional
      mutator.create(jnsShadowRoleCreate),
  };

  expectTypeOf(createInput).toExtend<Input>();
});
