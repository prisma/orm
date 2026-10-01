import { ContractValidationError } from '@internal/contract/contract-validation-error';
import type { Contract } from '@internal/contract/types';
import { type } from 'arktype';
import { contractError } from './contract-errors';
import type { IndexTypeEntry, IndexTypeRegistry } from './index-types';
import type { SqlStorage } from './types';

/**
 * The traits of the codec registered under an id, or `undefined` when the lookup does not know the
 * codec. An index type's column traits are checked only for codecs the lookup knows.
 */
export type CodecTraitsLookup = (codecId: string) => readonly string[] | undefined;

export function validateIndexTypes(
  contract: Contract<SqlStorage>,
  indexTypeRegistry: IndexTypeRegistry,
  codecTraits?: CodecTraitsLookup,
): void {
  for (const [namespaceId, ns] of Object.entries(contract.storage.namespaces)) {
    for (const [tableName, table] of Object.entries(ns.entries.table ?? {})) {
      for (const index of table.indexes) {
        if (index.type === undefined) continue;
        const entry = indexTypeRegistry.get(index.type);
        if (entry === undefined) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" index "${index.name}" uses unregistered index type "${index.type}"`,
            'storage',
          );
        }
        const optionsValue = index.options ?? {};
        const result = entry.options(optionsValue);
        if (result instanceof type.errors) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" index "${index.name}" has invalid options for type "${index.type}": ${result.summary}`,
            'storage',
          );
        }
        if (codecTraits !== undefined) {
          assertColumnTraits(entry, index, table.columns, codecTraits);
        }
      }
    }
  }
}

function assertColumnTraits(
  entry: IndexTypeEntry,
  index: { readonly name: string; readonly columns?: readonly string[] | undefined },
  columns: Readonly<Record<string, { readonly codecId: string }>>,
  codecTraits: CodecTraitsLookup,
): void {
  const required = entry.columnTraits ?? [];
  if (required.length === 0) return;
  for (const column of index.columns ?? []) {
    const codecId = columns[column]?.codecId;
    if (codecId === undefined) continue;
    const traits = codecTraits(codecId);
    if (traits === undefined) continue;
    const missing = required.filter((trait) => !traits.includes(trait));
    if (missing.length === 0) continue;
    throw contractError(
      'CONTRACT.INDEX_INVALID',
      `Index "${index.name}" of type "${entry.type}" covers the column "${column}", stored as \`${codecId}\`, which lacks the trait ${missing.map((trait) => `"${trait}"`).join(', ')} the type requires.`,
      {
        why: `An index of type "${entry.type}" can only cover columns whose codec carries ${required.map((trait) => `"${trait}"`).join(', ')}.`,
        fix: 'Index a column of a type this index type supports, or use another index type.',
        meta: { indexType: entry.type, index: index.name, column, codecId, missingTraits: missing },
      },
    );
  }
}
