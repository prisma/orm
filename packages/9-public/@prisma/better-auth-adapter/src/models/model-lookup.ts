import type { SqlStorage } from '@prisma/orm-family-sql/contract/types';
import type { Contract, ContractModelBase } from '@prisma/orm-framework/contract/types';
import { assertModelName, upperFirst } from './identifiers';

export type SqlContract = Contract<SqlStorage>;

export interface FoundModel {
  readonly kind: 'found';
  readonly name: string;
  readonly namespaceId: string;
  readonly model: ContractModelBase;
}

export interface MissingModel {
  readonly kind: 'missing';
}

export interface AmbiguousModel {
  readonly kind: 'ambiguous';
  readonly message: string;
}

export type ModelLookup = FoundModel | MissingModel | AmbiguousModel;

/**
 * Finds the contract model for a Better Auth physical model name: the exact name first, then the name with its first letter upper-cased, in the namespace the adapter's `namespace` option names or else in every namespace.
 */
export function findModel(
  contract: SqlContract,
  physicalName: string,
  namespace: string | undefined,
): ModelLookup {
  assertModelName(physicalName);
  const namespaces = contract.domain.namespaces;
  const searched =
    namespace === undefined
      ? Object.keys(namespaces)
      : [namespace].filter((id) => Object.hasOwn(namespaces, id));
  const candidates = [...new Set([physicalName, upperFirst(physicalName)])];
  for (const name of candidates) {
    const hits = searched.filter((id) => Object.hasOwn(namespaces[id]?.models ?? {}, name)).sort();
    const [only] = hits;
    if (hits.length > 1) {
      return {
        kind: 'ambiguous',
        message: `Model "${name}" is in more than one namespace of your Prisma contract (${hits.join(', ')}). Set the adapter's "namespace" option.`,
      };
    }
    const model = only === undefined ? undefined : namespaces[only]?.models[name];
    if (only !== undefined && model !== undefined) {
      return { kind: 'found', name, namespaceId: only, model };
    }
  }
  return { kind: 'missing' };
}
