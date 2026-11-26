/**
 * The statements the Prisma 8 release candidates ran to create Prisma's own tables, copied from their
 * runner's output and kept as text so a change to today's code cannot change them.
 */
export const releaseCandidatePrismaTables: readonly string[] = [
  'CREATE SCHEMA IF NOT EXISTS "prisma_contract"',
  `CREATE TABLE IF NOT EXISTS "prisma_contract"."marker" (
  "space" text DEFAULT 'app' NOT NULL PRIMARY KEY,
  "core_hash" text NOT NULL,
  "profile_hash" text NOT NULL,
  "contract_json" jsonb,
  "canonical_version" int,
  "updated_at" timestamptz DEFAULT (now()) NOT NULL,
  "app_tag" text,
  "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "invariants" text[] DEFAULT '{}'::text[] NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "prisma_contract"."ledger" (
  "id" bigserial PRIMARY KEY,
  "created_at" timestamptz DEFAULT (now()) NOT NULL,
  "space" text NOT NULL,
  "migration_name" text NOT NULL,
  "migration_hash" text NOT NULL,
  "origin_core_hash" text,
  "origin_profile_hash" text,
  "destination_core_hash" text NOT NULL,
  "destination_profile_hash" text,
  "operations" jsonb NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "prisma_contract"."contract" (
  "core_hash" text NOT NULL PRIMARY KEY,
  "created_at" timestamptz DEFAULT (now()) NOT NULL,
  "contract_json" jsonb NOT NULL
)`,
];

/** What a release candidate wrote for an application signed at `app-hash` by one migration. */
export const releaseCandidateRows: readonly string[] = [
  `INSERT INTO "prisma_contract"."marker" ("space", "core_hash", "profile_hash", "invariants")
   VALUES ('app', 'app-hash', 'app-profile', '{app:invariant}')`,
  `INSERT INTO "prisma_contract"."ledger"
     ("space", "migration_name", "migration_hash", "origin_core_hash", "destination_core_hash", "operations")
   VALUES ('app', '20261001T0000_init', 'app-migration-hash', NULL, 'app-hash', '[]'::jsonb)`,
];
