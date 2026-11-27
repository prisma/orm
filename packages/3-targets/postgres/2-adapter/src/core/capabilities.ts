/**
 * PostgreSQL's adapter declares no capabilities: every PostgreSQL flag is a fact about the database, which the target declares by version, or about the connection, which the driver declares.
 */
export const postgresAdapterCapabilities = Object.freeze({} as const);
