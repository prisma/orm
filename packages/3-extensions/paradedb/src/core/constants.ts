/**
 * Extension ID for ParadeDB pg_search.
 */
export const PARADEDB_EXTENSION_ID = 'paradedb' as const;

/**
 * Static names and identifiers used across paradedb's contract space.
 *
 * Centralised here so the contract IR (`./contract`), the baseline
 * migration ops (`./migrations`), the head ref, and the descriptor
 * (`../exports/control`) all reference the same values without typos.
 *
 * The space identifier `'paradedb'` is what the framework writes to
 * `migrations/` in the user's repo and what the marker table's
 * `space` column carries for paradedb-owned rows.
 *
 * The `paradedb:*` invariantId namespace is locked here — once
 * published, an invariantId is immutable so downstream consumers can
 * reference it by literal string match.
 */
export const PARADEDB_SPACE_ID = 'paradedb' as const;

export const PARADEDB_BASELINE_MIGRATION_NAME =
  '20260601T0000_install_pg_search_extension' as const;

export const PARADEDB_UPGRADE_MIGRATION_NAME = '20261029T1342_declare_pg_search_extension' as const;

export const PARADEDB_INSTALL_MIGRATION_NAME = '20261029T1342_create_pg_search_extension' as const;

/**
 * `paradedb:*` invariantIds emitted by the baseline migration. Each id,
 * once published, is immutable: downstream consumers reference them by
 * literal string match.
 */
export const PARADEDB_INVARIANTS = {
  installPgSearch: 'paradedb:install-pg-search-v1',
} as const;
