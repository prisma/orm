import { BetterAuthError } from '@better-auth/core/error';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@prisma/orm-framework/contract/default-namespace';
import { assertModelName } from './models/identifiers';
import {
  ambiguousModelMessage,
  type FoundModel,
  findModel,
  missingModelMessage,
  type SqlContract,
} from './models/model-lookup';
import { isOrmCollection, type OrmCollection, property } from './orm';

export interface ModelCollections {
  /** The contract model for a Better Auth physical model name; raises a `BetterAuthError` when the name is not an identifier, or when no model or more than one has it. */
  model(physicalName: string): FoundModel;
  /** The model's collection on an ORM client root: the client's, or a transaction's. */
  collection(orm: object, model: FoundModel): OrmCollection;
}

/** Finds each model once per adapter instance, and its collection on the ORM client root a call uses. */
export function createModelCollections(
  contract: SqlContract,
  namespace: string | undefined,
): ModelCollections {
  const found = new Map<string, FoundModel>();
  const namespaceIds = Object.keys(contract.domain.namespaces);
  const flat = namespaceIds.length === 1 && namespaceIds[0] === UNBOUND_DOMAIN_NAMESPACE_ID;
  return {
    model(physicalName) {
      const known = found.get(physicalName);
      if (known !== undefined) return known;
      assertModelName(physicalName);
      const lookup = findModel(contract, physicalName, namespace);
      if (lookup.kind === 'ambiguous') {
        throw new BetterAuthError(ambiguousModelMessage(lookup.name, lookup.namespaceIds));
      }
      if (lookup.kind === 'missing') throw new BetterAuthError(missingModelMessage(physicalName));
      found.set(physicalName, lookup);
      return lookup;
    },
    collection(orm, model) {
      const facet = flat ? orm : property(orm, model.namespaceId);
      const collection = property(facet, model.name);
      if (!isOrmCollection(collection)) {
        throw new BetterAuthError(missingModelMessage(model.name));
      }
      return collection;
    },
  };
}
