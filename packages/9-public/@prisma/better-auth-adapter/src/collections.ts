import { BetterAuthError } from '@better-auth/core/error';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@prisma/orm-framework/contract/default-namespace';
import { type FoundModel, findModel, type SqlContract } from './models/model-lookup';
import { isOrmCollection, type OrmCollection, property } from './orm';

export interface ModelLookups {
  /** The contract model for a Better Auth physical model name; raises a `BetterAuthError` when there is none or more than one. */
  model(physicalName: string): FoundModel;
  collection(orm: object, model: FoundModel): OrmCollection;
}

function missingModelError(name: string): BetterAuthError {
  return new BetterAuthError(
    `Model "${name}" is not in your Prisma contract. Run \`npx auth@latest generate\` to see what to add.`,
  );
}

/** Finds models as decisions on lookup describe, once per name, for one adapter instance. */
export function createModelLookups(
  contract: SqlContract,
  namespace: string | undefined,
): ModelLookups {
  const found = new Map<string, FoundModel>();
  const namespaceIds = Object.keys(contract.domain.namespaces);
  const flat = namespaceIds.length === 1 && namespaceIds[0] === UNBOUND_DOMAIN_NAMESPACE_ID;
  return {
    model(physicalName) {
      const known = found.get(physicalName);
      if (known !== undefined) return known;
      const lookup = findModel(contract, physicalName, namespace);
      if (lookup.kind === 'ambiguous') throw new BetterAuthError(lookup.message);
      if (lookup.kind === 'missing') throw missingModelError(physicalName);
      found.set(physicalName, lookup);
      return lookup;
    },
    collection(orm, model) {
      const facet = flat ? orm : property(orm, model.namespaceId);
      const collection = property(facet, model.name);
      if (!isOrmCollection(collection)) throw missingModelError(model.name);
      return collection;
    },
  };
}
