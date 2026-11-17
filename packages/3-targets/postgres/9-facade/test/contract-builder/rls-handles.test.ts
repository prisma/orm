/**
 * RLS authoring handles (`policySelect`/`policyInsert`/`policyUpdate`/
 * `policyDelete`/`policyAll`, `rlsEnabled`, `role`) are inert branded values:
 *
 *  1. Each helper captures its inputs faithfully — name, roles, predicate
 *     strings, and the model handle by reference. Nothing is resolved,
 *     hashed, or registered at construction time.
 *  2. Handles are frozen plain values, safely reusable across arrays and
 *     helper calls.
 *  3. Empty names are rejected at construction.
 */

import { sql } from '@internal/sql-contract/sql-expression';
import { extensionModel } from '@internal/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import type { RlsRoleHandle } from '../../src/exports/contract-builder';
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
const textColumn = { codecId: 'pg/text@1' } as const;

const Profile = model('Profile', {
  fields: {
    id: field.column(intColumn).id(),
    userId: field.column(textColumn),
  },
}).sql({ table: 'profile' });

const anon = role('anon');
const authenticated = role('authenticated');

describe('role', () => {
  it('captures the name on a frozen branded handle', () => {
    expect(anon).toEqual({ entityKind: 'role', name: 'anon' });
    expect(Object.isFrozen(anon)).toBe(true);
  });

  it('preserves the literal name type at runtime and rejects an empty name', () => {
    expect(role('app_user').name).toBe('app_user');
    expect(() => role('')).toThrow(/name must be a non-empty string/);
    expect(() => role('   ')).toThrow(/name must be a non-empty string/);
  });
});

describe('rlsEnabled', () => {
  it('captures the model handle by reference on a frozen branded handle', () => {
    const handle = rlsEnabled(Profile);
    expect(handle).toEqual({ entityKind: 'rls', refs: { target: Profile } });
    expect(handle.refs.target).toBe(Profile);
    expect(Object.isFrozen(handle)).toBe(true);
  });

  it('accepts a cross-space extensionModel handle', () => {
    const AuthUser = extensionModel(
      'AuthUser',
      { namespace: 'auth', fields: { id: field.column(textColumn).id() }, table: 'users' },
      'supabase',
    );
    const handle = rlsEnabled(AuthUser);
    expect(handle.refs.target).toBe(AuthUser);
  });
});

describe('policy helpers capture inputs faithfully', () => {
  it('policySelect: name, roles, sql using, model by reference', () => {
    const handle = policySelect(Profile, {
      name: 'profile_owner_read',
      roles: [authenticated],
      using: sql`"userId"::uuid = auth.uid()`,
    });

    expect(handle).toEqual({
      entityKind: 'policy',
      operation: 'select',
      name: 'profile_owner_read',
      refs: { target: Profile },
      roles: [authenticated],
      using: sql`"userId"::uuid = auth.uid()`,
    });
    expect(handle.refs.target).toBe(Profile);
    expect(handle.roles[0]).toBe(authenticated);
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.isFrozen(handle.roles)).toBe(true);
  });

  it('policyDelete: using only', () => {
    const handle = policyDelete(Profile, {
      name: 'profile_owner_delete',
      roles: [authenticated],
      using: sql`true`,
    });

    expect(handle).toEqual({
      entityKind: 'policy',
      operation: 'delete',
      name: 'profile_owner_delete',
      refs: { target: Profile },
      roles: [authenticated],
      using: sql`true`,
    });
  });

  it('policyInsert: withCheck only', () => {
    const handle = policyInsert(Profile, {
      name: 'profile_owner_insert',
      roles: [authenticated],
      withCheck: sql`"userId"::uuid = auth.uid()`,
    });

    expect(handle).toEqual({
      entityKind: 'policy',
      operation: 'insert',
      name: 'profile_owner_insert',
      refs: { target: Profile },
      roles: [authenticated],
      withCheck: sql`"userId"::uuid = auth.uid()`,
    });
  });

  it('policyUpdate: using and withCheck', () => {
    const handle = policyUpdate(Profile, {
      name: 'profile_owner_write',
      roles: [authenticated],
      using: sql`"userId"::uuid = auth.uid()`,
      withCheck: sql`"userId"::uuid = auth.uid()`,
    });

    expect(handle).toEqual({
      entityKind: 'policy',
      operation: 'update',
      name: 'profile_owner_write',
      refs: { target: Profile },
      roles: [authenticated],
      using: sql`"userId"::uuid = auth.uid()`,
      withCheck: sql`"userId"::uuid = auth.uid()`,
    });
  });

  it('policyUpdate with only using: the handle carries exactly the authored predicate', () => {
    const handle = policyUpdate(Profile, {
      name: 'profile_owner_write',
      roles: [authenticated],
      using: sql`"userId"::uuid = auth.uid()`,
    });

    expect(handle).toEqual({
      entityKind: 'policy',
      operation: 'update',
      name: 'profile_owner_write',
      refs: { target: Profile },
      roles: [authenticated],
      using: sql`"userId"::uuid = auth.uid()`,
    });
    expect(Object.keys(handle)).not.toContain('withCheck');
  });

  it('policyAll with only withCheck: the handle carries exactly the authored predicate', () => {
    const handle = policyAll(Profile, {
      name: 'profile_check_all',
      roles: [authenticated],
      withCheck: sql`true`,
    });

    expect(handle).toEqual({
      entityKind: 'policy',
      operation: 'all',
      name: 'profile_check_all',
      refs: { target: Profile },
      roles: [authenticated],
      withCheck: sql`true`,
    });
    expect(Object.keys(handle)).not.toContain('using');
  });

  it('policyAll: using and withCheck', () => {
    const handle = policyAll(Profile, {
      name: 'profile_owner_all',
      roles: [anon, authenticated],
      using: sql`true`,
      withCheck: sql`true`,
    });

    expect(handle).toEqual({
      entityKind: 'policy',
      operation: 'all',
      name: 'profile_owner_all',
      refs: { target: Profile },
      roles: [anon, authenticated],
      using: sql`true`,
      withCheck: sql`true`,
    });
  });

  it('rejects an empty policy name', () => {
    expect(() => policySelect(Profile, { name: '', roles: [anon], using: sql`true` })).toThrow(
      /name must be a non-empty string/,
    );
    expect(() => policySelect(Profile, { name: '  ', roles: [anon], using: sql`true` })).toThrow(
      /name must be a non-empty string/,
    );
  });
});

