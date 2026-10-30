import type { Contract } from '@internal/contract/types';
import type { TypeLookups } from '@internal/framework-components/codec';
import type {
  MigrationOperationPolicy,
  ModelCoordinate,
  OpFactoryCall,
  ResolvedMigrationStatement,
  ValueObjectFieldCoordinate,
} from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import { planEnumValueRewrites, type StoredValueRewrite } from './enum-value-planning';
import type { SchemaTables } from './schema-tables';
import {
  type StoredValueCallClasses,
  type StoredValueSubject,
  storedValueOperationIndexes,
  storedValueSubjects,
} from './stored-value-calls';
import type { SqlPlannerConflict } from './types';
import {
  planValueObjectFieldFills,
  type StoredKeyFill,
  unnamedFieldFillOf,
} from './value-object-field-fills';
import { planValueObjectFieldRewrites, type StoredKeyRewrite } from './value-object-field-planning';
import { planVariantRowRewrites, type VariantRowRewrite } from './variant-planning';

/** A rewrite of stored data a plan makes: a key of value object JSON, a key filled, a stored value, or the rows of a variant. */
export type StoredRewrite =
  | StoredKeyRewrite
  | StoredKeyFill
  | StoredValueRewrite
  | VariantRowRewrite;

/** How a target builds the calls that carry out each kind of stored rewrite, each call with the rewrite it carries out. */
export interface StoredRewriteCalls<TCall extends OpFactoryCall, TRemoval extends TCall> {
  storedKeyCalls(rewrites: readonly StoredKeyRewrite[]): ReadonlyMap<TCall, StoredKeyRewrite>;
  storedKeyFillCalls(fills: readonly StoredKeyFill[]): ReadonlyMap<TCall, StoredKeyFill>;
  storedValueCalls(rewrites: readonly StoredValueRewrite[]): ReadonlyMap<TCall, StoredValueRewrite>;
  variantRowCalls(rewrites: readonly VariantRowRewrite[]): ReadonlyMap<TCall, VariantRowRewrite>;
  readonly storedValueClasses: StoredValueCallClasses<TRemoval>;
}

/** The calls of a plan's stored rewrites, with what the planner reports of them. */
export interface PlannedStoredRewrites<TCall extends OpFactoryCall> {
  /** Key renames and removals first, then fills, stored values and variant rows, as the plan runs them. */
  readonly calls: readonly TCall[];
  /** The positions, among the plan's operations, of the operations that carry out `statement`. */
  operationIndexes(
    planCalls: readonly OpFactoryCall[],
    statement: ResolvedMigrationStatement,
  ): readonly number[];
  readonly storedValues: ReadonlyMap<OpFactoryCall, StoredValueSubject>;
  readonly storedKeys: ReadonlyMap<OpFactoryCall, ValueObjectFieldCoordinate>;
  readonly variantRows: ReadonlyMap<OpFactoryCall, ModelCoordinate>;
  /** The variants of the origin the destination no longer has. */
  readonly removedVariants: readonly ModelCoordinate[];
}

/**
 * The stored rewrites of a plan, as the target's calls: the key rewrites and fills of value object
 * fields, the stored value rewrites of enum values, and the row rewrites of variants. The first
 * kind a plan refuses is the plan's failure.
 */
export function planStoredRewrites<TCall extends OpFactoryCall, TRemoval extends TCall>(input: {
  readonly statements: readonly ResolvedMigrationStatement[];
  readonly fromContract: Contract<SqlStorage> | null;
  readonly contract: Contract<SqlStorage>;
  readonly tables: SchemaTables;
  readonly types: TypeLookups;
  readonly policy: MigrationOperationPolicy;
  readonly calls: StoredRewriteCalls<TCall, TRemoval>;
}): Result<PlannedStoredRewrites<TCall>, SqlPlannerConflict> {
  const { statements, fromContract, contract, tables, types } = input;
  const keyRewrites = planValueObjectFieldRewrites({ statements, fromContract, contract, tables });
  if (!keyRewrites.ok) return notOk(keyRewrites.failure);
  const fills = planValueObjectFieldFills({
    statements,
    fromContract,
    contract,
    tables,
    types,
    unnamed: unnamedFieldFillOf(input.policy),
  });
  if (!fills.ok) return notOk(fills.failure);
  const valueRewrites = planEnumValueRewrites({
    statements,
    fromContract,
    contract,
    tables,
    codecs: types.codecLookup,
  });
  if (!valueRewrites.ok) return notOk(valueRewrites.failure);
  const variantRewrites = planVariantRowRewrites({ statements, fromContract, contract, tables });
  if (!variantRewrites.ok) return notOk(variantRewrites.failure);

  const storedKeyCalls = input.calls.storedKeyCalls(keyRewrites.value);
  const storedKeyFillCalls = input.calls.storedKeyFillCalls(fills.value);
  const storedValueCalls = input.calls.storedValueCalls(valueRewrites.value);
  const variantRowCalls = input.calls.variantRowCalls(variantRewrites.value);
  const rewrites = new Map<OpFactoryCall, StoredRewrite>([
    ...storedKeyCalls,
    ...storedKeyFillCalls,
    ...storedValueCalls,
    ...variantRowCalls,
  ]);
  return ok({
    calls: [
      ...storedKeyCalls.keys(),
      ...storedKeyFillCalls.keys(),
      ...storedValueCalls.keys(),
      ...variantRowCalls.keys(),
    ],
    operationIndexes: (planCalls, statement) =>
      storedValueOperationIndexes(planCalls, rewrites, statement),
    storedValues: storedValueSubjects(storedValueCalls, input.calls.storedValueClasses),
    storedKeys: new Map(
      [...storedKeyCalls, ...storedKeyFillCalls].map(([call, change]) => [
        call,
        change.valueObjectField,
      ]),
    ),
    variantRows: new Map([...variantRowCalls].map(([call, rewrite]) => [call, rewrite.model])),
    removedVariants: variantRewrites.value.flatMap(({ model, removed }) =>
      removed ? [model] : [],
    ),
  });
}
