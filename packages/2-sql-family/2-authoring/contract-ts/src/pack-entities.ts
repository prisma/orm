import type {
  AuthoringEntityTypeDescriptor,
  AuthoringEntityTypeNamespace,
} from '@internal/framework-components/authoring';
import { isAuthoringEntityTypeDescriptor } from '@internal/framework-components/authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { tableEntityKind, valueSetEntityKind } from '@internal/sql-contract/entity-kinds';
import type { StorageValueSetInput } from '@internal/sql-contract/types';
import { deriveValueSetFromEntity } from '@internal/sql-contract/value-set-derivation-hook';
import type { ContractDefinition } from './contract-definition';
import { contractError } from './contract-errors';

export type CollectedColumnEntities = Record<string, Record<string, Record<string, unknown>>>;

/**
 * Records a deferred column's entity-ref into the namespace-scoped collection
 * accumulator (`namespaceId → entityKind → entityName`) — folded into the same
 * namespace assembly `deriveEntityValueSets`/`entries.<kind>` step as the
 * entities-channel attachments, so a column-collected entity gets its
 * value-set the same way an entities-channel one does.
 *
 * The same handle reused by many columns in one namespace is normal (a native
 * enum type backs any number of columns) and records the identical entity once.
 * Two *different* entity instances sharing a name+kind in one namespace is a
 * name collision — the emitted `entries.valueSet.<name>` could only reflect one
 * of them, silently mismatching the other column's type/cast. PSL hard-errors
 * on the equivalent (`PSL_DUPLICATE_DECLARATION`); the TS path rejects it too.
 */
export function collectEntityFromColumn(
  collected: CollectedColumnEntities,
  namespaceId: string,
  entityRef: NonNullable<ColumnTypeDescriptor['entityRef']>,
): void {
  const forNs = collected[namespaceId] ?? {};
  const forKind = forNs[entityRef.entityKind] ?? {};
  const existing = forKind[entityRef.entityName];
  if (existing !== undefined && existing !== entityRef.entity) {
    throw contractError(
      'CONTRACT.NAME_DUPLICATE',
      `buildSqlContractFromDefinition: two different "${entityRef.entityKind}" entities named "${entityRef.entityName}" in namespace "${namespaceId}" — pack-entity names must be unique per namespace.`,
      { meta: { kind: entityRef.entityKind, name: entityRef.entityName, namespaceId } },
    );
  }
  forKind[entityRef.entityName] = entityRef.entity;
  forNs[entityRef.entityKind] = forKind;
  collected[namespaceId] = forNs;
}

/**
 * Merges a namespace's entities-channel attachments (lowered from the
 * `entities` handle list, carried on `ContractDefinition.attachedEntities`)
 * with the entities collected from that namespace's deferred entity-ref
 * columns. A column-collected entity that shadows a *different* attached
 * entity of the same kind+name (or vice-versa) is the same name-collision bug
 * `collectEntityFromColumn` guards against across columns, so it is rejected
 * the same way — by entity identity, so the same handle attached and used by
 * a column does not throw.
 */
export function mergeColumnAndAttachedEntities(
  namespaceId: string,
  attached: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
  columnCollected: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined {
  if (attached === undefined) return columnCollected;
  if (columnCollected === undefined) return attached;
  const kinds = new Set([...Object.keys(attached), ...Object.keys(columnCollected)]);
  const result: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const kind of kinds) {
    const attachedForKind = attached[kind];
    const columnForKind = columnCollected[kind];
    for (const [name, entity] of Object.entries(columnForKind ?? {})) {
      const existing = attachedForKind?.[name];
      if (existing !== undefined && existing !== entity) {
        throw contractError(
          'CONTRACT.NAME_DUPLICATE',
          `buildSqlContractFromDefinition: two different "${kind}" entities named "${name}" in namespace "${namespaceId}" — a column-referenced entity conflicts with an attached one; pack-entity names must be unique per namespace.`,
          { meta: { kind, name, namespaceId } },
        );
      }
    }
    result[kind] = { ...attachedForKind, ...columnForKind };
  }
  return result;
}

/**
 * Entry kinds the framework assembler itself manages (`table` from models,
 * `valueSet` from `enums` and attached-entity value-set derivation). A
 * pack-attached entity claiming one of these would silently clobber or be
 * clobbered by the managed slot, so it is rejected outright.
 */
const MANAGED_ENTRY_KINDS = new Set([tableEntityKind.kind, valueSetEntityKind.kind]);

