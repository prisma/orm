import { computeStorageHash } from '@internal/contract/hashing';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type {
  ContractSpace,
  ControlFamilyDescriptor,
  ControlStack,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import type { PslDocumentAst, PslModel, PslSpan } from '@internal/framework-components/psl-ast';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@internal/framework-components/psl-ast';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { SqlStorage } from '@internal/sql-contract/types';
import { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { createSqlFamilyInstance } from '../src/core/control-instance';
import type {
  SqlDescribedContractSpace,
  SqlPslBuildContext,
} from '../src/core/control-target-descriptor';
import type { SqlControlExtensionDescriptor } from '../src/core/migrations/types';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;
const SYNTHETIC_SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

/**
 * Stand-in for a `PostgresDatabaseSchemaNode` tree — the family instance only
 * requires an `SqlSchemaIRNode`, and this test's stub target hook is the one
 * reading `appTables` off it, so a full Postgres tree is unnecessary here.
 */
class TestSchemaTree extends SqlSchemaIRNode {
  override readonly nodeKind = 'sql-schema';

  constructor(readonly appTables: readonly string[]) {
    super();
  }
}

function isTableDescribed(
  describedContracts: readonly SqlDescribedContractSpace[],
  schemaName: string,
  tableName: string,
): boolean {
  return describedContracts.some(({ contract }) =>
    Object.values(contract.storage.namespaces).some(
      (ns) =>
        ns.id === schemaName && ns.entries.table && Object.hasOwn(ns.entries.table, tableName),
    ),
  );
}

function stubModel(name: string): PslModel {
  return { kind: 'model', name, fields: [], attributes: [], span: SYNTHETIC_SPAN };
}

/**
 * The stub target hook under test: it proves the family instance forwards
 * the stack's extension-pack contracts as `describedContracts` — not that
 * this stub reimplements Postgres inference.
 */
function stubInferPslContract(
  schema: SqlSchemaIRNode,
  _context: SqlPslBuildContext,
  describedContracts?: readonly SqlDescribedContractSpace[],
): PslDocumentAst {
  const tree = schema instanceof TestSchemaTree ? schema : new TestSchemaTree([]);
  const contracts = describedContracts ?? [];
  const survivingTables = tree.appTables.filter(
    (tableName) => !isTableDescribed(contracts, 'public', tableName),
  );
  return {
    kind: 'document',
    sourceId: '<test>',
    namespaces: [
      makePslNamespace({
        kind: 'namespace',
        name: UNSPECIFIED_PSL_NAMESPACE_ID,
        entries: makePslNamespaceEntries(survivingTables.map(stubModel), [], []),
        span: SYNTHETIC_SPAN,
      }),
    ],
    span: SYNTHETIC_SPAN,
  };
}

function buildExtensionWithPublicTable(
  id: string,
  tableName: string,
): SqlControlExtensionDescriptor<'postgres'> {
  const table = { columns: {}, uniques: [], indexes: [], foreignKeys: [] };
  const namespace = createTestSqlNamespace({
    id: 'public',
    entries: { table: { [tableName]: table } },
  });

  const hash = computeStorageHash({
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    storage: {
      namespaces: { public: { id: 'public', entries: { table: { [tableName]: table } } } },
    },
    ...sqlContractCanonicalizationHooks,
  });

  const contract: Contract<SqlStorage> = {
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
    profileHash: profileHash('fixture-profile-v1'),
    storage: new SqlStorage({ storageHash: coreHash(hash), namespaces: { public: namespace } }),
  };

  return {
    kind: 'extension' as const,
    id,
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    version: '0.0.1',
    contractSpace: {
      contractJson: contract,
      migrations: [],
      headRef: { hash, invariants: [] },
    } satisfies ContractSpace<Contract<SqlStorage>>,
    create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
  };
}

function makeStack(
  extensions: readonly SqlControlExtensionDescriptor<'postgres'>[],
): ControlStack<'sql', 'postgres'> {
  return createControlStack({
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      create: (() => ({})) as unknown as ControlFamilyDescriptor<'sql'>['create'],
      emission: {
        id: 'sql',
        generateStorageType: () => '{ readonly storageHash: StorageHash }',
        generateModelStorageType: () => 'Record<string, never>',
        getFamilyImports: () => [],
        getFamilyTypeAliases: () => '',
        getTypeMapsExpression: () => 'unknown',
        getContractWrapper: (base: string) => `export type Contract = ${base};`,
      },
    },
    target: {
      kind: 'target',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      contractSerializer: {
        deserializeContract: (json) => json as never,
        serializeContract: (contract) => contract as never,
      },
      inferPslContract: stubInferPslContract,
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    } as ControlTargetDescriptor<'sql', 'postgres'>,
    adapter: {
      kind: 'adapter',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    extensions: extensions,
  });
}

function modelNames(ast: PslDocumentAst): readonly string[] {
  return ast.namespaces.flatMap((ns) => Object.keys(ns.entries['model'] ?? {}));
}

describe('SqlFamilyInstance#inferPslContract — describedContracts threading', () => {
  it('threads the stack extension packs’ contracts into the target hook, omitting a pack-described table', () => {
    const pack = buildExtensionWithPublicTable('supabase', 'auth_users');
    const familyInstance = createSqlFamilyInstance(makeStack([pack]));
    const tree = new TestSchemaTree(['app_table', 'auth_users']);

    const ast = familyInstance.inferPslContract(tree);

    expect(modelNames(ast)).toEqual(['app_table']);
  });

  it('keeps every table when no extension pack describes it', () => {
    const familyInstance = createSqlFamilyInstance(makeStack([]));
    const tree = new TestSchemaTree(['app_table']);

    const ast = familyInstance.inferPslContract(tree);

    expect(modelNames(ast)).toEqual(['app_table']);
  });
});
