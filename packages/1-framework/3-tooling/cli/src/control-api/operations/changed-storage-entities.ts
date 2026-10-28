import type { Contract, EntityCoordinate } from '@internal/contract/types';
import { changedElementCoordinates, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { canonicalStringify } from '@internal/utils/canonical-stringify';

/** The coordinate of a storage entity that changed, without the internal unbound namespace id. */
export type ChangedStorageEntity = Omit<EntityCoordinate, 'namespaceId'> & {
  readonly namespaceId?: string;
};

/** The storage entities that differ between two contracts, as a result reports them. */
export function changedStorageEntities(
  fromContract: Contract | null,
  toContract: Contract,
): readonly ChangedStorageEntity[] {
  return changedElementCoordinates(fromContract?.storage ?? null, toContract.storage).map(
    withoutUnboundNamespaceId,
  );
}

/** The sentence that names what changed in storage, such as `What changed: value object "public.Home".` */
export function whatChangedSentence(fromContract: Contract | null, toContract: Contract): string {
  const changed = changedElementCoordinates(fromContract?.storage ?? null, toContract.storage);
  return changed.length === 0
    ? `No storage entity changed; what changed is ${changedStorageKeys(fromContract, toContract).join(', ') || 'outside the storage entities'}.`
    : `What changed: ${changed.map(storageEntityText).join(', ')}.`;
}

function withoutUnboundNamespaceId({
  namespaceId,
  ...rest
}: EntityCoordinate): ChangedStorageEntity {
  return namespaceId === UNBOUND_NAMESPACE_ID ? rest : { namespaceId, ...rest };
}

/** The top-level storage keys whose content differs between two contracts, such as `storage.types`, in key order. */
function changedStorageKeys(fromContract: Contract | null, toContract: Contract): string[] {
  const plain = (storage: unknown): Record<string, unknown> =>
    typeof storage === 'object' && storage !== null ? JSON.parse(JSON.stringify(storage)) : {};
  const from = plain(fromContract?.storage);
  const to = plain(toContract.storage);
  return [...new Set([...Object.keys(from), ...Object.keys(to)])]
    .filter((key) => key !== 'storageHash')
    .filter((key) => canonicalStringify(from[key]) !== canonicalStringify(to[key]))
    .sort()
    .map((key) => `storage.${key}`);
}

function storageEntityText(coordinate: EntityCoordinate): string {
  const name =
    coordinate.namespaceId === UNBOUND_NAMESPACE_ID
      ? coordinate.entityName
      : `${coordinate.namespaceId}.${coordinate.entityName}`;
  return `${kindInWords(coordinate.entityKind)} "${name}"`;
}

/** An entity kind as words, such as `value object` for `valueObject`. */
function kindInWords(entityKind: string): string {
  return entityKind.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}
