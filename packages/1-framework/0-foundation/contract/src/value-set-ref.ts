import type { EntityCoordinate } from './entity-coordinate';

/**
 * Entity coordinate for a domain enum or storage value-set reference.
 *
 * Every `valueSet` reference stays in its plane: a domain field refers to a domain enum, and a storage column or check to a storage value set.
 *
 * `namespaceId` admits the `UNBOUND_NAMESPACE_ID` (`__unbound__`) sentinel for single-namespace (unbound) references.
 *
 * `spaceId` is the cross-space discriminator: absent ⇒ local (same contract-space); present ⇒ cross-space. No separate tag field.
 */
export interface ValueSetRef extends EntityCoordinate<'domain' | 'storage', 'enum' | 'valueSet'> {
  readonly spaceId?: string;
}
