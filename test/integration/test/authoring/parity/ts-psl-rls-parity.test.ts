/**
 * TS/PSL RLS authoring parity (real packs): the walking-skeleton policies,
 * all five operations, a single-predicate update, and an @@map'd model,
 * authored in both surfaces, lower to structurally identical contracts —
 * identical `entries.policy` / `entries.rls` keys, identical content-hash
 * wire names, JSON-equal entities. Roles are referenced via the supabase
 * pack's `anon`/`authenticated` handles on the TS side and bare identifiers
 * on the PSL side. A declared role is authored in BOTH surfaces — TS
 * `role('app_role')` in `entities` vs PSL `namespace unbound { role app_role {} }`
 * — and lands the same `PostgresRole` in `__unbound__.entries.role`.
 */
import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import { anon, authenticated } from '@internal/extension-supabase/contract';
import sqlFamilyControl from '@internal/family-sql/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { createControlStack } from '@internal/framework-components/control';
import {
  defineContract,
  field,
  model,
  policyAll,
  policyDelete,
  policyInsert,
  policySelect,
  policyUpdate,
  rlsEnabled,
  role,
} from '@internal/postgres/contract-builder';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import postgresControl from '@internal/target-postgres/control';
import postgresPack from '@internal/target-postgres/pack';
import type { PostgresSchema } from '@internal/target-postgres/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: sqlFamilyControl,
  target: postgresControl,
  adapter: postgresAdapter,
  extensions: [],
});

function buildColumnDescriptorMap() {
  return collectScalarTypeConstructors(stack.authoringContributions.type);
}

function interpretWithRealPacks(schema: string) {
  const scalarColumnDescriptors = buildColumnDescriptorMap();
  const { document, sources } = parse(schema, 'rls-parity.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    documents: [document],
    symbolTable,
    sources,
    target: postgresPack,
    scalarColumnDescriptors,
    dataTypeLookup: stack.dataTypeLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    authoringContributions: stack.authoringContributions,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    capabilities: stack.capabilities,
    codecLookup: stack.codecLookup,
  });
}

const OWNER_PREDICATE = '"userId"::uuid = auth.uid()';

function buildTsModels() {
  return {
    Profile: model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(textColumn),
      },
    }).sql({ table: 'profile' }),
    AuditLog: model('AuditLog', {
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'audit_log' }),
  };
}

function buildTsEntities(models: ReturnType<typeof buildTsModels>) {
  const { Profile, AuditLog } = models;
  return [
    rlsEnabled(Profile),
    rlsEnabled(AuditLog),
    // Walking-skeleton policies.
    policySelect(Profile, {
      name: 'profile_owner_read',
      roles: [authenticated],
      using: OWNER_PREDICATE,
    }),
    policySelect(Profile, { name: 'profile_public_read', roles: [anon], using: 'true' }),
    policyUpdate(Profile, {
      name: 'profile_owner_write',
      roles: [authenticated],
      using: OWNER_PREDICATE,
      withCheck: OWNER_PREDICATE,
    }),
    // Remaining operations.
    policyInsert(Profile, {
      name: 'profile_owner_insert',
      roles: [authenticated],
      withCheck: OWNER_PREDICATE,
    }),
    policyDelete(Profile, {
      name: 'profile_owner_delete',
      roles: [authenticated],
      using: OWNER_PREDICATE,
    }),
    policyAll(Profile, {
      name: 'profile_admin_all',
      roles: [anon, authenticated],
      using: 'true',
      withCheck: 'true',
    }),
    // Single-predicate update (PSL accepts using-only; hash omits withCheck).
    policyUpdate(Profile, {
      name: 'profile_touch_write',
      roles: [authenticated],
      using: OWNER_PREDICATE,
    }),
    // Policy on the @@map'd model (storage name not derivable from the name).
    policySelect(AuditLog, { name: 'audit_read', roles: [authenticated], using: 'true' }),
    // A declared role — lands in `__unbound__.entries.role`, identical to the
    // PSL `namespace unbound { role app_role {} }` block below.
    role('app_role'),
  ];
}

const PSL_SOURCE = `namespace public {
  model Profile {
    id     Int    @id
    userId String

    @@map("profile")
    @@rls
  }

  model AuditLog {
    id Int @id

    @@map("audit_log")
    @@rls
  }

  policy_select profile_owner_read {
    target = Profile
    roles  = [authenticated]
    using  = "\\"userId\\"::uuid = auth.uid()"
  }

  policy_select profile_public_read {
    target = Profile
    roles  = [anon]
    using  = "true"
  }

  policy_update profile_owner_write {
    target    = Profile
    roles     = [authenticated]
    using     = "\\"userId\\"::uuid = auth.uid()"
    withCheck = "\\"userId\\"::uuid = auth.uid()"
  }

  policy_insert profile_owner_insert {
    target    = Profile
    roles     = [authenticated]
    withCheck = "\\"userId\\"::uuid = auth.uid()"
  }

  policy_delete profile_owner_delete {
    target = Profile
    roles  = [authenticated]
    using  = "\\"userId\\"::uuid = auth.uid()"
  }

  policy_all profile_admin_all {
    target    = Profile
    roles     = [anon, authenticated]
    using     = "true"
    withCheck = "true"
  }

  policy_update profile_touch_write {
    target = Profile
    roles  = [authenticated]
    using  = "\\"userId\\"::uuid = auth.uid()"
  }

  policy_select audit_read {
    target = AuditLog
    roles  = [authenticated]
    using  = "true"
  }
}

namespace unbound {
  role app_role {}
}
`;