describe('runtime predicate-matrix backstop for untyped callers', () => {
  type UntypedPolicyHelper = (model: unknown, descriptor: unknown) => unknown;

  it('rejects withCheck on select', () => {
    const untypedPolicySelect = policySelect as UntypedPolicyHelper;
    expect(() =>
      untypedPolicySelect(Profile, {
        name: 'p_read',
        roles: [anon],
        using: sql`true`,
        withCheck: sql`true`,
      }),
    ).toThrow(
      /policySelect: policy "p_read" does not take a `withCheck` predicate; the SELECT operation uses `using` only/,
    );
  });

  it('rejects withCheck on delete', () => {
    const untypedPolicyDelete = policyDelete as UntypedPolicyHelper;
    expect(() =>
      untypedPolicyDelete(Profile, {
        name: 'p_delete',
        roles: [anon],
        using: sql`true`,
        withCheck: sql`true`,
      }),
    ).toThrow(
      /policyDelete: policy "p_delete" does not take a `withCheck` predicate; the DELETE operation uses `using` only/,
    );
  });

  it('rejects using on insert', () => {
    const untypedPolicyInsert = policyInsert as UntypedPolicyHelper;
    expect(() =>
      untypedPolicyInsert(Profile, {
        name: 'p_insert',
        roles: [anon],
        using: sql`true`,
        withCheck: sql`true`,
      }),
    ).toThrow(
      /policyInsert: policy "p_insert" does not take a `using` predicate; the INSERT operation uses `withCheck` only/,
    );
  });

  it('rejects a zero-predicate update', () => {
    const untypedPolicyUpdate = policyUpdate as UntypedPolicyHelper;
    expect(() => untypedPolicyUpdate(Profile, { name: 'p_write', roles: [anon] })).toThrow(
      /policyUpdate: policy "p_write" requires at least one predicate; the UPDATE operation uses `using` and `withCheck`/,
    );
  });

  it('rejects a zero-predicate all', () => {
    const untypedPolicyAll = policyAll as UntypedPolicyHelper;
    expect(() => untypedPolicyAll(Profile, { name: 'p_all', roles: [anon] })).toThrow(
      /policyAll: policy "p_all" requires at least one predicate; the ALL operation uses `using` and `withCheck`/,
    );
  });
});

describe('handles are inert and reusable', () => {
  it('one role handle is safely shared across two policies', () => {
    const first = policySelect(Profile, { name: 'p_read', roles: [anon], using: sql`true` });
    const second = policyDelete(Profile, { name: 'p_delete', roles: [anon], using: sql`true` });

    expect(first.roles[0]).toBe(anon);
    expect(second.roles[0]).toBe(anon);
    expect(anon).toEqual({ entityKind: 'role', name: 'anon' });
  });

  it("mutating the caller's roles array after construction does not change the handle", () => {
    const roles: RlsRoleHandle[] = [anon];
    const handle = policySelect(Profile, { name: 'p_read', roles, using: sql`true` });
    roles.push(authenticated);
    expect(handle.roles).toEqual([anon]);
  });

  it('construction has no side effects: two identical calls produce equal, distinct handles', () => {
    const a = policySelect(Profile, { name: 'p_read', roles: [anon], using: sql`true` });
    const b = policySelect(Profile, { name: 'p_read', roles: [anon], using: sql`true` });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
