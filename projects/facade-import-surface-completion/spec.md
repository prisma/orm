# Summary

Close the gaps that force users of `@internal/postgres`, `@internal/mongo`, and `@internal/sqlite` to reach into internal `@internal/target-*`, `@internal/family-*`, `@internal/sql-*`, or `@internal/cli/*` packages. After this project, a user installs one façade package per target and writes every import as `@internal/<target>/<subpath>`.

# Purpose

Make `@internal/<target>/<subpath>` the complete user-facing import surface for the three shipping targets, so the agent-skill cluster can teach one canonical import shape per workflow and the example apps can serve as canonical worked examples without internal-package leakage.

# At a glance

Today, a SQLite app's `prisma-next.config.ts` reads like this (verbose form, 7 imports across 6 internal packages):

```ts
import sqliteAdapter from '@internal/adapter-sqlite/control';
import { defineConfig } from '@internal/cli/config-types';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import sqlite from '@internal/target-sqlite/control';

export default defineConfig({ family: sql, target: sqlite, driver: sqliteDriver, adapter: sqliteAdapter, contract: typescriptContract(contract, 'src/prisma/contract.json'), db: { connection: '...' } });
```

After this project:

```ts
import { defineConfig } from '@internal/sqlite/config';

export default defineConfig({
  contract: './src/contract.prisma',
  db: { connection: process.env['SQLITE_PATH'] ?? './demo.db' },
});
```

The same shape works for Postgres today via `@internal/postgres/config`. After this project, Mongo and SQLite reach parity with it; framework-rendered `migration.ts` files import from `@internal/{postgres,sqlite}/migration`; and a control-side script can compose `createMongoControlClient` / `createSqliteControlClient` without pulling runtime dependencies, parallel to `createPostgresControlClient`.

# Scope

## In scope

Three target façades brought to parity across `/config`, `/contract-builder`, `/control`, `/migration`, `/runtime` (and `/serverless` for Postgres only, which already ships):

- **`@internal/postgres`** — add `/migration` re-export of `@internal/target-postgres/migration`. Update the Postgres renderer (`packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts`) so newly-rendered `migration.ts` files import from `@internal/postgres/migration`.
- **`@internal/mongo`** — bring `MongoConfigOptions` to parity with `PostgresConfigOptions` (`extensions`, `migrations.dir`). Add `/control` exporting `createMongoControlClient` (parallel to `createPostgresControlClient`). Drop the `"."` barrel from the `exports` map for subpath-only parity with Postgres.
- **`@internal/sqlite`** — add `/config` (`defineConfig`, `SqliteConfigOptions` with `contract`, `db.connection`, `extensions`, `migrations.dir`), `/contract-builder` (re-export of `@internal/sql-contract-ts/contract-builder`), `/control` (`createSqliteControlClient`), `/migration` (re-export of `@internal/target-sqlite/migration`). Update the SQLite renderer to import from `@internal/sqlite/migration`.

Cleanups that close the loop:

- All 13 `prisma-next.config.ts` files in `examples/` migrate to the façade form. Each becomes a canonical worked example.
- [`skills/prisma-next-migrations/SKILL.md`](../../skills/prisma-next-migrations/SKILL.md) §"`migration.ts` is framework-rendered, not hand-authored" updates from "the framework currently emits `@internal/target-postgres/migration`; TML-2526 will close that gap" to "the framework emits `@internal/{postgres,sqlite}/migration`; never edit the import line."
- `architecture.config.json` gains entries for the new façade subpaths (sqlite `/config`, `/contract-builder`, `/control`, `/migration`; postgres `/migration`; mongo `/control`).

## Non-goals

