import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
/**
 * Tests for PSL `policy_select` authoring:
 *
 *  1. Parse: a `policy_select` block inside `namespace public { … }` parses without
 *     diagnostics into a policy envelope in the public namespace.
 *
 *  2. Serializer round-trip: a contract carrying a `PostgresRlsPolicy` in
 *     `entries.policy` serializes and deserializes without data loss.
 *
 *  3. Interpreter end-to-end: `interpretPslDocumentToSqlContract` on a doc with a
 *     `policy_select` block lowers it into `entries.policy` via the production
 *     factory chain (no test-side hand-lowering).
 */

import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable, createBinder, interpretExtensionBlocks } from '@internal/psl-parser';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import { type BoundPslSchema, bindPslSchema } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-registry';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresRlsPolicy } from '../src/core/postgres-rls-policy';
import { PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';
import { computeContentHash } from '../src/core/rls/canonicalize';
import { postgresDataTypeSupport } from './fixtures/postgres-data-type-support';

const postgresCodecLookup = createPostgresBuiltinCodecLookup();

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
      modelAttributes: postgresAuthoringModelAttributes,
    },
  },
]);

function blockResolutionBinder(
  symbolTable: Parameters<typeof interpretExtensionBlocks>[0]['symbolTable'],
  sources: Parameters<typeof interpretExtensionBlocks>[0]['sources'],
) {
  return createBinder({
    sources,
    symbolTable,
    context: {
      authoringContributions: {
        ...assembleAuthoringContributions([]),
        pslBlockDescriptors: assembled.pslBlockDescriptors,
      },
      controlMutationDefaults: { defaultFunctionRegistry: new Map() },
      generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
      dataTypes: postgresDataTypeSupport,
    },
  }).binder;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PSL policy_select parse', () => {
  const source = `
namespace public {
  model profile {
    id       Int @id
    owner_id Int

    @@rls
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = sql\`owner_id = current_setting('app.uid')::int\`
  }
}
`;

  function buildInput() {
    const { document, sources } = parse(source, 'psl-policy-authoring.test.psl');
    const { symbolTable, diagnostics } = buildSymbolTable({
      documents: [document],
      sources,
      defaultNamespaceId: 'public',
    });
    const { parsedBlocks } = interpretExtensionBlocks({
      symbolTable,
      sources,
      pslBlockDescriptors: assembled.pslBlockDescriptors,
      binder: blockResolutionBinder(symbolTable, sources),
      dataTypes: postgresDataTypeSupport,
    });
    return { document, sources, symbolTable, diagnostics, parsedBlocks };
  }

  it('parses the policy_select block without diagnostics', () => {
    const { diagnostics } = buildInput();
    expect(diagnostics).toEqual([]);
  });

  it('places the parsed block in the public namespace with a policy envelope', () => {
    const { symbolTable, parsedBlocks } = buildInput();
    const publicNs = symbolTable.namespaces['public'];
    expect(publicNs).toBeDefined();
    const blocks = Object.values(publicNs!.blocks);
    expect(blocks).toHaveLength(1);
    expect(parsedBlocks.get(blocks[0]!)).toMatchObject({ kind: 'policy', name: 'p_read' });
  });
});

