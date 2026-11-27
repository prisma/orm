const newestPostgresVersion = 18 as const;

/** The PostgreSQL versions Prisma 8 supports, oldest first. */
const postgresVersions = [15, 16, 17, newestPostgresVersion] as const;

/** A PostgreSQL version Prisma 8 supports. */
export type PostgresVersion = (typeof postgresVersions)[number];

/** The oldest PostgreSQL version Prisma 8 supports. */
export const POSTGRES_MIN_SERVER_VERSION = `${postgresVersions[0]}` as const;

/** The newest PostgreSQL version Prisma 8 supports. */
export const POSTGRES_NEWEST_VERSION = newestPostgresVersion;