- **Re-rendering existing user migrations.** Users' on-disk `migration.ts` files keep importing `@internal/target-{postgres,sqlite}/migration`; the target packages' `/migration` exports stay in place. Re-rendering would trip `MIGRATION.HASH_MISMATCH` per [`skills/prisma-next-migrations/SKILL.md`](../../skills/prisma-next-migrations/SKILL.md). Only the in-workspace fixtures and the renderer's output for *new* migrations change.
- **Removing internal `@internal/target-*`, `@internal/family-*`, `@internal/sql-*`, `@internal/cli/*` packages or their subpaths.** They remain as implementation detail. Per ADR 211, programmatic APIs keep their scoped names; this project doesn't change that.
- **`@internal/postgres/config` parity for non-Postgres SQL targets.** SQLite gets `/config`; we don't generalise to a hypothetical `@internal/<sql-target>/config` shape.
- **Mongo `/contract-builder` audit.** Already exists, in scope only if a gap surfaces during implementation.
- **Façade for any target not currently shipping** (no façade for cockroach, mysql, etc.; out of scope).
- **Renaming or restructuring the façade packages.** They stay at `packages/3-extensions/{postgres,mongo,sqlite}` with their current names.

# Approach

The three façade packages already exist with most of the right shape ([`packages/3-extensions/postgres/`](../../packages/3-extensions/postgres/) is the most complete; Mongo lags on options-shape and `/control`; SQLite is missing four of five non-runtime subpaths). All the *symbols* the façades need to re-export already exist on the internal packages — `@internal/target-{postgres,sqlite}/migration` exports the full `Migration` / `MigrationCLI` / `placeholder` / op-factory surface; `@internal/target-mongo/control` exports the descriptor needed for a Mongo control client; the family-level `PrismaNextConfig` already supports `extensions` (as `extensionPacks`) and `migrations.dir`. The work is composition + tree-shake-preserving subpath wiring, plus a small renderer change in two `render-typescript.ts` files.

Each façade subpath is its own entrypoint file under `src/exports/<name>.ts` (matching the existing Postgres pattern). No `"."` barrel; bundlers tree-shake at the named-export level within each subpath. The Mongo façade currently has a `"."` barrel — we drop it in scope, matching Postgres's subpath-only model.

The renderer change is non-destructive by construction. Renderers emit the façade specifier going forward; the target package's `/migration` export stays in place forever. Old user migrations continue to import the target specifier and continue to work. The skill cluster's "framework-managed import line" guidance flips from "uses target-postgres" to "uses postgres/sqlite façade" in lockstep with the renderer change.

The example-app migrations and the agent-skill update ship in the same PR as the façade changes. This gives each new façade subpath a same-PR consumer (proof of payoff) and keeps the skill cluster's teaching in lockstep with the framework's emit. The PR is shaped one slice → one PR per the operator decision; the slice plan decomposes the work into M-sized dispatches sequenced around the renderer-fixture interaction.

# Project Definition of Done

