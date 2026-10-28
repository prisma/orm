/**
 * Canonical address for a named entity in a contract plane.
 *
 * `plane` is the top-level contract plane the entity lives on. `entityKind` equals the key of the slot the entity lives under (`'valueSet'` for `entries.valueSet`, `'valueObject'` for `entries.valueObject`, `'enum'` for the domain's `enum` slot), with no translation between the two (ADR 224). `entityName` is the entity's key in that slot.
 *
 * References between planes obey a directional invariant: domain may refer to storage; storage may never refer to domain. The coordinate carries the plane a validator checks.
 *
 * The type parameters narrow the plane and the kind for a reference to one kind of entity, such as a field's value object (`EntityCoordinate<'storage', 'valueObject'>`).
 */
export interface EntityCoordinate<
  TPlane extends 'domain' | 'storage' = 'domain' | 'storage',
  TKind extends string = string,
> {
  readonly plane: TPlane;
  readonly namespaceId: string;
  readonly entityKind: TKind;
  readonly entityName: string;
}
