/**
 * The key of the advisory lock that the migration runner and `db sign` hold while they read and write markers. The marker table holds every space's marker, so there is one key for it, whatever the space or the contract's namespaces.
 */
export const MARKER_LOCK_KEY = 'prisma_8.contract.marker';

/** Takes the transaction-scoped advisory lock named by {@link MARKER_LOCK_KEY}. */
export const MARKER_LOCK_SQL = 'select pg_advisory_xact_lock(hashtext($1))';