- [ ] **PDoD1.** Single slice delivered (`slices/facade-completion/` plan, all dispatches done).
- [ ] **PDoD2.** All 13 `examples/*/prisma-next.config.ts` use façade-form imports; no `examples/**/prisma-next.config.ts` imports from `@internal/{cli,family-*,sql-*,target-*,adapter-*,driver-*}/*`.
- [ ] **PDoD3.** `pnpm fixtures:check` clean; in-workspace render fixtures regenerated to the new façade specifier.
- [ ] **PDoD4.** `pnpm build`, `pnpm lint:deps`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e` clean.
- [ ] **PDoD5.** [`skills/prisma-next-migrations/SKILL.md`](../../skills/prisma-next-migrations/SKILL.md) updated; no reference to TML-2526 remains; "framework-rendered import line" guidance points at `@internal/{postgres,sqlite}/migration`.
- [ ] **PDoD6.** Manual-QA script exists for the user-visible journeys (façade imports compile in a fresh `examples/prisma-8-demo-sqlite` checkout; `prisma-next migration plan` renders the new specifier; control-side scripts can compose `createSqliteControlClient` + `createMongoControlClient`). ≥ 1 run report; no unresolved 🛑 Blocker findings.
- [ ] **PDoD7.** Façade README updates: Postgres adds `/migration` to its "Exports" list; Mongo adds `/control` and notes the dropped `"."` barrel; SQLite rewritten to mirror Postgres's README shape (`/config`, `/contract-builder`, `/control`, `/migration`, `/runtime` all documented).
- [ ] **PDoD8.** Mandatory final retro recorded under `projects/facade-import-surface-completion/retros.md`; lessons landed in canonical surface (`drive/calibration/**` or the agent-skill cluster).
- [ ] **PDoD9.** Long-lived docs (if any architectural decisions surface — façade-vs-direct-import principle, tree-shake-by-default principle) migrated into `docs/` (likely an ADR or a §"Façade contract" addition to [ADR 211](../../docs/architecture%20docs/adrs/ADR%20211%20-%20prisma-next%20bin-only%20distribution.md) / [ADR 207](../../docs/architecture%20docs/adrs/ADR%20207%20-%20A%20serverless%20Postgres%20connection%20has%20the%20same%20query%20interface%20as%20a%20postgres%20client.md)).
- [ ] **PDoD10.** Repo-wide references to `projects/facade-import-surface-completion/**` removed from long-lived files; `projects/facade-import-surface-completion/` deleted.
- [ ] **PDoD11.** TML-2526 reaches `Ready to be merged` via the GitHub integration; PR merged closes it automatically.

# Functional Requirements

- **FR1.** `@internal/postgres/migration` exports `Migration`, `MigrationCLI`, `placeholder`, `dataTransform`, the column/constraint/dependency/enum/index/raw/table op factories, with the same named exports as `@internal/target-postgres/migration`.
- **FR2.** `@internal/mongo/config` accepts `{ contract, db?, extensions?, migrations? }` with `migrations.dir?: string`, matching `PostgresConfigOptions`.
- **FR3.** `@internal/mongo/control` exports `createMongoControlClient(options)` returning a `ControlClient`, parallel to `createPostgresControlClient`.
- **FR4.** `@internal/sqlite/config` exports `defineConfig` and `SqliteConfigOptions = { contract, db?: { connection?: string }, extensions?, migrations?: { dir? } }`. The `db.connection` string is interpreted as a file path (including `:memory:`) and translates to the underlying SQLite driver's `path` binding.
- **FR5.** `@internal/sqlite/contract-builder` re-exports `defineContract`, `field`, `model`, `rel`, and the supporting types from `@internal/sql-contract-ts/contract-builder` (mirroring `@internal/postgres/contract-builder`).
- **FR6.** `@internal/sqlite/control` exports `createSqliteControlClient(options)` returning a `ControlClient`, parallel to `createPostgresControlClient`.
- **FR7.** `@internal/sqlite/migration` exports the SQLite migration surface (`Migration`, `MigrationCLI`, `placeholder`, `dataTransform`, the SQLite op factories) — mirror of `@internal/target-sqlite/migration`.
- **FR8.** The Postgres and SQLite migration renderers emit the façade specifier. Two coupled changes:
  - `packages/3-targets/3-targets/{postgres,sqlite}/src/core/migrations/render-typescript.ts` — `BASE_IMPORTS` switches to `@internal/{postgres,sqlite}/migration`.
  - `packages/3-targets/3-targets/{postgres,sqlite}/src/core/migrations/op-factory-call.ts` — the `TARGET_MIGRATION_MODULE` constant (fed into every op-factory call's `importRequirements()`) switches to `@internal/{postgres,sqlite}/migration`. Without this, the renderer mixes specifiers because per-call `importRequirements` overrides `BASE_IMPORTS` for the same symbols.
- **FR9.** Every user-authored TypeScript file under `examples/<app>/` outside `migrations/` uses façade-form imports — covers both `prisma-next.config.ts` and `prisma/contract.ts`. No `@internal/{cli,family-*,sql-*,mongo-*,target-*,adapter-*,driver-*}/*` imports remain in these files.
- **FR10.** The `@internal/mongo` `exports` map has no `"."` entry; only subpaths. Existing barrel re-exports (BSON value constructors from `mongodb`) move to a new `@internal/mongo/bson` subpath that retains the same named exports.
- **FR11.** Each façade's `contract-builder` subpath exports a **target-bound** `defineContract` — family and target are pre-filled by the facade so users don't pass them. The wrapped signature drops `family` and `target` from the input type entirely (they're not optional; the facade knows what they are). User-written contract.ts shrinks to one import line for `defineContract`, with no `family-*`/`target-*`/pack imports for family/target wiring (extensions still imported as needed).

# Non-Functional Requirements

- **NFR1.** Tree-shaking preserved: every façade subpath is its own entrypoint file; no consumer of one subpath pulls another subpath's dependency graph.
- **NFR2.** No breaking change for existing user migrations: `@internal/target-{postgres,sqlite}/migration` exports remain byte-identical to what they are today.
- **NFR3.** `architecture.config.json` annotations correct for every new subpath; `pnpm lint:deps` clean.
- **NFR4.** No new top-level npm dependencies on the façade packages; they consume only existing workspace packages (Postgres + Mongo footprint already paid; SQLite catches up).

# Constraints + Assumptions

- **A1.** *Renderer change is non-destructive because the target package's `/migration` export stays in place.* Stands: target `/migration` exports are unchanged; only the renderer's *emitted* specifier flips. Existing on-disk migrations keep importing `@internal/target-*/migration` and continue to work.
- **A2.** *The SQLite façade can grow `@internal/cli`, `@internal/config`, `@internal/sql-contract-psl`, `@internal/sql-contract-ts` as runtime deps without breaking existing `@internal/sqlite/runtime` consumers' install footprint expectations.* Falsified if SQLite-only users have flagged install size as a hard constraint (no evidence today).
- **A3.** *In-workspace render fixtures are not hash-pinned outside the rendered migration directory itself.* **Verified.** The `migrationHash` is content-addressed over `ops.json`; the renderer flip changes `migration.ts` body only, not ops, so hashes don't shift. The grep gate in the slice spec catches any unexpected pins.
- **A4.** *`createMongoControlClient` can be implemented by composing existing `@internal/{adapter-mongo,driver-mongo,family-mongo,target-mongo}/control` exports the same way `createPostgresControlClient` does for the Postgres family.* **Verified.** Read the Mongo control SPI: `mongoTargetDescriptor` in [`packages/3-mongo-target/1-mongo-target/src/exports/control.ts`](../../packages/3-mongo-target/1-mongo-target/src/exports/control.ts), `mongoAdapterDescriptor` (named export) in [`packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts), `mongoControlDriverDescriptor` (default export) in [`packages/3-mongo-target/3-mongo-driver/src/exports/control.ts`](../../packages/3-mongo-target/3-mongo-driver/src/exports/control.ts). Family descriptor lives at `@internal/family-mongo/control`. Same `createControlClient` from `@internal/cli/control-api` consumes them.
- **A5.** *Dropping the Mongo `"."` barrel is safe because no internal consumer imports `@internal/mongo` without a subpath.* **Verified by grep:** `rg "from '@internal/mongo'"` returns zero workspace hits. The barrel only re-exports BSON value constructors; those move to a new `/bson` subpath atomically with the barrel drop.
- **A6.** *The agent-skill cluster currently mentions the gap only in [`skills/prisma-next-migrations/SKILL.md`](../../skills/prisma-next-migrations/SKILL.md).* **Verified.** Single hit at L86 in `skills/DEVELOPING.md` plus the SKILL.md paragraph; both updated in the docs-sweep dispatch.
- **A7.** *Application-level rendered migrations in `examples/**/migrations/**/migration.ts` are NOT regenerated as part of this PR.* They stay on the target specifier; that's fine under NFR2 (the target `/migration` export stays in place). The renderer flip only affects *new* migrations going forward. Extension-pack migrations in `packages/3-extensions/{cipherstash,pgvector,postgis,paradedb}/migrations/` are similarly untouched — extensions deliberately author against the target specifier because the extension authoring contract documents that shape (see [`packages/3-extensions/cipherstash/src/exports/migration.ts`](../../packages/3-extensions/cipherstash/src/exports/migration.ts) docstring).

