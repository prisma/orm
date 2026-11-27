import { POSTGRES_NEWEST_VERSION } from '@internal/target-postgres/server-version-range';

/** The lists `init` writes into a new project, by the names this package exports them under: the newest PostgreSQL version's and the driver's. A contract that lists no required capabilities requires these. */
export const defaultRequiredCapabilityLists = [
  `postgres${POSTGRES_NEWEST_VERSION}`,
  'postgresDriver',
] as const;
