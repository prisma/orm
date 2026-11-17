/**
 * `defineContract({ entities: [...] })` lowers RLS handles into namespace
 * entries via the generic entity-handle channel, with PSL-matching keys and
 * wire names:
 *
 *  1. Every helper (all five operations, single- and dual-predicate update,
 *     roles referenced + declared, rlsEnabled) lands in
 *     `entries.policy[prefix]` / `entries.rls[tableName]` /
 *     `entries.role[name]` with the same entity shapes and content-hash wire
 *     names the PSL path produces (`lowerRlsPolicyFromBlock`).
 *  2. The lowered entities survive serialize → deserialize losslessly.
 *  3. Authoring mistakes throw at defineContract time, naming the prefix
 *     only: duplicate prefix per namespace, unknown target model, target
 *     without rlsEnabled, duplicate role declaration, prefix over the cap.
 *  4. A policy's tableName is always the build-resolved table name — factory
 *     `.sql({ table })` form and default (identity) naming both included.
 */

import { sql } from '@internal/sql-contract/sql-expression';
import { extensionModel } from '@internal/sql-contract-ts/contract-builder';
import { formatWireName } from '@internal/sql-schema-ir/naming';
import { computeContentHash } from '@internal/target-postgres/rls-canonicalize';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import type { PostgresSchema } from '@internal/target-postgres/types';
import {
  PostgresRlsEnablement,
  PostgresRlsPolicy,
  PostgresRole,
} from '@internal/target-postgres/types';
import { describe, expect, it, vi } from 'vitest';
import {
  defineContract,
  field,
  model,
  policyAll,
  policyDelete,
  policyInsert,
  policySelect,
  policyUpdate,
  type RlsEntityHandle,
  rlsEnabled,
  role,
} from '../../src/exports/contract-builder';

const intColumn = { codecId: 'pg/int4@1' } as const;
const textColumn = { codecId: 'pg/text@1' } as const;

const anon = role('anon');
const authenticated = role('authenticated');
const appUser = role('app_user');

function makeProfile() {
  return model('Profile', {
    fields: {
      id: field.column(intColumn).id(),
      userId: field.column(textColumn),
    },
  }).sql({ table: 'profile' });
}

function namespace(contract: { storage: { namespaces: Record<string, unknown> } }, id: string) {
  const ns = contract.storage.namespaces[id] as PostgresSchema | undefined;
  if (ns === undefined) {
    throw new Error(`expected namespace "${id}" to be declared`);
  }
  return ns;
}

