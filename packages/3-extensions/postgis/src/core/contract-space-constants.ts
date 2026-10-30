/**
 * Static names and identifiers used across postgis's contract space.
 *
 * Centralised here so the contract IR (`./contract`), the baseline
 * migration ops (`./migrations`), the head ref, and the descriptor
 * (`../exports/control`) all reference the same values without typos.
 *
 * The space identifier `'postgis'` is what the framework writes to
 * `migrations/` in the user's repo and what the marker table's
 * `space` column carries for postgis-owned rows.
 *
 * The `postgis:*` invariantId namespace is locked here — once
 * published, an invariantId is immutable so downstream consumers can
 * reference it by literal string match.
 */

export const POSTGIS_SPACE_ID = 'postgis' as const;

export const POSTGIS_EXTENSION_NAME = 'postgis' as const;

export const POSTGIS_NATIVE_TYPE = 'geometry' as const;

export const POSTGIS_BASELINE_MIGRATION_NAME = '20260601T0000_install_postgis_extension' as const;

export const POSTGIS_UPGRADE_MIGRATION_NAME = '20261029T1342_declare_postgis_extension' as const;

export const POSTGIS_INSTALL_MIGRATION_NAME = '20261029T1342_create_postgis_extension' as const;

/**
 * `postgis:*` invariantIds emitted by the baseline migration. Each id,
 * once published, is immutable: downstream consumers (other extensions,
 * the marker table) reference them by literal string match.
 */
export const POSTGIS_INVARIANTS = {
  installPostgis: 'postgis:install-postgis-v1',
} as const;
