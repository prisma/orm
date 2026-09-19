/**
 * `role` block authoring end-to-end in the Postgres target:
 *
 *  1. `role anon {}` declared inside `namespace unbound { … }` parses and
 *     lowers to a `PostgresRole` in the contract's `__unbound__` storage
 *     slot, entity coordinate `__unbound__` (roles are cluster-scoped in
 *     Postgres and belong to no schema).
 *  2. A `role` block anywhere else — inside a named namespace, or at the
 *     document top level — is rejected by the postgres lowering with
 *     `PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE`.
 *  3. The lowered entity round-trips through the postgres contract
 *     serializer (serialize → deserialize) without collapsing the unbound
 *     slot to `PostgresSchema.unbound`.
 */

import type { Contract } from '@internal/contract/types';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresRole } from '../src/core/postgres-role';
import { PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
      modelAttributes: postgresAuthoringModelAttributes,
    },
  },
]);

const postgresTarget = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
};

const scalarTypeDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
]);

function interpret(source: string) {
  const { document, sources } = parse(source, 'psl-role-authoring.test.psl');
  const { symbolTable, diagnostics } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  expect(diagnostics).toEqual([]);

  return interpretPslDocumentToSqlContract({
    document,
    symbolTable,
    sources,
    target: postgresTarget,
    scalarColumnDescriptors: scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    capabilities: { sql: { scalarList: true } },
  });
}

describe('`role` block authoring inside `namespace unbound`', () => {
  it('lowers into the unbound storage slot with the unbound entity coordinate', () => {
    const result = interpret(`
namespace unbound {
  role anon {
  }
}

model Profile {
  id Int @id
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const unbound = result.value.storage.namespaces[UNBOUND_NAMESPACE_ID] as PostgresSchema;
    expect(unbound).toBeInstanceOf(PostgresSchema);
    expect(unbound.role['anon']).toBeInstanceOf(PostgresRole);
    expect(unbound.role['anon']).toMatchObject({
      kind: 'role',
      name: 'anon',
      namespaceId: UNBOUND_NAMESPACE_ID,
      control: 'external',
    });
  });

  it('lowers every declared role block independently', () => {
    const result = interpret(`
namespace unbound {
  role anon {
  }

  role authenticated {
  }

  role service_role {
  }
}

model Profile {
  id Int @id
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const unbound = result.value.storage.namespaces[UNBOUND_NAMESPACE_ID] as PostgresSchema;
    expect(Object.keys(unbound.role).sort()).toEqual(['anon', 'authenticated', 'service_role']);
  });

  it('round-trips through the contract serializer without collapsing to PostgresSchema.unbound', () => {
    const result = interpret(`
namespace unbound {
  role anon {
  }
}

model Profile {
  id Int @id
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serializer = new PostgresContractSerializer();
    const interpreted = result.value as Contract<SqlStorage>;
    const json = serializer.serializeContract(interpreted);
    const deserialized = serializer.deserializeContract(json);
    const unbound = deserialized.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(unbound).not.toBe(PostgresSchema.unbound);
    expect((unbound as PostgresSchema).role['anon']).toMatchObject({
      kind: 'role',
      name: 'anon',
      namespaceId: UNBOUND_NAMESPACE_ID,
    });
  });

  it('rejects a role block declared inside a named namespace', () => {
    const result = interpret(`
namespace auth {
  model Profile {
    id Int @id
  }

  role anon {
  }
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE',
          message:
            '`role` block "anon" must be declared inside `namespace unbound { }`, not in namespace "auth"',
        }),
      ]),
    );
  });

  it('rejects a role block declared at the document top level', () => {
    const result = interpret(`
role anon {
}

model Profile {
  id Int @id
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE',
          message:
            '`role` block "anon" must be declared inside `namespace unbound { }`, not in namespace "public"',
        }),
      ]),
    );
  });
});
