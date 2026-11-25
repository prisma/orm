export {
  type CapabilitiesByVersion,
  POSTGRES_MIN_SERVER_VERSION,
  POSTGRES_NEWEST_VERSION,
  type PostgresVersion,
  postgresCapabilitiesByVersion,
  postgresCapabilitiesForVersion,
  postgresCapabilitiesForVersionIn,
} from '../core/server-version';
export { readPostgresServerVersionNumber } from '../core/server-version-number';
