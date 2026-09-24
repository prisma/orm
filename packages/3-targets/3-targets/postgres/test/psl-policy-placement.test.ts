/**
 * Placement regression for policies whose selected target lives in a
 * different physical namespace than the block's lexical owner: the policy
 * row files at the selected coordinate, the lexical namespace materializes
 * no policy bucket, and schema projection attaches the policy to the
 * selected table. The infer → print → reparse round trip of this fixture is
 * printer-side work and lives with the inference round-trip suites.
 */

import { createDataTypeLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { printPsl } from '@internal/psl-printer';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { contractToPostgresDatabaseSchemaNode } from '../src/core/migrations/contract-to-postgres-database-schema-node';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresRlsPolicy } from '../src/core/postgres-rls-policy';
import type { PostgresContract } from '../src/core/postgres-schema';
import { type PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';
import { inferPostgresPslContract } from '../src/core/psl-infer/infer-psl-contract';
import { postgresRenderDefault } from '../src/exports/control';

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

const scalarColumnDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
]);

function interpret(source: string) {
  const { document, sources } = parse(source, 'psl-policy-placement.test.psl');
  const { symbolTable, diagnostics } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  expect(diagnostics).toEqual([]);
  return interpretPslDocumentToSqlContract({
    dataTypeLookup: postgresDataTypeLookup,
    documents: [document],
    symbolTable,
    sources,
    target: postgresTarget,
    scalarColumnDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    capabilities: { sql: { scalarList: true } },
  });
}

const FALLBACK_SCHEMA = `
namespace audit {
  policy_update inherited_write {
    target = Widget
    roles = [app_user]
    using = "id > 0"
    @@map("adopted_write")
  }
}

model Widget {
  id Int @id

  @@map("root_widgets")
  @@rls
}
`;

const CONTROL_SCHEMA = `
namespace public {
  policy_update inherited_write {
    target = Widget
    roles = [app_user]
    using = "id > 0"
    @@map("adopted_write")
  }

  model Widget {
    id Int @id

    @@map("root_widgets")
    @@rls
  }
}
`;

describe('policy placement at the selected target coordinate', () => {
  it('files the forward top-level fallback policy under public with the selected coordinate', () => {
    const result = interpret(FALLBACK_SCHEMA);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const publicNs = result.value.storage.namespaces['public'] as PostgresSchema;
    const policy = publicNs.policy['inherited_write'];
    expect(policy).toBeInstanceOf(PostgresRlsPolicy);
    expect(policy).toMatchObject({
      name: 'adopted_write',
      tableName: 'root_widgets',
      namespaceId: 'public',
      operation: 'update',
      roles: ['app_user'],
      using: 'id > 0',
      permissive: true,
    });
    expect(policy?.withCheck).toBeUndefined();
  });

  it('materializes no audit bucket at all for the relocated-only lexical namespace', () => {
    const result = interpret(FALLBACK_SCHEMA);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.storage.namespaces)).toEqual(['public']);
    expect(result.value.storage.namespaces['audit']).toBeUndefined();
  });

  it('serializes identically to the same policy and model authored together in namespace public', () => {
    const fallback = interpret(FALLBACK_SCHEMA);
    const control = interpret(CONTROL_SCHEMA);

    expect(fallback.ok).toBe(true);
    expect(control.ok).toBe(true);
    if (!fallback.ok || !control.ok) return;
    const serializer = new PostgresContractSerializer();
    const fallbackJson = JSON.parse(
      JSON.stringify(serializer.serializeContract(fallback.value as PostgresContract)),
    ) as { storage: unknown };
    const controlJson = JSON.parse(
      JSON.stringify(serializer.serializeContract(control.value as PostgresContract)),
    ) as { storage: unknown };
    expect(fallbackJson.storage).toEqual(controlJson.storage);
  });

  it('prefers a local same-named model: both the coordinate and the destination move', () => {
    const result = interpret(`
namespace audit {
  model Widget {
    id Int @id

    @@map("audit_widgets")
    @@rls
  }

  policy_update local_write {
    target = Widget
    using = "id > 0"
  }
}

model Widget {
  id Int @id

  @@map("root_widgets")
  @@rls
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const auditNs = result.value.storage.namespaces['audit'] as PostgresSchema;
    expect(auditNs.policy['local_write']).toMatchObject({
      tableName: 'audit_widgets',
      namespaceId: 'audit',
    });
    const publicNs = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(Object.keys(publicNs.policy)).toEqual([]);
  });

  it('rejects two lexically distinct policies converging on one destination key', () => {
    const result = interpret(`
namespace audit {
  policy_select converged {
    target = Widget
    using = "true"
  }
}

namespace billing {
  policy_select converged {
    target = Widget
    using = "true"
  }
}

model Widget {
  id Int @id

  @@rls
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_DUPLICATE_EXTENSION_ENTITY',
          message: expect.stringContaining('"public"'),
        }),
      ]),
    );
  });

  it('projects the relocated policy as a child of public.root_widgets with RLS enabled', () => {
    const result = interpret(FALLBACK_SCHEMA);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = contractToPostgresDatabaseSchemaNode(result.value as PostgresContract, {
      annotationNamespace: 'pg',
      renderDefault: postgresRenderDefault,
    });
    expect(Object.keys(root.namespaces)).toEqual(['public']);
    const table = root.namespaces['public']?.tables['root_widgets'];
    expect(table).toBeDefined();
    expect(table?.rlsEnabled).toBe(true);
    expect(table?.policies.map((policy) => policy.name)).toEqual(['adopted_write']);
    expect(table?.policies[0]).toMatchObject({ operation: 'update', using: 'id > 0' });
  });
});

