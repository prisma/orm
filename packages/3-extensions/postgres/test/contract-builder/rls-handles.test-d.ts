/**
 * Static predicate matrix for the RLS policy helpers, mirroring Postgres:
 * SELECT/DELETE take `using` only; INSERT takes `withCheck` only; UPDATE/ALL
 * take either or both (at least one). Predicates are opaque strings.
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
} from '../../src/exports/contract-builder';

const intColumn = { codecId: 'pg/int4@1' } as const;

const Profile = model('Profile', {
  fields: { id: field.column(intColumn).id() },
}).sql({ table: 'profile' });

const anon = role('anon');

expectTypeOf(anon).toExtend<RlsRoleHandle<'anon'>>();
expectTypeOf(anon.name).toEqualTypeOf<'anon'>();

expectTypeOf(policySelect(Profile, { name: 'p', roles: [anon], using: 'true' })).toExtend<
  RlsPolicyHandle<'select'>
>();
expectTypeOf(policyInsert(Profile, { name: 'p', roles: [anon], withCheck: 'true' })).toExtend<
  RlsPolicyHandle<'insert'>
>();
expectTypeOf(
  policyUpdate(Profile, { name: 'p', roles: [anon], using: 'true', withCheck: 'true' }),
).toExtend<RlsPolicyHandle<'update'>>();
expectTypeOf(policyDelete(Profile, { name: 'p', roles: [anon], using: 'true' })).toExtend<
  RlsPolicyHandle<'delete'>
>();
expectTypeOf(
  policyAll(Profile, { name: 'p', roles: [anon], using: 'true', withCheck: 'true' }),
).toExtend<RlsPolicyHandle<'all'>>();

// UPDATE/ALL take using, withCheck, or both — each single-predicate form compiles.
expectTypeOf(policyUpdate(Profile, { name: 'p', roles: [anon], using: 'true' })).toExtend<
  RlsPolicyHandle<'update'>
>();
expectTypeOf(policyUpdate(Profile, { name: 'p', roles: [anon], withCheck: 'true' })).toExtend<
  RlsPolicyHandle<'update'>
>();
expectTypeOf(policyAll(Profile, { name: 'p', roles: [anon], using: 'true' })).toExtend<
  RlsPolicyHandle<'all'>
>();
expectTypeOf(policyAll(Profile, { name: 'p', roles: [anon], withCheck: 'true' })).toExtend<
  RlsPolicyHandle<'all'>
>();

// Predicates are opaque strings — a function form is not accepted.
expectTypeOf<RlsUsingPolicyDescriptor['using']>().toEqualTypeOf<string>();
expectTypeOf<RlsWithCheckPolicyDescriptor['withCheck']>().toEqualTypeOf<string>();

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
expectTypeOf<Extract<RlsUsingWithCheckPolicyDescriptor, { using: string }>>().not.toHaveProperty(
  'permissive',
);

// Roles must be role handles, not bare strings.
expectTypeOf<{
  name: string;
  roles: readonly string[];
  using: string;
}>().not.toExtend<RlsUsingPolicyDescriptor>();

// Model parameters take model handles, not table-name strings.
expectTypeOf<string>().not.toExtend<RlsTargetModel>();
expectTypeOf(rlsEnabled).parameter(0).toEqualTypeOf<RlsTargetModel>();