export function assertNoManagedEntityKinds(
  namespaceId: string,
  entitiesForNs: Readonly<Record<string, unknown>> | undefined,
): void {
  if (entitiesForNs === undefined) return;
  for (const kind of Object.keys(entitiesForNs)) {
    if (MANAGED_ENTRY_KINDS.has(kind)) {
      throw contractError(
        'CONTRACT.ENTITY_KIND_INVALID',
        `buildSqlContractFromDefinition: attached entity in namespace "${namespaceId}" declares entry kind "${kind}", which is managed by the framework (table/valueSet) and cannot be attached.`,
        { meta: { entityKind: kind, namespaceId } },
      );
    }
  }
}

/**
 * Walks the flat `entityTypes` namespace tree contributed by the target pack
 * and every extension pack, indexing descriptors by their `discriminator` —
 * the same string a pack entity's entries-map key (`entries.<kind>`) uses.
 * Mirrors `contract-psl`'s `buildEntityTypesByDiscriminator`, recomposed here
 * from the packs `ContractDefinition` already carries (`target` +
 * `extensions`) since the TS assembler has no single pre-merged
 * `AuthoringContributions` input to read the way the PSL interpreter does.
 */
export function collectEntityTypeDescriptorsByDiscriminator(
  definition: ContractDefinition,
): ReadonlyMap<string, AuthoringEntityTypeDescriptor> {
  const result = new Map<string, AuthoringEntityTypeDescriptor>();
  const walk = (namespace: AuthoringEntityTypeNamespace): void => {
    for (const value of Object.values(namespace)) {
      if (isAuthoringEntityTypeDescriptor(value)) {
        result.set(value.discriminator, value);
      } else {
        walk(value);
      }
    }
  };
  const components = [definition.target, ...Object.values(definition.extensions ?? {})];
  for (const component of components) {
    const entityTypes = component.authoring?.entityTypes;
    if (entityTypes !== undefined) {
      walk(entityTypes);
    }
  }
  return result;
}

/**
 * Derives value-sets for every pack entity declared in one namespace,
 * reusing the same `SqlValueSetDerivingEntityTypeOutput.deriveValueSet` hook
 * `contract-psl`'s `lowerExtensionBlocksForNamespace` folds into
 * `entries.valueSet` on the PSL path — so a TS-attached entity (e.g. a
 * native enum) gets its value-set the same way. Entity kinds with no
 * registered descriptor, or whose descriptor output doesn't derive a
 * value-set, contribute nothing.
 */
export function deriveEntityValueSets(
  entitiesForNs: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
  entityTypesByDiscriminator: ReadonlyMap<string, AuthoringEntityTypeDescriptor>,
): Record<string, StorageValueSetInput> | undefined {
  if (entitiesForNs === undefined) return undefined;
  let result: Record<string, StorageValueSetInput> | undefined;
  for (const [kind, entitiesByName] of Object.entries(entitiesForNs)) {
    const descriptor = entityTypesByDiscriminator.get(kind);
    if (descriptor === undefined) continue;
    for (const [name, entity] of Object.entries(entitiesByName)) {
      const derivedValueSet = deriveValueSetFromEntity(descriptor.output, entity);
      if (derivedValueSet === undefined) continue;
      result ??= {};
      result[name] = derivedValueSet;
    }
  }
  return result;
}

/**
 * Merges a namespace's `enumType()`-derived value-sets with its pack-entity-
 * derived value-sets. Both land in the same `entries.valueSet[name]` slot —
 * which drives value-set → codec typing and the domain-enum CHECK — so a
 * same-named entry in both would let one silently overwrite the other and
 * corrupt whichever column resolves against it. The same collision class the
 * `mergeColumnAndAttachedEntities` guard rejects; the PSL path already hard-errors
 * on the equivalent (`interpretPslDocumentToSqlContract`). Reject it here too.
 */
export function mergeNamespaceValueSets(
  namespaceId: string,
  enumValueSets: Record<string, StorageValueSetInput> | undefined,
  packValueSets: Record<string, StorageValueSetInput> | undefined,
): Record<string, StorageValueSetInput> {
  if (enumValueSets !== undefined && packValueSets !== undefined) {
    for (const name of Object.keys(packValueSets)) {
      if (Object.hasOwn(enumValueSets, name)) {
        throw contractError(
          'CONTRACT.NAME_DUPLICATE',
          `buildSqlContractFromDefinition: value-set "${name}" in namespace "${namespaceId}" is derived from both an enum and a pack entity — names must be unique per namespace.`,
          { meta: { kind: 'valueSet', name, namespaceId } },
        );
      }
    }
  }
  return { ...enumValueSets, ...packValueSets };
}
