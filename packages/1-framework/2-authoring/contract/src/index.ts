export type { CapabilityMatrix } from './capability-registry';
export { mergeCapabilityMatrices } from './capability-registry';
export type {
  AuthoringNamespaceKey,
  EntityHelperFactoryOptions,
  EntityHelperFunction,
  EntityHelpersFromNamespace,
  ExtractAuthoringNamespaceFromPack,
  MergeExtensionAuthoringNamespaces,
  UnionToIntersection,
} from './composed-helpers-scaffolding';
export { createEntityHelpersFromNamespace } from './composed-helpers-scaffolding';
export type { ForeignKeyDefaultsState, IndexDef } from './descriptors';
export type {
  BoundEnumType,
  CodecInput,
  CodecTypeMap,
  EnumMember,
  EnumTypeHandle,
} from './enum-type';
export {
  bindEnumType,
  ENUM_TYPE_HANDLE_BRAND,
  enumType,
  isEnumTypeHandle,
  member,
} from './enum-type';
export type {
  LocalFieldNullabilityLookup,
  ToOneRelationNullability,
  ToOneRelationNullabilityContradiction,
} from './relation-nullability';
export {
  resolveToOneRelationNullable,
  withDerivedToOneRelationNullability,
} from './relation-nullability';
