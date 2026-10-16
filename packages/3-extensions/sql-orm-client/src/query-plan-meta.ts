import type { Contract, PlanMeta } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { type AnyQueryAst, collectOrderedParamRefs } from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { ifDefined } from '@internal/utils/defined';

export function deriveParamsFromAst(ast: AnyQueryAst): {
  params: unknown[];
} {
  return {
    params: collectOrderedParamRefs(ast).map((p) => (p.kind === 'param-ref' ? p.value : undefined)),
  };
}

export function buildOrmPlanMeta(contract: Contract<SqlStorage>): PlanMeta {
  return {
    target: contract.target,
    targetFamily: contract.targetFamily,
    storageHash: contract.storage.storageHash,
    ...ifDefined('profileHash', contract.profileHash),
    lane: 'orm-client',
  };
}

export function buildOrmQueryPlan<Row>(
  contract: Contract<SqlStorage>,
  ast: AnyQueryAst,
  params: readonly unknown[],
): SqlQueryPlan<Row> {
  return Object.freeze({
    ast,
    params: [...params],
    meta: buildOrmPlanMeta(contract),
  });
}
