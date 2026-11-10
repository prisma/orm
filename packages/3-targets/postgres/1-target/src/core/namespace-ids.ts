// Leaf module: authoring.ts and descriptor-meta.ts both need this and import each other.
/** Postgres's default schema; `postgresTargetDescriptorMeta.defaultNamespaceId` is this value. */
export const DEFAULT_NAMESPACE_ID = 'public' as const;
