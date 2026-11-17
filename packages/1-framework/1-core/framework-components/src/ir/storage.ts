import { isPlainRecord } from '@internal/contract/is-plain-record';
import type { EntityCoordinate, StorageBase } from '@internal/contract/types';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { blindCast } from '@internal/utils/casts';
import type { IRNode } from './ir-node';
import type { Namespace } from './namespace';

export { isPlainRecord };

/**
 * Lazy walk over every named storage entity in a `Storage`-shaped
 * value, yielded as {@link EntityCoordinate} tuples with
 * `plane: 'storage'` (the parameter type binds the plane).
 *
 * Iterates each namespace's `entries` kind maps structurally. Skips
 * non-object `entries`; `id` and `kind` are not walked (`kind` is
 * non-enumerable on concretions). For every entity-kind key under
 * `entries` whose value is a non-null object, yields one coordinate per
 * entity name in that map. No family-specific kind vocabulary is required.
 */
export function* elementCoordinates(
  storage: Pick<StorageBase, 'namespaces'>,
): Generator<EntityCoordinate> {
  for (const [namespaceId, ns] of Object.entries(storage.namespaces)) {
    const entries = ns.entries;
    if (entries === null || typeof entries !== 'object') continue;
    for (const [entityKind, kindMap] of Object.entries(entries)) {
      if (kindMap === null || typeof kindMap !== 'object') continue;
      for (const entityName of Object.keys(kindMap)) {
        yield { plane: 'storage', namespaceId, entityKind, entityName };
      }
    }
  }
}

/**
 * Canonical, collision-safe key for an {@link EntityCoordinate}. Encodes each
 * axis individually with `JSON.stringify` before joining with `-`, so no
 * namespace id, entity kind, or entity name can forge a collision by
 * embedding the delimiter itself (e.g. a delimiter of `:` would let
 * `('a', 'b:c', 'd')` collide with `('a:b', 'c', 'd')`) — each component is
 * quoted, and any `-` or `"` inside it is escaped or safely inside those
 * quotes.
 *
 * The single shared key every coordinate-driven ownership/omission/collision
 * check should use — `contract infer`'s pack-described-element omission and
 * the migration tools' cross-space disjointness check both key on this.
 */
export function coordinateKey(
  coordinate: Pick<EntityCoordinate, 'namespaceId' | 'entityKind' | 'entityName'>,
): string {
  return [coordinate.namespaceId, coordinate.entityKind, coordinate.entityName]
    .map((value) => JSON.stringify(value))
    .join('-');
}

/**
 * The storage entities that differ between two `Storage`-shaped values: added, removed, or with
 * different content. Content is compared as JSON, ignoring key order. Sorted by namespace id,
 * entity kind and entity name. With no earlier storage, every entity counts as added.
 */
export function changedElementCoordinates(
  from: Pick<StorageBase, 'namespaces'> | null,
  to: Pick<StorageBase, 'namespaces'>,
): EntityCoordinate[] {
  const contentAt = (
    storage: Pick<StorageBase, 'namespaces'> | null,
    coordinate: EntityCoordinate,
  ): string | undefined => {
    if (storage === null) return undefined;
    const entity = entityAt(storage, coordinate);
    return entity === undefined
      ? undefined
      : canonicalStringify(JSON.parse(JSON.stringify(entity)));
  };
  const coordinates = new Map<string, EntityCoordinate>();
  for (const coordinate of [
    ...(from === null ? [] : elementCoordinates(from)),
    ...elementCoordinates(to),
  ]) {
    coordinates.set(coordinateKey(coordinate), coordinate);
  }
  return [...coordinates.values()]
    .filter((coordinate) => contentAt(from, coordinate) !== contentAt(to, coordinate))
    .sort(
      (a, b) =>
        a.namespaceId.localeCompare(b.namespaceId, 'en') ||
        a.entityKind.localeCompare(b.entityKind, 'en') ||
        a.entityName.localeCompare(b.entityName, 'en'),
    );
}

/**
 * Looks up a single entity in a `Storage`-shaped value by its full coordinate.
 * Returns `undefined` if the namespace, entity kind, or entity name is absent.
 * The type parameter is a caller assertion — the walk itself is structural
 * and cannot verify the entity's shape.
 */
export function entityAt<T = unknown>(
  storage: Pick<StorageBase, 'namespaces'>,
  coord: Pick<EntityCoordinate, 'namespaceId' | 'entityKind' | 'entityName'>,
): T | undefined {
  const ns = storage.namespaces[coord.namespaceId];
  if (ns === undefined) return undefined;
  const entries = ns.entries;
  if (!isPlainRecord(entries)) return undefined;
  const kindMap = entries[coord.entityKind];
  if (!isPlainRecord(kindMap)) return undefined;
  if (!Object.hasOwn(kindMap, coord.entityName)) return undefined;
  return blindCast<T | undefined, 'caller asserts the entity type at this coordinate'>(
    kindMap[coord.entityName],
  );
}

/**
 * Framework-level promise that every Contract IR / Schema IR carries a
 * collection of namespaces keyed by namespace id. Family storage
 * concretions (`SqlStorage`, `MongoStorage`) refine the shape with
 * family-specific fields (tables, collections, enums, …); target
 * concretions add target fields where the family vocabulary doesn't
 * reach.
 *
 * Keeping `namespaces` at the framework layer enforces that every storage
 * object — across any target — is namespace-scoped. The framework can
 * therefore walk the namespace map without knowing the family alphabet, and
 * the `(namespace.id, name)` keying that the verifier and planner depend on
 * is honest at every layer.
 *
 * Extends `IRNode` so the framework's IR-walking surfaces (verifiers,
 * serializers) can dispatch on `Storage`-typed fields through the same
 * IR-node alphabet as every other node — the structural dual already
 * holds in code (every concrete storage class extends an IR-node base);
 * the interface promotion makes the typing honest.
 *
 * **Persisted envelope shape is target-owned, not framework-promised.**
 * Whether the `namespaces` map appears in the on-disk JSON envelope is
 * a per-target decision made by `ContractSerializer.serializeContract`.
 * Some targets emit a JSON-clean namespace shape that round-trips
 * through `JSON.stringify` cleanly (SQL today via the family-layer
 * identity serializer); others ship runtime-only fields on their
 * namespace concretions and override `serializeContract` to strip
 * them (Mongo). Future open (F16): extend the per-target
 * `ContractSerializer` integration-test surface with an explicit
 * envelope-shape assertion for each target, so the strip-vs-pass-through
 * choice is locked at test time rather than implied by the override
 * presence/absence. Earned by PR2's per-target namespace lift, when
 * `PostgresSchema` / `SqliteUnboundDatabase` start carrying
 * target-specific fields.
 */
export interface Storage extends IRNode {
  readonly namespaces: Readonly<Record<string, Namespace>>;
}