describe('entities lowering: every helper lands in entries with PSL-matching keys', () => {
  const Profile = makeProfile();
  const usingSql = sql`owner_id = current_setting('app.uid')::int`;

  const contract = defineContract({
    models: { Profile },
    entities: [
      role('app_user'),
      rlsEnabled(Profile),
      policySelect(Profile, { name: 'p_read', roles: [appUser], using: usingSql }),
      policyInsert(Profile, { name: 'p_insert', roles: [appUser], withCheck: sql`true` }),
      policyUpdate(Profile, {
        name: 'p_write',
        roles: [appUser],
        using: usingSql,
        withCheck: usingSql,
      }),
      policyUpdate(Profile, { name: 'p_write_using_only', roles: [appUser], using: usingSql }),
      policyDelete(Profile, { name: 'p_delete', roles: [appUser], using: usingSql }),
      policyAll(Profile, {
        name: 'p_all',
        roles: [anon, appUser],
        using: sql`true`,
        withCheck: sql`true`,
      }),
    ],
  });

  const ns = () => namespace(contract, 'public');
  // Roles are cluster-scoped, so they land in `__unbound__`, not the model's
  // namespace — identical to a PSL `role` block.
  const unbound = () => namespace(contract, '__unbound__');

  it('TS policy authoring is managed-only and emits no exact-name body warning', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      defineContract({
        models: { Profile: makeProfile() },
        entities: [
          rlsEnabled(Profile),
          policySelect(Profile, { name: 'p_silent', roles: [appUser], using: usingSql }),
        ],
      });
      expect(
        emitWarning.mock.calls.filter(
          ([, options]) =>
            (options as { code?: string } | undefined)?.code === 'PN_EXACT_NAME_BODY_COMPARISON',
        ),
      ).toEqual([]);
    } finally {
      emitWarning.mockRestore();
    }
  });

  it('keys entries.policy by prefix, entries.rls by tableName, entries.role by name', () => {
    expect(Object.keys(ns().policy).sort()).toEqual([
      'p_all',
      'p_delete',
      'p_insert',
      'p_read',
      'p_write',
      'p_write_using_only',
    ]);
    expect(Object.keys(ns().rls)).toEqual(['profile']);
    expect(Object.keys(ns().role)).toEqual([]);
    expect(Object.keys(unbound().role)).toEqual(['app_user']);
  });

  it('lowers policySelect to the same entity shape and wire name as the PSL path', () => {
    const expectedHash = computeContentHash({
      using: usingSql.text,
      roles: ['app_user'],
      operation: 'select',
      permissive: true,
    });
    const policy = ns().policy['p_read'];
    expect(policy).toBeInstanceOf(PostgresRlsPolicy);
    expect(JSON.parse(JSON.stringify(policy))).toEqual({
      kind: 'policy',
      name: formatWireName('p_read', expectedHash),
      prefix: 'p_read',
      tableName: 'profile',
      namespaceId: 'public',
      operation: 'select',
      roles: ['app_user'],
      using: usingSql.text,
      permissive: true,
    });
  });

  it('lowers every operation with its authored predicates and nothing else', () => {
    expect(ns().policy['p_insert']).toMatchObject({
      operation: 'insert',
      withCheck: 'true',
      tableName: 'profile',
    });
    expect(ns().policy['p_insert']?.using).toBeUndefined();

    expect(ns().policy['p_write']).toMatchObject({
      operation: 'update',
      using: usingSql.text,
      withCheck: usingSql.text,
    });

    expect(ns().policy['p_write_using_only']).toMatchObject({
      operation: 'update',
      using: usingSql.text,
    });
    expect(ns().policy['p_write_using_only']?.withCheck).toBeUndefined();

    expect(ns().policy['p_delete']).toMatchObject({ operation: 'delete', using: usingSql.text });
    expect(ns().policy['p_all']).toMatchObject({
      operation: 'all',
      using: 'true',
      withCheck: 'true',
      roles: ['anon', 'app_user'],
    });
  });

  it('single-predicate update omits the absent predicate from the hash (PSL omission parity)', () => {
    const expectedHash = computeContentHash({
      using: usingSql.text,
      roles: ['app_user'],
      operation: 'update',
      permissive: true,
    });
    expect(ns().policy['p_write_using_only']?.name).toBe(
      formatWireName('p_write_using_only', expectedHash),
    );
  });

  it('lowers rlsEnabled to the enablement marker agreeing with the policies', () => {
    const marker = ns().rls['profile'];
    expect(marker).toBeInstanceOf(PostgresRlsEnablement);
    expect(JSON.parse(JSON.stringify(marker))).toEqual({
      kind: 'rls',
      tableName: 'profile',
      namespaceId: 'public',
    });
  });

  it('lowers a declared role to a PostgresRole entity under __unbound__', () => {
    const declared = unbound().role['app_user'];
    expect(declared).toBeInstanceOf(PostgresRole);
    expect(JSON.parse(JSON.stringify(declared))).toEqual({
      kind: 'role',
      name: 'app_user',
      namespaceId: '__unbound__',
      control: 'external',
    });
  });

  it('referenced-but-undeclared roles flow into policy roles as sorted deduped bare names', () => {
    // anon is referenced in p_all but never declared in entities.
    expect(Object.keys(unbound().role)).toEqual(['app_user']);
    expect(ns().policy['p_all']?.roles).toEqual(['anon', 'app_user']);
  });
});

