/**
 * Static names and identifiers used across pgvector's contract space.
 *
 * Centralised here so the contract IR (`./contract`), the baseline
 * migration ops (`./migrations`), the head ref, and the descriptor
 * (`../exports/control`) all reference the same values without typos.
 *
 * The space identifier `'pgvector'` is what the framework writes to
 * `migrations/` in the user's repo and what the marker table's
 * `space` column carries for pgvector-owned rows.
 *
 * The `pgvector:*` invariantId namespace is locked here — once
 * published, an invariantId is immutable so downstream consumers can
 * reference it by literal string match.
 */

export const PGVECTOR_SPACE_ID = 'pgvector' as const;

export const PGVECTOR_EXTENSION_NAME = 'vector' as const;

export const PGVECTOR_NATIVE_TYPE = 'vector' as const;

export const PGVECTOR_BASELINE_MIGRATION_NAME = '20260601T0000_install_vector_extension' as const;

export const PGVECTOR_UPGRADE_MIGRATION_NAME = '20261029T1342_declare_vector_extension' as const;

export const PGVECTOR_INSTALL_MIGRATION_NAME = '20261029T1342_create_vector_extension' as const;

/**
 * `pgvector:*` invariantIds emitted by the baseline migration. Each id,
 * once published, is immutable: downstream consumers (other extensions,
 * the marker table) reference them by literal string match.
 */
export const PGVECTOR_INVARIANTS = {
  installVector: 'pgvector:install-vector-v1',
} as const;
