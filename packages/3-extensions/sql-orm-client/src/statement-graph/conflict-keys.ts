import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  assertInsertConflictSkipCapability,
  resolveInsertConflictColumns,
  resolvePolymorphismInfo,
  resolveUniqueKeyColumnSets,
} from '../collection-contract';
import { ormError } from '../orm-errors';

export type ConflictKeys = readonly (readonly string[])[];

export function conflictKeysOf(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  conflictColumns: readonly string[],
): ConflictKeys {
  return conflictColumns.length > 0
    ? [conflictColumns]
    : resolveUniqueKeyColumnSets(contract, namespaceId, tableName);
}

export function rowThatCannotConflict(
  rows: readonly Readonly<Record<string, unknown>>[],
  keys: ConflictKeys,
  parentLinkColumns: ReadonlySet<string>,
): number | undefined {
  const index = rows.findIndex(
    (row) =>
      !keys.some((key) =>
        key.every(
          (column) =>
            parentLinkColumns.has(column) || (row[column] !== undefined && row[column] !== null),
        ),
      ),
  );
  return index === -1 ? undefined : index;
}

export interface ConflictCall {
  readonly action: string;
  readonly modelName: string;
  readonly meta: Readonly<Record<string, unknown>>;
}

export interface ConflictOption {
  readonly onConflict: unknown;
  readonly conflictOn?: readonly string[] | undefined;
}

export interface VariantInOwnTable {
  readonly variant: string;
  readonly model: string;
}

export interface ResolvedConflict {
  readonly columns: readonly string[];
}

export function variantInOwnTableOf(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  variantValue: string | undefined,
): VariantInOwnTable | undefined {
  const variant =
    variantValue === undefined
      ? undefined
      : resolvePolymorphismInfo(contract, namespaceId, modelName)?.variants.get(variantValue);
  return variant?.strategy === 'mti' ? { variant: variant.modelName, model: modelName } : undefined;
}

export function resolveConflict(
  contract: Contract<SqlStorage>,
  call: ConflictCall,
  namespaceId: string,
  { onConflict, conflictOn }: ConflictOption,
  variantInOwnTable: VariantInOwnTable | undefined,
): ResolvedConflict {
  if (onConflict !== 'skip') {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `${call.action} takes onConflict "skip"; received ${JSON.stringify(onConflict)}`,
      { meta: { ...call.meta, problem: 'invalid-on-conflict' } },
    );
  }
  if (variantInOwnTable !== undefined) {
    throw ormError(
      'ORM.OPERATION_UNSUPPORTED',
      `The onConflict option is not supported on variant "${variantInOwnTable.variant}" of model "${variantInOwnTable.model}" because the variant is stored in its own table. Leave the option out; a duplicate row then makes the call fail.`,
      { meta: { ...call.meta, variant: variantInOwnTable.variant, reason: 'mti-variant' } },
    );
  }
  const fields = conflictOn ?? [];
  assertInsertConflictSkipCapability(contract, call.action, fields.length > 0);
  return { columns: resolveInsertConflictColumns(contract, namespaceId, call.modelName, fields) };
}

export function requireRowsThatCanConflict(
  contract: Contract<SqlStorage>,
  call: ConflictCall,
  { namespaceId, tableName }: { readonly namespaceId: string; readonly tableName: string },
  { columns }: ResolvedConflict,
  rows: readonly Readonly<Record<string, unknown>>[],
  filledColumns: (index: number) => Iterable<string>,
): void {
  const keys = conflictKeysOf(contract, namespaceId, tableName, columns);
  const index = rows.findIndex(
    (row, at) => rowThatCannotConflict([row], keys, new Set(filledColumns(at))) !== undefined,
  );
  if (index !== -1) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `${call.action} row ${index} for model "${call.modelName}" gives no value for any conflict key: ${keys.map((key) => `(${key.join(', ')})`).join(', ')}`,
      { meta: { ...call.meta, problem: 'row-cannot-conflict', index, conflictKeys: keys } },
    );
  }
}