const EXPECTED_POLICY_PREFIXES = [
  'audit_read',
  'profile_admin_all',
  'profile_owner_delete',
  'profile_owner_insert',
  'profile_owner_read',
  'profile_owner_write',
  'profile_public_read',
  'profile_touch_write',
];

function publicNamespace(contract: {
  storage: { namespaces: Record<string, unknown> };
}): PostgresSchema {
  const ns = contract.storage.namespaces['public'] as PostgresSchema | undefined;
  if (ns === undefined) throw new Error('expected the public namespace to be declared');
  return ns;
}

function unboundNamespace(contract: {
  storage: { namespaces: Record<string, unknown> };
}): PostgresSchema {
  const ns = contract.storage.namespaces['__unbound__'] as PostgresSchema | undefined;
  if (ns === undefined) throw new Error('expected the __unbound__ namespace to be declared');
  return ns;
}

describe('TS and PSL RLS authoring parity with real packs', () => {
  const models = buildTsModels();
  const tsContract = defineContract({
    models,
    entities: buildTsEntities(models),
  });

  const interpreted = interpretWithRealPacks(PSL_SOURCE);

  it('lowers both surfaces to identical contracts', () => {
    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;
    expect(interpreted.value).toEqual(tsContract);
  });

  it('keys entries.policy by prefix and entries.rls by table name, identically', () => {
    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    const tsNs = publicNamespace(tsContract);
    const pslNs = publicNamespace(interpreted.value);

    expect(Object.keys(tsNs.policy).sort()).toEqual(EXPECTED_POLICY_PREFIXES);
    expect(Object.keys(pslNs.policy).sort()).toEqual(EXPECTED_POLICY_PREFIXES);
    expect(Object.keys(tsNs.rls).sort()).toEqual(['audit_log', 'profile']);
    expect(Object.keys(pslNs.rls).sort()).toEqual(['audit_log', 'profile']);
  });

  it('produces identical content-hash wire names and JSON-equal entities per prefix', () => {
    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    const tsNs = publicNamespace(tsContract);
    const pslNs = publicNamespace(interpreted.value);

    for (const prefix of EXPECTED_POLICY_PREFIXES) {
      const tsPolicy = tsNs.policy[prefix];
      const pslPolicy = pslNs.policy[prefix];
      expect(tsPolicy?.name).toBe(pslPolicy?.name);
      expect(tsPolicy?.name).toMatch(new RegExp(`^${prefix}_[0-9a-f]{8}$`));
      expect(JSON.parse(JSON.stringify(tsPolicy))).toEqual(JSON.parse(JSON.stringify(pslPolicy)));
    }

    // The @@map'd model's policy and enablement agree on the real table name.
    expect(tsNs.policy['audit_read']?.tableName).toBe('audit_log');
    expect(pslNs.policy['audit_read']?.tableName).toBe('audit_log');
  });

  it('single-predicate update carries no withCheck on either surface', () => {
    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(publicNamespace(tsContract).policy['profile_touch_write']?.withCheck).toBeUndefined();
    expect(
      publicNamespace(interpreted.value).policy['profile_touch_write']?.withCheck,
    ).toBeUndefined();
  });

  it('a declared role lands in __unbound__.entries.role identically from both surfaces', () => {
    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    const tsUnbound = unboundNamespace(tsContract);
    const pslUnbound = unboundNamespace(interpreted.value);

    // TS `role('app_role')` and PSL `namespace unbound { role app_role {} }`
    // land the same PostgresRole in the same slot.
    expect(Object.keys(tsUnbound.role)).toEqual(['app_role']);
    expect(Object.keys(pslUnbound.role)).toEqual(['app_role']);
    const expectedRole = {
      kind: 'role',
      name: 'app_role',
      namespaceId: '__unbound__',
      control: 'external',
    };
    expect(JSON.parse(JSON.stringify(tsUnbound.role['app_role']))).toEqual(expectedRole);
    expect(JSON.parse(JSON.stringify(pslUnbound.role['app_role']))).toEqual(expectedRole);

    // No role leaks into the model's own namespace.
    expect(Object.keys(publicNamespace(tsContract).role)).toEqual([]);
    // Referenced-but-undeclared roles stay bare names on the policies.
    expect(publicNamespace(tsContract).policy['profile_owner_read']?.roles).toEqual([
      'authenticated',
    ]);
  });
});
