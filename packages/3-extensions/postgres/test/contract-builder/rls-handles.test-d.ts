/**
 * Static predicate matrix for the RLS policy helpers, mirroring Postgres:
 * SELECT/DELETE take `using` only; INSERT takes `withCheck` only; UPDATE/ALL
 * take either or both (at least one). Predicates are `sql` values; a string
 * does not compile.
 * `permissive` is not authorable on any of them.
 */

import { expectTypeOf } from 'vitest';
import type {
  RlsPolicyHandle,
  RlsRoleHandle,
  RlsTargetModel,
  RlsUsingPolicyDescriptor,
  RlsUsingWithCheckPolicyDescriptor,
  RlsWithCheckPolicyDescriptor,
  SqlExpression,
} from '../../src/exports/contract-builder';
import {
  field,
  model,
  policyAll,
  policyDelete,
  policyInsert,
  policySelect,
  policyUpdate,
  rlsEnabled,
  role,
  sql,
} from '../../src/exports/contract-builder';

const intColumn = { codecId: 'pg/int4@1' } as const;

const Profile = model('Profile', {
  fields: { id: field.column(intColumn).id() },
}).sql({ table: 'profile' });

const anon = role('anon');
const yes = sql`true`;

expectTypeOf(anon).toExtend<RlsRoleHandle<'anon'>>();
expectTypeOf(anon.name).toEqualTypeOf<'anon'>();

expectTypeOf(policySelect(Profile, { name: 'p', roles: [anon], using: yes })).toExtend<
  RlsPolicyHandle<'select'>
>();
expectTypeOf(policyInsert(Profile, { name: 'p', roles: [anon], withCheck: yes })).toExtend<
  RlsPolicyHandle<'insert'>
>();
expectTypeOf(
  policyUpdate(Profile, { name: 'p', roles: [anon], using: yes, withCheck: yes }),
).toExtend<RlsPolicyHandle<'update'>>();
expectTypeOf(policyDelete(Profile, { name: 'p', roles: [anon], using: yes })).toExtend<
  RlsPolicyHandle<'delete'>
>();
expectTypeOf(policyAll(Profile, { name: 'p', roles: [anon], using: yes, withCheck: yes })).toExtend<
  RlsPolicyHandle<'all'>
>();

// UPDATE/ALL take using, withCheck, or both — each single-predicate form compiles.
expectTypeOf(policyUpdate(Profile, { name: 'p', roles: [anon], using: yes })).toExtend<
  RlsPolicyHandle<'update'>
>();
expectTypeOf(policyUpdate(Profile, { name: 'p', roles: [anon], withCheck: yes })).toExtend<
  RlsPolicyHandle<'update'>
>();
expectTypeOf(policyAll(Profile, { name: 'p', roles: [anon], using: yes })).toExtend<
  RlsPolicyHandle<'all'>
>();
expectTypeOf(policyAll(Profile, { name: 'p', roles: [anon], withCheck: yes })).toExtend<
  RlsPolicyHandle<'all'>
>();

// Predicates are sql values; a string, a number or a boolean does not compile.
expectTypeOf<RlsUsingPolicyDescriptor['using']>().not.toBeAny();
expectTypeOf<RlsUsingPolicyDescriptor['using']>().toEqualTypeOf<SqlExpression>();
expectTypeOf<RlsWithCheckPolicyDescriptor['withCheck']>().toEqualTypeOf<SqlExpression>();
expectTypeOf<RlsPolicyHandle['using']>().toEqualTypeOf<SqlExpression | undefined>();
expectTypeOf<RlsPolicyHandle['withCheck']>().toEqualTypeOf<SqlExpression | undefined>();
// @ts-expect-error a string predicate
policySelect(Profile, { name: 'p', roles: [anon], using: 'true' });
// @ts-expect-error a number predicate
policyDelete(Profile, { name: 'p', roles: [anon], using: 1 });
// @ts-expect-error a boolean predicate
policyInsert(Profile, { name: 'p', roles: [anon], withCheck: true });
// @ts-expect-error a string predicate
policyUpdate(Profile, { name: 'p', roles: [anon], using: yes, withCheck: 'true' });
// @ts-expect-error a string predicate
policyAll(Profile, { name: 'p', roles: [anon], using: 'true' });

// SELECT/DELETE descriptors do not take withCheck; INSERT does not take using.
expectTypeOf<RlsUsingPolicyDescriptor>().not.toHaveProperty('withCheck');
expectTypeOf<RlsWithCheckPolicyDescriptor>().not.toHaveProperty('using');

// Zero predicates on UPDATE/ALL is rejected.
expectTypeOf<{
  name: string;
  roles: readonly RlsRoleHandle[];
}>().not.toExtend<RlsUsingWithCheckPolicyDescriptor>();

// `permissive` is not a property of any descriptor type.
expectTypeOf<RlsUsingPolicyDescriptor>().not.toHaveProperty('permissive');
expectTypeOf<RlsWithCheckPolicyDescriptor>().not.toHaveProperty('permissive');
expectTypeOf<
  Extract<RlsUsingWithCheckPolicyDescriptor, { using: SqlExpression }>
>().not.toHaveProperty('permissive');

// Roles must be role handles, not bare strings.
expectTypeOf<{
  name: string;
  roles: readonly string[];
  using: SqlExpression;
}>().not.toExtend<RlsUsingPolicyDescriptor>();

// Model parameters take model handles, not table-name strings.
expectTypeOf<string>().not.toExtend<RlsTargetModel>();
expectTypeOf(rlsEnabled).parameter(0).toEqualTypeOf<RlsTargetModel>();