- **A8.** *Two mongo integration test files keep the verbose `@internal/mongo-contract-ts/contract-builder` import as a workaround for a known facade wrap-signature bug.* Specifically [`test/integration/test/mongo/fixtures/contract.ts`](../../test/integration/test/mongo/fixtures/contract.ts) and [`test/integration/test/mongo-runtime/query-builder.test.ts`](../../test/integration/test/mongo-runtime/query-builder.test.ts). The bug — `@internal/mongo/contract-builder`'s `defineContract` wrap collapses inline-model inference when the consumer uses `mongoQuery<typeof contract>` chains, producing `_id: never` / `count: never` row shapes — was surfaced by D5d R1 and analyzed in D5e (which was deferred from this PR). Fix requires changing mongo's authoring layer (export a covariant `MongoModelLike`, add an explicit `Models` generic to the base `defineContract`), then mirroring postgres's facade pattern; that work is tracked at **[TML-2633](https://linear.app/prisma-company/issue/TML-2633/mongo-facade-definecontract-wrap-collapses-inline-model-inference)**. Both files carry inline comments referencing TML-2633 so a future implementer can find the workaround when the wrap fix lands.

# Open Questions (resolved)

All open questions resolved during D0 research; resolutions feed into the slice scope below.

1. **Mongo `"."` barrel removal in this PR or follow-up?** **Same PR.** The barrel re-exports BSON value constructors from `mongodb` (`Binary`, `Decimal128`, `Long`, `MongoClient`, `ObjectId`, `Timestamp`); to preserve them under the subpath-only principle we add a new `@internal/mongo/bson` subpath that re-exports the same set. Drop the `"."` entry atomically with adding `/bson` and `/control`.