describe('interpretPslDocumentToSqlContract policy_select → entries.policy', () => {
  const source = `
namespace public {
  model profile {
    id       Int @id
    owner_id Int

    @@rls
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = sql\`owner_id = current_setting('app.uid')::int\`
  }
}
`;

  const postgresTarget = {
    kind: 'target' as const,
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    id: 'postgres',
    version: '0.0.1',
    capabilities: {},
    defaultNamespaceId: 'public',
  };

  const scalarColumnDescriptors = new Map<string, { codecId: string }>([
    ['String', { codecId: 'pg/text@1' }],
    ['Int', { codecId: 'pg/int4@1' }],
    ['Boolean', { codecId: 'pg/bool@1' }],
    ['BigInt', { codecId: 'pg/int8@1' }],
    ['Float', { codecId: 'pg/float8@1' }],
    ['Decimal', { codecId: 'pg/numeric@1' }],
    ['DateTime', { codecId: 'pg/timestamptz-temporal@1' }],
    ['Json', { codecId: 'pg/json@1' }],
    ['Jsonb', { codecId: 'pg/jsonb@1' }],
    ['Bytes', { codecId: 'pg/bytea@1' }],
  ]);

  const scalarTypeConstructors: Record<string, AuthoringTypeConstructorDescriptor> =
    Object.fromEntries(
      [...scalarColumnDescriptors].map(([name, output]) => [
        name,
        { kind: 'typeConstructor' as const, output },
      ]),
    );

  function contextFor(): BoundPslSchema['context'] {
    return {
      composedExtensions: [],
      defaultNamespaceId: 'public',
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        type: { ...scalarTypeConstructors, ...assembled.type },
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: postgresCodecLookup,
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
      dataTypes: postgresDataTypeSupport,
      resolvedInputs: [],
      capabilities: { sql: { scalarList: true } },
    };
  }

  function interpret(text: string) {
    const bound = bindPslSchema(text, {
      sourceId: 'psl-policy-authoring.test.psl',
      context: contextFor(),
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

  it('reads the escapes of a double-quoted sql literal as a string does, and keeps any other backslash sequence as written', () => {
    const result = interpret(
      source.replace(
        `using  = sql\`owner_id = current_setting('app.uid')::int\``,
        String.raw`using  = sql"a\tb\u0041 \"q\" \\ \/ \d"`,
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(Object.values(ns.policy).map((policy) => policy.using)).toEqual(['a\tbA "q" \\ / \\d']);
  });

  it('lowers a policy_select block to entries.policy without test-side hand-lowering', () => {
    const { document, sources } = parse(source, 'psl-policy-authoring.test.psl');
    const { diagnostics } = buildSymbolTable({
      documents: [document],
      sources,
      defaultNamespaceId: 'public',
    });

    expect(diagnostics).toEqual([]);

    const bound = bindPslSchema(source, {
      sourceId: 'psl-policy-authoring.test.psl',
      context: contextFor(),
    });
    const result = withSeedDiagnostics(
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

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns).toBeInstanceOf(PostgresSchema);
    expect(Object.keys(ns.policy)).toHaveLength(1);

    const [policyKey] = Object.keys(ns.policy);
    const policy = ns.policy[policyKey!]!;
    expect(policy).toBeInstanceOf(PostgresRlsPolicy);
    expect(policy.operation).toBe('select');
    expect(policy.permissive).toBe(true);
    expect(policy.namespaceId).toBe('public');
    expect(policy.tableName).toBe('profile');
    expect(policy.roles).toEqual(['app_user']);
    expect(policy.using).toBe("owner_id = current_setting('app.uid')::int");
    expect(policy.prefix).toBe('p_read');
    expect(policy.name).toMatch(/^p_read_[0-9a-f]{8}$/);
  });
});

describe('PostgresContractSerializer policy round-trip', () => {
  function makeContractWithPolicy() {
    const predicate = "owner_id = current_setting('app.uid')::int";
    const roles = ['app_user'];
    const wireHash = computeContentHash({
      using: predicate,
      roles,
      operation: 'select',
      permissive: true,
    });
    const wireName = `p_read_${wireHash}`;

    const base = createSqlContract({
      storage: {
        namespaces: {
          public: {
            id: 'public',
            entries: {
              table: {
                profile: {
                  columns: {
                    id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                    owner_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
    });

    return {
      ...base,
      storage: {
        ...base.storage,
        namespaces: {
          public: {
            ...base.storage.namespaces['public']!,
            entries: {
              ...base.storage.namespaces['public']!.entries,
              policy: {
                [wireName]: {
                  kind: 'policy',
                  name: wireName,
                  prefix: 'p_read',
                  tableName: 'profile',
                  namespaceId: 'public',
                  operation: 'select',
                  permissive: true,
                  roles,
                  using: predicate,
                },
              },
            },
          },
        },
      },
    };
  }

  it('preserves the policy entry through serialize → deserialize', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeContractWithPolicy();

    const contract = serializer.deserializeContract(input);
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json)) as typeof json;
    const roundTripped = serializer.deserializeContract(reparsed);

    const ns = roundTripped.storage.namespaces['public'] as PostgresSchema;
    expect(ns).toBeInstanceOf(PostgresSchema);
    expect(Object.keys(ns.policy)).toHaveLength(1);

    const [policyKey] = Object.keys(ns.policy);
    const policy = ns.policy[policyKey!]!;
    expect(policy).toBeInstanceOf(PostgresRlsPolicy);
    expect(policy.operation).toBe('select');
    expect(policy.permissive).toBe(true);
    expect(policy.namespaceId).toBe('public');
    expect(policy.tableName).toBe('profile');
    expect(policy.roles).toEqual(['app_user']);
    expect(policy.using).toBe("owner_id = current_setting('app.uid')::int");
    expect(policy.prefix).toBe('p_read');
    expect(Object.isFrozen(policy)).toBe(true);
  });
});