describe('round-trip through the contract serializer', () => {
  it('preserves policy, rls, and role entries losslessly', () => {
    const Profile = makeProfile();
    const contract = defineContract({
      models: { Profile },
      entities: [
        role('app_user'),
        rlsEnabled(Profile),
        policySelect(Profile, { name: 'p_read', roles: [appUser], using: sql`true` }),
      ],
    });

    const serializer = new PostgresContractSerializer();
    const json = JSON.parse(JSON.stringify(serializer.serializeContract(contract))) as unknown;
    const roundTripped = serializer.deserializeContract(json);

    const ns = roundTripped.storage.namespaces['public'] as PostgresSchema;
    const unbound = roundTripped.storage.namespaces['__unbound__'] as PostgresSchema;
    const original = namespace(contract, 'public');

    expect(ns.policy['p_read']).toBeInstanceOf(PostgresRlsPolicy);
    expect(JSON.parse(JSON.stringify(ns.policy['p_read']))).toEqual(
      JSON.parse(JSON.stringify(original.policy['p_read'])),
    );
    expect(ns.rls['profile']).toBeInstanceOf(PostgresRlsEnablement);
    expect(unbound.role['app_user']).toBeInstanceOf(PostgresRole);
  });
});

describe('load-time diagnostics name the prefix', () => {
  it.each([
    ['using', policySelect, { using: 'true' }],
    ['withCheck', policyInsert, { withCheck: 'true' }],
    ['using', policyUpdate, { using: 'true', withCheck: sql`true` }],
    ['withCheck', policyUpdate, { using: sql`true`, withCheck: 'true' }],
  ] as const)('refuses a string %s from an untyped caller', (predicate, helper, predicates) => {
    const Profile = makeProfile();
    const untypedHelper = helper as (model: unknown, descriptor: unknown) => RlsEntityHandle;
    const what = `Policy "p" ${predicate}`;
    expect(() =>
      defineContract({
        models: { Profile },
        entities: [
          rlsEnabled(Profile),
          untypedHelper(Profile, { name: 'p', roles: [anon], ...predicates }),
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: `${what} must be a sql\`...\` value.`,
        meta: { what },
      }),
    );
  });

  it('rejects a duplicate policy prefix in one namespace', () => {
    const Profile = makeProfile();
    expect(() =>
      defineContract({
        models: { Profile },
        entities: [
          rlsEnabled(Profile),
          policySelect(Profile, { name: 'p_read', roles: [anon], using: sql`true` }),
          policyDelete(Profile, { name: 'p_read', roles: [anon], using: sql`false` }),
        ],
      }),
    ).toThrow(/policy prefix "p_read" is declared more than once in namespace "public"/);
  });

  it('rejects a policy targeting a model that is not in models', () => {
    const Profile = makeProfile();
    const Orphan = model('Orphan', {
      fields: { id: field.column(intColumn).id() },
    }).sql({ table: 'orphans' });

    expect(() =>
      defineContract({
        models: { Profile },
        entities: [policySelect(Orphan, { name: 'p_orphan', roles: [anon], using: sql`true` })],
      }),
    ).toThrow(/policy "p_orphan" targets model "Orphan", which is not in the contract's models/);
  });

  it('rejects an rlsEnabled entry targeting a model that is not in models', () => {
    const Orphan = model('Orphan', {
      fields: { id: field.column(intColumn).id() },
    }).sql({ table: 'orphans' });

    expect(() => defineContract({ entities: [rlsEnabled(Orphan)] })).toThrow(
      /rlsEnabled entry targets model "Orphan", which is not in the contract's models/,
    );
  });

  it('rejects a policy whose target has no rlsEnabled entry', () => {
    const Profile = makeProfile();
    expect(() =>
      defineContract({
        models: { Profile },
        entities: [policySelect(Profile, { name: 'p_read', roles: [anon], using: sql`true` })],
      }),
    ).toThrow(/policy "p_read" targets model "Profile".*rlsEnabled/);
  });

  it('rejects a policy targeting a cross-space model, naming the prefix', () => {
    const AuthUser = extensionModel(
      'AuthUser',
      { namespace: 'auth', fields: { id: field.column(textColumn).id() }, table: 'users' },
      'supabase',
    );
    const Profile = makeProfile();

    expect(() =>
      defineContract({
        models: { Profile },
        entities: [
          rlsEnabled(Profile),
          policySelect(AuthUser, { name: 'p_cross', roles: [anon], using: sql`true` }),
        ],
      }),
    ).toThrow(/policy "p_cross" targets model "AuthUser", which lives in another contract space/);
  });

  it('rejects an rlsEnabled entry targeting a cross-space model', () => {
    const AuthUser = extensionModel(
      'AuthUser',
      { namespace: 'auth', fields: { id: field.column(textColumn).id() }, table: 'users' },
      'supabase',
    );

    expect(() => defineContract({ entities: [rlsEnabled(AuthUser)] })).toThrow(
      /rlsEnabled entry targets model "AuthUser", which lives in another contract space/,
    );
  });

  it('rejects a duplicate role-name declaration', () => {
    const Profile = makeProfile();
    expect(() =>
      defineContract({
        models: { Profile },
        entities: [role('app_user'), role('app_user')],
      }),
    ).toThrow(/role "app_user" is declared more than once/);
  });

  it('rejects a prefix over the 54-byte cap, naming the prefix only', () => {
    const Profile = makeProfile();
    const longPrefix = 'p'.repeat(55);
    expect(() =>
      defineContract({
        models: { Profile },
        entities: [
          rlsEnabled(Profile),
          policySelect(Profile, { name: longPrefix, roles: [anon], using: sql`true` }),
        ],
      }),
    ).toThrow(new RegExp(`policy prefix "${longPrefix}" exceeds the 54-byte maximum`));
  });

  it('accepts a 54-character prefix (the cap is inclusive)', () => {
    const Profile = makeProfile();
    const maxPrefix = 'p'.repeat(54);
    const contract = defineContract({
      models: { Profile },
      entities: [
        rlsEnabled(Profile),
        policySelect(Profile, { name: maxPrefix, roles: [anon], using: sql`true` }),
      ],
    });
    expect(namespace(contract, 'public').policy[maxPrefix]?.name).toMatch(/_[0-9a-f]{8}$/);
  });
});

describe('tableName is always the build-resolved table name', () => {
  it('default (identity) naming: a model without .sql keys to its verbatim model name', () => {
    // Identity naming keeps the capital O — the PSL-style lowercase guess
    // would produce "order" and mismatch the real table.
    const Order = model('Order', { fields: { id: field.column(intColumn).id() } });
    const contract = defineContract({
      models: { Order },
      entities: [
        rlsEnabled(Order),
        policySelect(Order, { name: 'p_orders', roles: [anon], using: sql`true` }),
      ],
    });

    const ns = namespace(contract, 'public');
    expect(Object.keys(ns.rls)).toEqual(['Order']);
    expect(ns.policy['p_orders']?.tableName).toBe('Order');
  });

  it('.sql factory form: the policy keys to the declared table, agreeing with the marker', () => {
    const Profile = model('Profile', {
      fields: { id: field.column(intColumn).id() },
    }).sql(() => ({ table: 'profile_rows' }));
    const contract = defineContract({
      models: { Profile },
      entities: [
        rlsEnabled(Profile),
        policySelect(Profile, { name: 'p_read', roles: [anon], using: sql`true` }),
      ],
    });

    const ns = namespace(contract, 'public');
    expect(ns.policy['p_read']?.tableName).toBe('profile_rows');
    expect(Object.keys(ns.rls)).toEqual(['profile_rows']);
  });

  it('a named-schema model files its policy under that namespace', () => {
    const Session = model('Session', {
      namespace: 'auth',
      fields: { id: field.column(intColumn).id() },
    }).sql({ table: 'sessions' });
    const contract = defineContract({
      namespaces: ['auth'],
      models: { Session },
      entities: [
        rlsEnabled(Session),
        policySelect(Session, { name: 'p_sessions', roles: [authenticated], using: sql`true` }),
      ],
    });

    const auth = namespace(contract, 'auth');
    expect(auth.policy['p_sessions']).toMatchObject({
      tableName: 'sessions',
      namespaceId: 'auth',
    });
    expect(Object.keys(auth.rls)).toEqual(['sessions']);
    expect(Object.keys(namespace(contract, 'public').policy)).toEqual([]);
  });
});

describe('entities coexist with the factory authoring form', () => {
  it('lowers entities against factory-returned models', () => {
    const Profile = makeProfile();
    const contract = defineContract(
      {
        entities: [
          rlsEnabled(Profile),
          policySelect(Profile, { name: 'p_read', roles: [anon], using: sql`true` }),
        ],
      },
      () => ({ models: { Profile } }),
    );

    const ns = namespace(contract, 'public');
    expect(ns.policy['p_read']).toMatchObject({ prefix: 'p_read', tableName: 'profile' });
    expect(Object.keys(ns.rls)).toEqual(['profile']);
  });
});
