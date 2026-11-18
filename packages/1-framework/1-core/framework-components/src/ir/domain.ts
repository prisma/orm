import type { ApplicationDomain, EntityCoordinate } from '@internal/contract/types';

/**
 * Lazy walk over every named domain entity in a {@link ApplicationDomain},
 * yielded as {@link EntityCoordinate} tuples with `plane: 'domain'`.
 *
 * Same structural rules as {@link elementCoordinates} over storage: skip
 * scalar `id`; each other object-valued property is an entity-kind slot.
 */
export function* domainElementCoordinates(
  domain: Pick<ApplicationDomain, 'namespaces'>,
): Generator<EntityCoordinate> {
  for (const [namespaceId, ns] of Object.entries(domain.namespaces)) {
    for (const [entityKind, slot] of Object.entries(ns)) {
      if (entityKind === 'id') continue;
      if (slot === null || typeof slot !== 'object') continue;
      for (const entityName of Object.keys(slot)) {
        yield { plane: 'domain', namespaceId, entityKind, entityName };
      }
    }
  }
}
