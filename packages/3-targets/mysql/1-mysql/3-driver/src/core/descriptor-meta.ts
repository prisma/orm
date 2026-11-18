/** The descriptor meta of the MySQL driver built for `targetId`: MySQL's, or a target's that extends MySQL. */
export function mysqlDriverDescriptorMetaFor<TargetId extends string>(targetId: TargetId) {
  return {
    kind: 'driver',
    familyId: 'sql',
    targetId,
    id: targetId,
    version: '0.0.1',
    capabilities: {},
  } as const;
}

export const mysqlDriverDescriptorMeta = mysqlDriverDescriptorMetaFor('mysql');