2. **Does the new `MongoConfigOptions.extensions` field type-check today?** **Yes.** `ControlExtensionDescriptor<TFamilyId, TTargetId>` is a parameterised interface in [`packages/1-framework/1-core/framework-components/src/control/control-descriptors.ts` (L80–89)](../../packages/1-framework/1-core/framework-components/src/control/control-descriptors.ts) with no dependency on a concrete extension ecosystem; `readonly ControlExtensionDescriptor<'mongo', 'mongo'>[]` accepts an empty array trivially. Option is a silent no-op until a Mongo extension pack ships.

3. **Should `SqliteConfigOptions.db.connection` accept `URL` or only `string`?** **`string` only.** The SQLite control driver's `create(pathOrMemory: string)` takes a path or `:memory:` marker; the runtime driver carries `path: string` directly. URL doesn't apply at the driver layer.

4. **Are any in-repo manual-QA scripts pinned to the current `@internal/target-postgres/migration` rendered specifier?** **No manual-QA scripts pin it, but the renderer flip's blast radius is bigger than a single `BASE_IMPORTS` change.** Research surfaced these additional pins that must update with the renderer:
   - `packages/3-targets/3-targets/{postgres,sqlite}/src/core/migrations/op-factory-call.ts` — `TARGET_MIGRATION_MODULE` constant fed into every op-factory call's `importRequirements()`. **The renderer's `BASE_IMPORTS` flip alone is insufficient; this constant must flip too, or rendered output mixes specifiers.**
   - 3 e2e tests under [`test/integration/test/cli-journeys/`](../../test/integration/test/cli-journeys/) with 4 inline migration-file string-literal occurrences (`invariant-routing.e2e.test.ts`, `migration-round-trip.e2e.test.ts`, `init-journey/harness.ts`).
   - [`packages/1-framework/1-core/ts-render/README.md` L45](../../packages/1-framework/1-core/ts-render/README.md) (example code) and [`packages/1-framework/3-tooling/cli/README.md` L1063](../../packages/1-framework/3-tooling/cli/README.md) (describes the scaffolded migration's import line).
   - [`docs/architecture docs/adrs/ADR 208 - Invariant-aware migration routing.md` L9](<../../docs/architecture docs/adrs/ADR 208 - Invariant-aware migration routing.md>) (illustrative code).
   - 8 target/adapter test files that string-pin the specifier (`op-factory-call.test.ts` ×2, `planner.authoring-surface.test.ts` ×2, `issue-planner.test.ts`, `op-factory-call.rendering.test.ts`, `op-factory-call.lowering.test.ts`, `render-typescript.roundtrip.test.ts` ×2).

   These all flip together in the renderer dispatch.

5. **Does the example-app migration to façade form require updating any of the examples' own test fixtures?** **Largely no.** One adjacent finding: [`examples/prisma-8-postgis-demo/test/utils/test-database.ts`](../../examples/prisma-8-postgis-demo/test/utils/test-database.ts) composes a control client via verbose imports — out of scope per the ticket text (it's a test helper, not config), but flagged for follow-up.

   *Important non-finding to record:* `examples/**/src/prisma/contract.d.ts` and `examples/**/migrations/**/end-contract.d.ts` files import codec types from `@internal/target-postgres/codec-types`. These are framework-emitted artifacts (not user-written), so they sit outside TML-2526's explicit text but **inside the ticket's stated goal** ("users never see `@internal/target-postgres/*` in any file they look at"). See OQ6.

