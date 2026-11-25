import { postgresCapabilitiesByVersion } from '@internal/target-postgres/server-version';

const { forNoKeyUpdate: _forNoKeyUpdate, ...postgres16Flags } =
  postgresCapabilitiesByVersion[16].postgres;

// No PostgreSQL feature Prisma supports needs a version above 15 today, so every row of the real table is equal. This table makes `FOR NO KEY UPDATE` arrive with 17, so a test can tell which row a route selected.
export const versionsWithALaterFeature = {
  16: { ...postgresCapabilitiesByVersion[16], postgres: postgres16Flags },
  17: postgresCapabilitiesByVersion[17],
} as const;

export const version16Capabilities = versionsWithALaterFeature[16];
export const version17Capabilities = versionsWithALaterFeature[17];
