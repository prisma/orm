import type { SqlStorage } from '@prisma/orm-family-sql/contract/types';
import type { Contract, ContractModelBase } from '@prisma/orm-framework/contract/types';
import { upperFirst } from './identifiers';

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
  readonly name: string;
  readonly namespaceIds: readonly string[];
}

export type ModelLookup = FoundModel | MissingModel | AmbiguousModel;

export function missingModelMessage(physicalName: string): string {
  return `Model "${physicalName}" is not in your Prisma contract. Run \`npx auth@latest generate\` to see what to add.`;
}

export function ambiguousModelMessage(name: string, namespaceIds: readonly string[]): string {
  return `Model "${name}" is in more than one namespace of your Prisma contract (${namespaceIds.join(', ')}). Set the adapter's "namespace" option.`;
}

/** The contract model names a Better Auth physical model name is looked up by, in order: the exact name, then the name with its first letter upper-cased. */
export function modelNameCandidates(physicalName: string): readonly string[] {
  return [...new Set([physicalName, upperFirst(physicalName)])];
}

/** Whether the adapter looks for Better Auth's models in a namespace: every namespace without the adapter's `namespace` option, else only the one it names. */
export function isSearchedNamespace(namespaceId: string, namespace: string | undefined): boolean {
  return namespace === undefined || namespaceId === namespace;
}

/**
 * Finds the contract model for a Better Auth physical model name: the exact name first, then the name with its first letter upper-cased, in the namespace the adapter's `namespace` option names or else in every namespace. The physical model name is matched to a contract model name, never to a table name.
 */
export function findModel(
  contract: SqlContract,
  physicalName: string,
  namespace: string | undefined,
): ModelLookup {
  const namespaces = contract.domain.namespaces;
  const searched = Object.keys(namespaces).filter((id) => isSearchedNamespace(id, namespace));
  for (const name of modelNameCandidates(physicalName)) {
    const hits = searched.filter((id) => Object.hasOwn(namespaces[id]?.models ?? {}, name)).sort();
    const [only] = hits;
    if (hits.length > 1) return { kind: 'ambiguous', name, namespaceIds: hits };
    const model = only === undefined ? undefined : namespaces[only]?.models[name];
    if (only !== undefined && model !== undefined) {
      return { kind: 'found', name, namespaceId: only, model };
    }
  }
  return { kind: 'missing' };
}
