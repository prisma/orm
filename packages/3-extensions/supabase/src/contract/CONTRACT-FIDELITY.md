# Contract fidelity notes

The shipped contract (`contract.prisma` → emitted `contract.json` / `contract.d.ts`) is **generated, not hand-authored**: `pnpm contract:generate` restores the reference fixture ([`test/fixtures/supabase-reference/`](../../test/fixtures/supabase-reference/)) into a fresh PGlite database, introspects the `auth` and `storage` schemas, infers PSL per schema, assembles the `auth`/`storage` `namespace` blocks plus a `namespace unbound { }` block carrying the three `role` blocks (from `src/contract/roles.ts`'s `SupabaseRole.values`), and emits. Rerunning against the same fixture is byte-identical. `contract.prisma` is fully self-describing — nothing is injected outside of PSL text during emit.

**Reference version:** supabase/postgres:17.6.1.106 (PostgreSQL 17.6), gotrue v2.188.1, storage-api v1.54.1, captured 2026-07-12 with supabase CLI 2.95.4. Supabase-internal schema drifts across platform upgrades; refresh by re-capturing the fixture from a newer stack and rerunning `contract:generate`.

## The safety asymmetry this file relies on

Everything the pack declares is `control: 'external'`. Under `external`, `db verify` **fails on a declared shape the live database lacks** and **tolerates everything live that the contract does not declare** (extra schemas, tables, columns, indexes, defaults). So *under-declaring is safe and wrong-declaring is not* — every entry below is an omission, never an approximation. The round-trip test (`test/reference-fixture-verify.integration.test.ts`) pins that the shipped contract verifies clean against the restored reference, with the undeclared schemas (`realtime`, `vault`, …) present.

## What the contract deliberately does not declare

Machine-readable versions of these lists live in `scripts/generate-contract.ts` (`COLUMN_OMISSIONS` / `DEFAULT_OMISSIONS`), each with the full reasoning; this is the audit summary.

**Columns (2):**

| Column | Live type | Why |
| --- | --- | --- |
| `storage.buckets.allowed_mime_types` | `text[]` nullable | Now authorable as `String[]?`; lifting the omission means regenerating and re-verifying this contract, tracked separately |
| `storage.objects.path_tokens` | `text[]` nullable | Same; also `GENERATED ALWAYS`, so not user-writable regardless |

**Column defaults (3):** `auth.users.phone` (`DEFAULT NULL` is a no-op, but round-trips through the raw-default parser as an explicit `@default(null)`, which the interpreter rejects); `auth.custom_oauth_providers.acceptable_client_ids` and `.scopes` (both `text[]` with `DEFAULT '{}'::text[]`, printed as `@default(dbgenerated("'{}'::text[]"))` — the interpreter rejects any function-kind default on a list field, and a `dbgenerated(...)` default is always function-kind at authoring time). Column type is declared in full for all three; only the `@default` is dropped. The jsonb `dbgenerated(...)` defaults that used to widen this list (TML-3037) are declared again — `db verify`'s permanent-drift disagreement is fixed generically, at the postgres target's `SchemaIR` construction, so it needs no authoring-side omission.

**Indexes:**

- Partial (`WHERE`-predicated), expression, and unique non-constraint indexes are declared at full fidelity as exact-named (`map:`) entries — the transitional omission ended when `contract infer` gained the full index matrix (ADR 243). The reference's partial unique indexes (`auth.users` token columns, `auth.mfa_factors`, `storage.buckets_analytics`), its partial non-unique `auth.oauth_*` indexes, and its `lower(...)` expression indexes all round-trip.
- `auth.one_time_tokens`' two `USING hash` indexes are declared (`@@index(..., type: "hash")`) — the postgres target registers `hash` as a built-in index type (TML-3037).
- 17 foreign keys whose source columns have **no live FK-shaped backing index** are declared with `@relation(..., index: false)` — 16 where real Supabase does not index those FK columns at all, plus `auth.oauth_consents.client_id`, whose only live backing index is partial and therefore declared as its own exact `@@index` entry rather than satisfying the FK-derived managed expectation. (This PSL argument and the inferrer support for it shipped with this contract.)

**Generated columns** (`auth.users.confirmed_at`, `auth.identities.email`): declared as ordinary columns. Introspection reports them identically on the authored and live sides, so verify is clean; the contract does not record the generation expression.

## What is complete

Every `auth` (23) and `storage` (10) table of the reference version, all 10 native enum types, and the three platform roles. Schemas the pack does not own (`realtime`, `vault`, `pgsodium`, `extensions`, `graphql*`, `net`, `supabase_functions`, `_realtime`) are deliberately undeclared: they belong to Supabase subsystems and Postgres extensions this pack does not model, and under `external` control an undeclared live schema is a tolerated extra (the safety asymmetry above), so declaring them would add surface without changing what verifies.
