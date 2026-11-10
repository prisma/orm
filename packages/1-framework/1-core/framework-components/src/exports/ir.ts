export type {
  DefaultNamespaceEntries,
  NamespacedEntities,
  SingleNamespaceView,
} from '../ir/contract-view';
export {
  buildNamespacedEntities,
  buildSingleNamespaceView,
  promoteBuiltinKinds,
} from '../ir/contract-view';
export { domainElementCoordinates } from '../ir/domain';
export type { AnyEntityKindDescriptor, EntityKindDescriptor } from '../ir/entity-kind';
export { hydrateNamespaceEntities } from '../ir/entity-kind';
export type { IRNode } from '../ir/ir-node';
export { freezeNode, IRNodeBase } from '../ir/ir-node';
export type { Namespace } from '../ir/namespace';
export { NamespaceBase, UNBOUND_NAMESPACE_ID } from '../ir/namespace';
export type { Storage } from '../ir/storage';
export {
  changedElementCoordinates,
  coordinateKey,
  elementCoordinates,
  entityAt,
  isPlainRecord,
} from '../ir/storage';
export type { StorageType } from '../ir/storage-type';
