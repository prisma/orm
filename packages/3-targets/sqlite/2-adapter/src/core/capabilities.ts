export const sqliteAdapterCapabilities = Object.freeze({
  sql: {
    orderBy: true,
    limit: true,
    lateral: false,
    jsonAgg: true,
    outerReferencesInDerivedTables: true,
    jsonAggWithoutTruncation: true,
    returning: true,
    foreignKeys: true,
    enums: false,
    insertOnConflictSkip: true,
    insertOnConflictWithoutTarget: true,
    insertOnConflictTarget: true,
  },
} as const);
