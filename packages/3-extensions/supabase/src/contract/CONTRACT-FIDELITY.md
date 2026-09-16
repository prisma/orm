# Contract fidelity notes

The shipped contract (`contract.prisma` → emitted `contract.json` / `contract.d.ts`) is **generated, not hand-authored**: `pnpm contract:generate` restores the reference fixture ([`test/fixtures/supabase-reference/`](../../test/fixtures/supabase-reference/)) into a fresh PGlite database, introspects the `auth` and `storage` schemas, infers PSL per schema, assembles the `auth`/`storage` `namespace` blocks plus a `namespace unbound { }` block carrying the three `role` blocks (from `src/contract/roles.ts`'s `SupabaseRole.values`), and emits. Rerunning the generator today does not reproduce the committed file: its output inlines the hand-authored `types {}` alias block, declares 43 `@@check` constraints the committed contract omits, writes `DateTime` columns as `Timestamptz` (same codec), and prints one enum default as a literal instead of `dbgenerated(...)`; reconciling the committed contract with the generator is tracked separately. `contract.prisma` is fully self-describing — nothing is injected outside of PSL text during emit.

**Reference version:** supabase/postgres:17.6.1.106 (PostgreSQL 17.6), gotrue v2.188.1, storage-api v1.54.1, captured 2026-07-12 with supabase CLI 2.95.4. Supabase-internal schema drifts across platform upgrades; refresh by re-capturing the fixture from a newer stack and rerunning `contract:generate`.

## The safety asymmetry this file relies on

Everything the pack declares is `control: 'external'`. Under `external`, `db verify` **fails on a declared shape the live database lacks** and **tolerates everything live that the contract does not declare** (extra schemas, tables, columns, indexes, defaults). So *under-declaring is safe and wrong-declaring is not* — every entry below is an omission, never an approximation. The round-trip test (`test/reference-fixture-verify.integration.test.ts`) pins that the shipped contract verifies clean against the restored reference, with the undeclared schemas (`realtime`, `vault`, …) present.

## What the contract deliberately does not declare

The machine-readable version of the default list lives in `scripts/generate-contract.ts` (`DEFAULT_OMISSIONS`) with the full reasoning; this is the audit summary.

**Columns:** none. Every live column of every declared table is declared, including the nullable `text[]` columns `storage.buckets.allowed_mime_types` and `storage.objects.path_tokens` (`String[]?`). `path_tokens` is `GENERATED ALWAYS`, so it is declared but not user-writable.

**Column defaults (1):** `auth.users.phone`. Its live `DEFAULT NULL` on a nullable column is a no-op (the same as no default at all), but the raw-default parser round-trips it as an explicit `@default(null)`, which the interpreter rejects (`PSL_INVALID_DEFAULT_VALUE` — `null` is not a value literal). Dropping the default changes nothing observable: the column type is declared in full, it is still nullable, and it still has no enforced default. Every other live default is declared, including the `'{}'::text[]` list defaults on `auth.custom_oauth_providers` (`@default([])`) and the jsonb `dbgenerated(...)` defaults — `db verify`'s permanent-drift disagreement on those is fixed generically, at the postgres target's `SchemaIR` construction, so it needs no authoring-side omission.

**Indexes:**

- Partial (`WHERE`-predicated), expression, and unique non-constraint indexes are declared at full fidelity as exact-named (`map:`) entries — the transitional omission ended when `contract infer` gained the full index matrix (ADR 243). The reference's partial unique indexes (`auth.users` token columns, `auth.mfa_factors`, `storage.buckets_analytics`), its partial non-unique `auth.oauth_*` indexes, and its `lower(...)` expression indexes all round-trip.
- `auth.one_time_tokens`' two `USING hash` indexes are declared (`@@index(..., type: "hash")`) — the postgres target registers `hash` as a built-in index type (TML-3037).
- 17 foreign keys whose source columns have **no live FK-shaped backing index** are declared with `@relation(..., index: false)` — 16 where real Supabase does not index those FK columns at all, plus `auth.oauth_consents.client_id`, whose only live backing index is partial and therefore declared as its own exact `@@index` entry rather than satisfying the FK-derived managed expectation. (This PSL argument and the inferrer support for it shipped with this contract.)

**Generated columns** (`auth.users.confirmed_at`, `auth.identities.email`, `storage.objects.path_tokens`): declared as ordinary columns. Introspection reports them identically on the authored and live sides, so verify is clean; the contract does not record the generation expression.

## What is complete

Every `auth` (23) and `storage` (10) table of the reference version, all 10 native enum types, and the three platform roles. Schemas the pack does not own (`realtime`, `vault`, `pgsodium`, `extensions`, `graphql*`, `net`, `supabase_functions`, `_realtime`) are deliberately undeclared: they belong to Supabase subsystems and Postgres extensions this pack does not model, and under `external` control an undeclared live schema is a tolerated extra (the safety asymmetry above), so declaring them would add surface without changing what verifies.
