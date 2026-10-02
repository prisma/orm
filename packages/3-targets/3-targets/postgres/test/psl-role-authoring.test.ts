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
import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { buildSymbolTable } from '@internal/psl-parser';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import { bindPslSchema } from '@internal/psl-parser/test';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresRole } from '../src/core/postgres-role';
import { PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

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

const scalarTypeConstructors = Object.fromEntries(
  [...scalarTypeDescriptors].map(([name, output]) => [
    name,
    { kind: 'typeConstructor' as const, output },
  ]),
);

function interpret(source: string) {
  const { document, sources } = parse(source, 'psl-role-authoring.test.psl');
  const { diagnostics } = buildSymbolTable({
    documents: [document],
    sources,
  });
  expect(diagnostics).toEqual([]);

  const bound = bindPslSchema(source, {
    sourceId: 'psl-role-authoring.test.psl',
    context: {
      composedExtensions: [],
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        type: { ...scalarTypeConstructors, ...assembled.type },
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: { ...emptyCodecLookup, descriptorFor: () => undefined },
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      dataTypes: { entries: assembled.dataTypes, lookup: postgresDataTypeLookup },
      resolvedInputs: [],
      capabilities: { sql: { scalarList: true } },
    },
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresTarget,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
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