6. **(Surfaced by D0.) Hand-authored `contract.ts` files reach into internal packages for family + target wiring.** Every `examples/<app>/prisma/contract.ts` and every extension-pack `src/contract.ts` (pgvector, postgis) currently does:

   ```ts
   import sqlFamily from '@internal/family-sql/pack';
   import postgresPack from '@internal/target-postgres/pack';
   import { defineContract } from '@internal/postgres/contract-builder';

   export const contract = defineContract({ family: sqlFamily, target: postgresPack, extensionPacks, ... }, factory);
   ```

   **Resolution:** wrap `defineContract` in each facade's `contract-builder` subpath to pre-bind family + target (see FR11). User contract.ts shrinks to:

   ```ts
   import { defineContract } from '@internal/postgres/contract-builder';

   export const contract = defineContract({ extensionPacks, ... }, factory);
   ```

   Framework-emitted `.d.ts` files (`contract.d.ts`, `end-contract.d.ts`) — explicitly **out of scope**. They're machine-generated artifacts, not user-authored; the principle "users never write `target-postgres` in a file they author" is satisfied. If we later decide users *read* `.d.ts` enough that the codec-types import bothers them, that's a follow-up.

   Existing user-authored `migration.ts` files in `examples/**/migrations/**/migration.ts` and extension-pack hand-authored migrations in `packages/3-extensions/{cipherstash,pgvector,postgis,paradedb}/migrations/**/migration.ts` continue to import from `@internal/target-*/migration` and are **not regenerated** — extension-pack migrations are deliberately authored against the target specifier (it's the extension authoring contract per the cipherstash docstring), and existing application migrations stay valid under NFR2.

# References

- Linear issue: [TML-2526](https://linear.app/prisma-company/issue/TML-2526/facades-must-re-export-everything-users-import-in-their-app)
- Parent Linear Project: [PN] EA Release
- ADRs: [ADR 211 — `prisma-next` bin-only distribution](../../docs/architecture%20docs/adrs/ADR%20211%20-%20prisma-next%20bin-only%20distribution.md) (Façade-naming asymmetry rationale); [ADR 207 — A serverless Postgres connection has the same query interface as a `postgres()` client](../../docs/architecture%20docs/adrs/ADR%20207%20-%20A%20serverless%20Postgres%20connection%20has%20the%20same%20query%20interface%20as%20a%20postgres%20client.md) (façade design rationale); [ADR 140 — Package Layering & Target-Family Namespacing](../../docs/architecture%20docs/adrs/ADR%20140%20-%20Package%20Layering%20&%20Target-Family%20Namespacing.md); [ADR 153 — Extension Package Naming Convention](../../docs/architecture%20docs/adrs/ADR%20153%20-%20Extension%20Package%20Naming%20Convention.md).
- Reference implementations (in scope): [`packages/3-extensions/postgres/`](../../packages/3-extensions/postgres/) — the most-complete façade; SQLite and Mongo gaps are filled against this shape.
- Agent-skill cluster: [`skills/prisma-next-migrations/SKILL.md`](../../skills/prisma-next-migrations/SKILL.md) (carries the TML-2526 reference today).
