import type { ContractModelBase } from '@internal/contract/types';

export type StoredModel = Pick<ContractModelBase, 'storage' | 'base' | 'owner'>;

/**
 * The root models of each collection, keyed by collection name: every model stored in the collection that is neither a variant nor embedded, sorted by name.
 */
export function collectionRootModelsOf(
  models: Record<string, StoredModel>,
): Record<string, readonly string[]> {
  const roots: Record<string, string[]> = {};
  for (const [name, model] of Object.entries(models)) {
    const collection = model.storage['collection'];
    if (typeof collection !== 'string' || model.base !== undefined || model.owner !== undefined) {
      continue;
    }
    roots[collection] = [...(roots[collection] ?? []), name];
  }
  for (const names of Object.values(roots)) names.sort();
  return roots;
}
