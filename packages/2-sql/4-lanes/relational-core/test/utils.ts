import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { createSqlOperationRegistry } from '@internal/sql-operations';
import type { Adapter, LoweredStatement, SelectAst } from '../src/exports/ast';
import type { ExecutionContext } from '../src/exports/query-lane-context';

/**
 * Creates a stub adapter for testing. This helper DRYs up the common pattern of adapter creation in tests.
 */
export function createStubAdapter(): Adapter<SelectAst, Contract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      readMarker: async () => ({ kind: 'absent' as const }),
    },
    lower(ast: SelectAst, ctx: { contract: Contract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      const params = (ctx.params ?? []).map((value) => ({ kind: 'literal' as const, value }));
      return Object.freeze({ sql: sqlText, params });
    },
  };
}

/**
 * Creates an ExecutionContext for testing. This helper DRYs up the common pattern of context creation in tests. Note: This creates an ExecutionContext, so it doesn't include an adapter.
 *
 * @param contract - The SQL contract
 */
export function createTestContext<TContract extends Contract<SqlStorage>>(
  contract: TContract,
): ExecutionContext<TContract> {
  return {
    contract,
    contractCodecs: {
      forColumn: () => undefined,
      forCodecRef: () => {
        throw new Error('relational-core test ContractCodecRegistry stub: forCodecRef not stubbed');
      },
    },
    codecDescriptors: {
      descriptorFor: () => undefined,
      codecRefForColumn: () => undefined,
      values: function* () {},
    },
    aggregateDescriptors: {
      resolve: () => undefined,
      values: function* () {},
    },
    queryOperations: createSqlOperationRegistry(),
    types: {},
    applyMutationDefaults: () => [],
  };
}
