import type { JoinConfig } from '@better-auth/core/db/adapter';
import type { ContractRelation } from '@prisma/orm-framework/contract/types';
import type { ModelCollections } from './collections';
import type { FoundModel } from './models/model-lookup';
import type { OrmCollection, Row } from './orm';

/** A joined model served by `include`: the relation's rows move to the join description's key. */
export interface IncludedJoin {
  readonly relation: string;
  readonly key: string;
}

export interface PlannedJoins {
  readonly collection: OrmCollection;
  readonly included: readonly IncludedJoin[];
}

function sameFields(fields: readonly string[], column: string): boolean {
  return fields.length === 1 && fields[0] === column;
}

function matchingRelation(
  base: FoundModel,
  joined: FoundModel,
  on: { readonly from: string; readonly to: string },
): [string, ContractRelation] | undefined {
  return Object.entries(base.model.relations).find(
    ([, relation]) =>
      relation.to.model === joined.name &&
      relation.to.namespace === joined.namespaceId &&
      'on' in relation &&
      sameFields(relation.on.localFields, on.from) &&
      sameFields(relation.on.targetFields, on.to),
  );
}

/**
 * Adds an `include` for each joined model the base model declares a matching relation to. A join with no matching relation is left out, and Better Auth fetches its rows itself.
 */
export function planJoins(
  collection: OrmCollection,
  base: FoundModel,
  join: JoinConfig | undefined,
  collections: ModelCollections,
  debugLog: (...args: unknown[]) => void,
): PlannedJoins {
  const included: IncludedJoin[] = [];
  let planned = collection;
  for (const [key, config] of Object.entries(join ?? {})) {
    const match = matchingRelation(base, collections.model(key), config.on);
    if (match === undefined) {
      debugLog(
        `Join of "${key}" on "${base.name}" runs as separate queries: the contract declares no relation from ${base.name}.${config.on.from} to ${key}.${config.on.to}. Declare the relation to join in one query.`,
      );
      continue;
    }
    const [relation, { cardinality }] = match;
    const limit = config.limit;
    planned =
      (cardinality === '1:N' || cardinality === 'N:M') && limit !== undefined
        ? planned.include(relation, (related) => related.limit(limit))
        : planned.include(relation);
    included.push({ relation, key });
  }
  return { collection: planned, included };
}

export function moveJoinedRows(row: Row, included: readonly IncludedJoin[]): Row {
  if (included.length === 0) return row;
  const moved: Row = { ...row };
  for (const { relation } of included) delete moved[relation];
  for (const { relation, key } of included) moved[key] = row[relation];
  return moved;
}
