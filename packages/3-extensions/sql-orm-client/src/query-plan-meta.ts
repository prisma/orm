import type { Contract, PlanMeta } from '@internal/contract/types';
import type { AnnotationValue, OperationKind } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import { type AnyQueryAst, collectOrderedParamRefs } from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { ifDefined } from '@internal/utils/defined';
import { ormError } from './orm-errors';
import { storageTableForContract } from './storage-resolution';

export function deriveParamsFromAst(ast: AnyQueryAst): {
  params: unknown[];
} {
  return {
    params: collectOrderedParamRefs(ast).map((p) => (p.kind === 'param-ref' ? p.value : undefined)),
  };
}

export function resolveTableColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
): string[] {
  try {
    return Object.keys(storageTableForContract(contract, namespaceId, tableName).columns);
  } catch (error) {
    // Surface the ambiguous-bare-name fail-fast rather than masking it as an
    // unknown table.
    if (error instanceof Error && error.message.includes('ambiguous')) {
      throw error;
    }
    throw ormError('ORM.TABLE_UNKNOWN', `Unknown table "${tableName}" in SQL ORM query planner`, {
      meta: { namespaceId, tableName },
    });
  }
}

export function buildOrmPlanMeta(
  contract: Contract<SqlStorage>,
  annotations?: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>,
): PlanMeta {
  const annotationRecord =
    annotations !== undefined && annotations.size > 0
      ? Object.freeze(Object.fromEntries(annotations))
      : undefined;
  return {
    target: contract.target,
    targetFamily: contract.targetFamily,
    storageHash: contract.storage.storageHash,
    ...ifDefined('profileHash', contract.profileHash),
    ...ifDefined('annotations', annotationRecord),
    lane: 'orm-client',
  };
}

export function buildOrmQueryPlan<Row>(
  contract: Contract<SqlStorage>,
  ast: AnyQueryAst,
  params: readonly unknown[],
  annotations?: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>,
): SqlQueryPlan<Row> {
  return Object.freeze({
    ast,
    params: [...params],
    meta: buildOrmPlanMeta(contract, annotations),
  });
}

/**
 * Merges annotations into an existing `SqlQueryPlan`'s
 * `meta.annotations` and returns a new frozen plan.
 *
 * Used by the ORM dispatch path to attach terminal-call annotations to
 * plans produced by mutation compile functions (which don't take
 * annotations as parameters). Reads compile through `compileSelect`-
 * family functions that pass `state.annotations` directly to
 * `buildOrmQueryPlan`; this helper is the alternate path for write
 * terminals where annotations arrive at the call site, not via state.
 *
 * Returns the input plan unchanged when `annotations` is undefined
 * or empty. Reserved namespaces already on the input plan (`codecs`, target keys such as `pg`)
 * win over caller-supplied entries under the same key —
 * see the reserved-namespace policy on `defineAnnotation`.
 */
export function mergeAnnotations<Row>(
  plan: SqlQueryPlan<Row>,
  annotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined,
): SqlQueryPlan<Row> {
  if (annotations === undefined || annotations.size === 0) {
    return plan;
  }
  const callerEntries: Record<string, AnnotationValue<unknown, OperationKind>> = {};
  for (const [namespace, value] of annotations) {
    callerEntries[namespace] = value;
  }
  // Caller-supplied annotations go first so reserved keys already on the
  // existing plan (codecs, target keys such as pg) override any collision
  // under the same namespace.
  const mergedAnnotations = Object.freeze({
    ...callerEntries,
    ...(plan.meta.annotations ?? {}),
  });
  return Object.freeze({
    ...plan,
    meta: Object.freeze({
      ...plan.meta,
      annotations: mergedAnnotations,
    }),
  });
}