const PROJECTION_OPTIONS = {
  annotationNamespace: 'pg',
  renderDefault: postgresRenderDefault,
} as const;

function projectPolicyTable(contract: PostgresContract, tableName: string) {
  const root = contractToPostgresDatabaseSchemaNode(contract, PROJECTION_OPTIONS);
  const table = root.namespaces['public']?.tables[tableName];
  if (table === undefined) throw new Error(`expected table "${tableName}" in namespace public`);
  return table;
}

function roundTrip(source: string, tableName: string) {
  const first = interpret(source);
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error('expected the authored schema to interpret');
  const firstTable = projectPolicyTable(first.value as PostgresContract, tableName);

  const inferred = inferPostgresPslContract(
    contractToPostgresDatabaseSchemaNode(first.value as PostgresContract, PROJECTION_OPTIONS),
  );
  const printed = printPsl(inferred, { pslBlockDescriptors: assembled.pslBlockDescriptors });

  const second = interpret(printed);
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error(`inferred output did not reinterpret:\n${printed}`);
  const secondTable = projectPolicyTable(second.value as PostgresContract, tableName);
  return { firstTable, secondTable, printed };
}

function policyShape(table: ReturnType<typeof projectPolicyTable>) {
  return table.policies.map((policy) => ({
    name: policy.name,
    operation: policy.operation,
    roles: policy.roles,
    using: policy.using,
    withCheck: policy.withCheck,
    permissive: policy.permissive,
  }));
}

describe('inference round-trips through the real typed pipeline', () => {
  it('round-trips the relocated fallback policy to the same projected physical shape', () => {
    const { firstTable, secondTable, printed } = roundTrip(FALLBACK_SCHEMA, 'root_widgets');

    expect(printed).toContain('namespace public');
    expect(printed).toContain('@@map("adopted_write")');
    expect(printed).not.toContain('withCheck');
    expect(secondTable.rlsEnabled).toBe(true);
    expect(policyShape(secondTable)).toEqual(policyShape(firstTable));
    expect(policyShape(secondTable)).toEqual([
      expect.objectContaining({
        name: 'adopted_write',
        operation: 'update',
        roles: ['app_user'],
        using: 'id > 0',
        withCheck: undefined,
        permissive: true,
      }),
    ]);
  });

  it('round-trips a no-USING SELECT policy with the predicate still absent', () => {
    const { firstTable, secondTable, printed } = roundTrip(
      `
namespace public {
  model Profile {
    id Int @id

    @@map("profiles")
    @@rls
  }

  policy_select p_read {
    target = Profile
    roles  = [app_user]
    @@map("read_profiles")
  }
}
`,
      'profiles',
    );

    expect(printed).not.toContain('using');
    expect(policyShape(secondTable)).toEqual(policyShape(firstTable));
    expect(secondTable.policies[0]).toMatchObject({ operation: 'select' });
    expect(secondTable.policies[0]?.using).toBeUndefined();
    expect(secondTable.policies[0]?.withCheck).toBeUndefined();
  });

  it('round-trips a no-predicate UPDATE policy with both predicates absent', () => {
    const { firstTable, secondTable, printed } = roundTrip(
      `
namespace public {
  model Profile {
    id Int @id

    @@map("profiles")
    @@rls
  }

  policy_update p_write {
    target = Profile
    roles  = [app_user]
    @@map("write_profiles")
  }
}
`,
      'profiles',
    );

    expect(printed).not.toContain('using');
    expect(printed).not.toContain('withCheck');
    expect(policyShape(secondTable)).toEqual(policyShape(firstTable));
    expect(secondTable.policies[0]).toMatchObject({ operation: 'update' });
    expect(secondTable.policies[0]?.using).toBeUndefined();
    expect(secondTable.policies[0]?.withCheck).toBeUndefined();
  });

  it('round-trips a restrictive policy with an escaped predicate byte-identically', () => {
    const { firstTable, secondTable, printed } = roundTrip(
      `
namespace public {
  model Profile {
    id Int @id

    @@map("profiles")
    @@rls
  }

  policy_select p_read {
    target     = Profile
    using      = "name = \\"O'Hara\\"\\nnext"
    permissive = false
    @@map("strict_read")
  }
}
`,
      'profiles',
    );

    expect(printed).toContain('permissive = false');
    expect(policyShape(secondTable)).toEqual(policyShape(firstTable));
    expect(secondTable.policies[0]).toMatchObject({
      permissive: false,
      using: 'name = "O\'Hara"\nnext',
    });
  });
});
