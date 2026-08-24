
# Prisma Next — Contract Authoring

> **Edit your data contract. Prisma handles the rest.**

The data contract is the single source of truth for your data layer. You edit a contract source — `contract.prisma` (PSL, the canonical surface) or `contract.ts` (TypeScript builder) — and the framework derives types, migrations, and runtime configuration from it. The three-step user model:

1. **You edit your data contract.**
2. **The system plans the migrations for you.** (`references/migrations.md`)
3. **If you need data migrations, you edit `migration.ts` and execute it.** (`references/migrations.md`)

Behind step 1 the agent runs `prisma contract emit` after every contract edit (or installs the Vite plugin so the bundler runs it on save — see `references/build.md`). Emit reads the contract source through the provider the façade picks based on the file extension of `contract:` in `prisma.config.ts`, then writes two artefacts colocated with the source:

- `contract.json` — the canonical, content-hashed Contract IR. Read by the planner, the runtime, and `db verify`.
- `contract.d.ts` — the precise TypeScript types the runtime + lanes propagate when you import `Contract` from it.

Both files are **emitted artefacts**. Edit the source; never the JSON or `.d.ts`.

## When to Use

- User wants to add, change, or remove a model / field / relation.
- User wants to add an index, unique constraint, check constraint, enum, or value object (composite type).
- User wants to add a namespace block (Postgres schema) or a cross-contract foreign key.
- User wants to set `@@control` on a model or configure `defaultControlPolicy`.
- User wants to use a custom type from an extension (`pgvector.Vector(length: 1536)`, `cipherstash.EncryptedString({...})`).
- User wants to install or configure an extension via `extensions: [...]` in `prisma.config.ts`, including `@internal/extension-supabase`.
- User is migrating between authoring sources (PSL ↔ TypeScript builder).
- User received `PN-CLI-4002`, `PN-CLI-4003`, or `PN-CLI-4011` from `contract emit`.
- User mentions: *schema, fields, models, attributes, prisma schema, PSL, contract.prisma, contract.ts, contract.json, contract.d.ts, contract emit, façade imports, `@internal/postgres/config`, `@internal/postgres/contract-builder`, extensions, pgvector, cipherstash, postgis, paradedb, supabase, namespaces, cross-space FK, `@@control`, enums, check constraints, `@@check`, value objects, validations, callbacks, soft delete, paranoid, scopes*. (The last cluster routes to *What Prisma Next doesn't do yet* below.)

## When Not to Use

- User wants to apply a contract change to the DB → `references/migrations.md`.
- User wants to write a query against the contract → `references/queries.md`.
- User wants to wire `db.ts` (runtime entry point, middleware, env config) → `references/runtime.md`.
- User wants the Vite / bundler integration → `references/build.md`.
- User wants to set up Prisma Next for the first time → `references/quickstart.md`.
- User wants a deeper read of a single structured error envelope → `references/debug.md`.
- User wants to file a missing-feature request → `references/feedback.md`.

## Key Concepts

- **The `@internal/<target>` façade is the only surface user-authored code imports from.** For a Postgres app: `@internal/postgres/config`, `@internal/postgres/contract-builder`, `@internal/postgres/control`, `@internal/postgres/runtime`. Mongo has the same layout (`@internal/mongo/config`, `@internal/mongo/contract-builder`, `@internal/mongo/runtime`). Each extension publishes its own façade — `@internal/extension-pgvector/control`, `@internal/extension-postgis/control`, `@internal/extension-paradedb/control`. **Never reach into `@internal/cli/*`, `@internal/family-*`, `@internal/target-*`, `@internal/adapter-*`, `@internal/driver-*`, or `@internal/sql-contract-*` from user code.** The façade bakes the family / target / adapter / driver wiring in. See *Common Pitfalls* #4.
- **Contract source.** A file the framework reads and lowers to the canonical Contract IR. Two flavours, both first-class:
  - **`contract.prisma` (PSL)** — schema-flavoured DSL. Canonical for typical apps and brownfield Prisma users. Wired by `contract: './<path>/contract.prisma'` — the `defineConfig` façade detects the `.prisma` extension and routes through the PSL provider.
  - **`contract.ts` (TypeScript builder)** — programmatic authoring with `defineContract({...}, ({ field, model, rel, type }) => ({...}))` from `@internal/postgres/contract-builder` (or `@internal/mongo/contract-builder`). Wired by `contract: './<path>/contract.ts'` — the façade detects the `.ts` extension and routes through the TS provider. Use when you need programmatic composition (per-tenant variants, generated fields) or constructs PSL doesn't yet express (e.g. registering a parameterised extension type — see pgvector's contract).
- **`prisma.config.ts`.** Wires the contract source, the database connection, the migrations directory, and any installed extensions. Use `defineConfig({...})` from `@internal/postgres/config` (or `@internal/mongo/config`). The four fields the façade accepts: `contract` (path string — `.prisma` or `.ts`), `db` (`{ connection?: string }`), `extensions` (array of control descriptors), `migrations` (`{ dir?: string }`). The output path for `contract.json` is auto-derived from `contract` (e.g. `./src/prisma/contract.prisma` → `./src/prisma/contract.json`).
- **Emit pipeline.** `prisma contract emit --config <path>?` reads `prisma.config.ts`, calls the provider the façade picked, validates the resulting Contract, then atomically writes `contract.json` + `contract.d.ts` colocated with the source.
- **Extension namespaces.** Extensions contribute namespaced constructors (`pgvector.Vector(length: 1536)`, `cipherstash.EncryptedString({equality: true})`) and helper presets. Install them by adding the descriptor to **two** places — both fields are named `extensions`, but the two surfaces consume two different descriptor types and shapes:
  - **In the config (façade and core):** `extensions: [pgvector]` — array of *control* descriptors imported from `@internal/extension-<name>/control`.
  - **In the TS builder's `defineContract` (only when authoring `contract.ts`):** `extensions: { pgvector }` — record of *pack* descriptors imported from `@internal/extension-<name>/pack`.
- **Contract space.** Every package that emits a contract owns its own *contract space* — a `prisma.config.ts` at package root, a contract source, the colocated emitted artefacts, and a `migrations/` directory. **There are two intentional on-disk layouts**, picked by whether the contract space is the consuming application or a contract-space package (an extension, an internal aggregate-root package, etc.):
  - **Application layout** (what you use when building an *app*). `prisma.config.ts` at repo root; `src/prisma/contract.{prisma,ts}`; `src/prisma/contract.{json,d.ts}` colocated; `src/prisma/db.ts` colocated; migrations under `migrations/app/<timestamp>_<slug>/`. The `app/` segment is the consuming application's space-id; extension space-ids land in sibling `migrations/<extension-space-id>/` directories that the extension packages manage. This is what `examples/prisma-8-demo` uses. `prisma orm init` currently scaffolds something different (`prisma/...` at repo root) — that's a defect (TML-2532); the canonical layout is what every command actually expects to see.
  - **Contract-space-package layout** (what you use when *publishing* a contract-space package — extensions, internal monorepo packages). `prisma.config.ts` at package root; `src/contract.{prisma,ts}` directly (no `prisma/` subdir); `src/contract.{json,d.ts}` colocated; `migrations/<timestamp>_<slug>/` directly under `migrations/` (no `<space-id>` segment — the package *is* a single space). Documented in `.cursor/rules/contract-space-package-layout.mdc` and ADR 212.

  Both layouts let `defineConfig`'s `contract:` path point at the source; the framework derives everything else (emit output, migration root) from there. Pick the layout that matches what you're building and stick with it — don't mix.

## Diagnostic codes you route on

`prisma contract emit` surfaces structured errors with stable codes; branch on `code` rather than message text.

| Code | Meaning | Next move |
|---|---|---|
| `PN-CLI-4002` *Contract configuration missing* | `contract` not set in `prisma.config.ts`. | Add `contract: './src/prisma/contract.prisma'` (app layout) or `'./src/contract.prisma'` (contract-space-package layout) — likewise for `.ts` sources — to `defineConfig({...})` from `@internal/postgres/config`. |
| `PN-CLI-4003` *Contract validation failed* | Source loaded but the Contract IR failed structural validation. | Read `meta.diagnostics` / `meta.issues` for the offending model/field, fix the source, re-emit. |
| `PN-CLI-4011` *Missing extension packs in config* | The contract uses a namespaced constructor (e.g. `pgvector.Vector(...)`) but `extensions` in the config does not list a matching descriptor. `meta.missingExtensions` names them. | Install the package, import its control descriptor (`import pgvector from '@internal/extension-pgvector/control'`), add it to `extensions: [...]` in `prisma.config.ts`. |

## Workflow — Read the contract source of truth

The concept: every contract change starts by locating the source file. The config is authoritative — read `prisma.config.ts`, find the `contract:` field (a path string under the façade), and open the file it points at. The same field tells you the installed `extensions: [...]`.

```bash
cat prisma.config.ts
```

If `contract:` ends in `.prisma`, the source is PSL; if it ends in `.ts`, the source is the TS builder. If `prisma.config.ts` is missing, route to `references/quickstart.md`.

## Workflow — Edit a model / field / relation (PSL)

The concept: PSL models lower to tables (or collections, on Mongo); fields lower to columns; `@relation(...)` declares the FK side. Add the relation only on the owning side — the framework derives the back-reference automatically.

```prisma
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@unique([title, authorId])
  @@index([authorId])
}
```

Then run `pnpm prisma contract emit` (or rely on the Vite plugin — see `references/build.md`). Specify cascade behaviour explicitly with `onDelete` / `onUpdate`; the default is `Restrict`.

`@@index` also accepts `expression:` (instead of a fields list), `where:` (partial-index predicate), `unique:`, `type:`/`options:` (target-registered access method), and `name:` xor `map:`:

```prisma
@@index(expression: "lower(email)", name: "users_email_lower")
@@index([authorId], where: "(archived_at IS NULL)", name: "posts_author_active")
```

`name:` declares a wire-named index (physical name `<name>_<8-hex hash>`, renames plan as `ALTER INDEX … RENAME`); `map:` adopts an exact physical name verbatim (for infer-captured objects — combining it with a SQL body warns, because drift detection byte-compares the authored text against Postgres's reprint). An `expression:` requires `name:` or `map:`. The TS builder mirrors this via `constraints.index([cols.x], {...})` / `constraints.index({ expression, ... })` — see `packages/2-sql/2-authoring/contract-ts/README.md`.

PSL alias surface for repeated types lives in a top-level `types {}` block:

```prisma
types {
  Email = String
}

model User {
  id    Int    @id @default(autoincrement())
  email Email  @unique
}
```

Note: scalar lists (e.g. `String[]`) and implicit Prisma-ORM many-to-many (list nav on both sides without a join model) are rejected by the SQL interpreter — use a join model. Composite/embeddable types (`type Address { ... }` with `address Address` on a model) are supported: the interpreter lowers them to `valueObjects` in the domain and stores them as `jsonb` columns. See *Workflow — Value objects* below.

## Workflow — Edit a model / field / relation (TS builder)

The concept: same model, different authoring surface. The façade re-exports `defineContract`, `field`, `model`, `rel`, plus the `family`/`target` packs as default exports of `@internal/postgres/family` and `@internal/postgres/target`. Use the callback overload (`defineContract({...}, ({ field, model, rel, type }) => ({...}))`) to get the higher-level helpers (`field.text()`, `field.id.uuidv7String()`, `field.temporal.createdAt()`, `type.sql.String(35)`).

```typescript
import sqlFamily from '@internal/postgres/family';
import { defineContract } from '@internal/postgres/contract-builder';
import postgresPack from '@internal/postgres/target';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
  },
  ({ field, model }) => ({
    models: {
      User: model('User', {
        fields: {
          id: field.id.uuidv7String(),
          email: field.text().unique(),
          createdAt: field.temporal.createdAt(),
        },
      }).sql({ table: 'app_user' }),
    },
  }),
);
```

Then `pnpm prisma contract emit`. The `field.<scalar>()` helpers are only available inside the callback overload; outside the callback only `field.column(...)`, `field.generated(...)`, `field.namedType(...)` exist.

For Mongo, swap every `@internal/postgres/*` import for `@internal/mongo/*`. The Mongo builder also exposes `index` and `valueObject`.

## Workflow — Add an extension-typed scalar (pgvector)

The concept: an extension contributes a namespace (`pgvector.*`) plus two descriptor flavours — a *control* descriptor for the config façade and a *pack* descriptor for the TS builder. Register the control descriptor in `defineConfig.extensions` (array form). If you're authoring with the TS builder, also register the pack descriptor in `defineContract.extensions` (record form). Then reference the namespaced constructor from the contract.

`prisma.config.ts`:

```typescript
import pgvector from '@internal/extension-pgvector/control';
import { defineConfig } from '@internal/postgres/config';

export default defineConfig({
  contract: './src/prisma/contract.prisma',
  extensions: [pgvector],
});
```

`src/prisma/contract.prisma`:

```prisma
model Document {
  id        Int                          @id @default(autoincrement())
  content   String
  embedding pgvector.Vector(length: 1536)
}
```

Emit. The named-type lowering puts `vector(1536)` on the column and the type map in `contract.d.ts` carries the right TS type.

If you reference `pgvector.*` without registering the pack in the config, emit fails with `PN-CLI-4011` and `meta.missingExtensions: ['pgvector']`. The envelope's `fix` text says *"Add the missing extension descriptors to `extensions` in prisma.config.ts"* — that field name matches the façade.

For canonical worked examples covering single and multi-extension setups, read `examples/multi-extension-monorepo/app/prisma.config.ts` and `examples/prisma-8-postgis-demo/prisma.config.ts`.

## Workflow — Polymorphism (`@@discriminator` / `@@base`)

The concept (SQL targets): one base model declares the discriminator field; each variant model declares its base + discriminator value. The variant chooses STI vs MTI by **whether it sets `@@map(...)`**: no `@@map` means the variant inherits the base's table (single-table inheritance); `@@map("variant_table")` means the variant gets its own table joined 1:1 by primary key (multi-table inheritance).

```prisma
model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

// STI variant — shares the `tasks` table.
model Bug {
  severity String

  @@base(Task, "bug")
}

// MTI variant — joins to `tasks` via PK; carries its own `features` table.
model Feature {
  priority Int

  @@base(Task, "feature")
  @@map("features")
}
```

Verify the polymorphism syntax against the interpreter tests if in doubt: `packages/2-sql/2-authoring/contract-psl/test/interpreter.polymorphism.test.ts`.

Mongo has no schema layer, so polymorphism on Mongo is modelled by an explicit `discriminator` field on the model in the TS builder (see `@internal/mongo/contract-builder`); `@@base` / `@@discriminator` PSL attributes are SQL-only.

Querying the variants is a runtime concern — see `references/queries.md`.

## Workflow — Value objects (composite types)

The concept: `type Foo { ... }` blocks declare value-object shapes. The interpreter lowers them to `valueObjects` in the contract domain and stores them as `jsonb` columns. Nested value-object references are supported.

```prisma
type Address {
  street  String
  city    String
  zip     String?
  country String
}

model User {
  id      String   @id @default(uuid())
  email   String
  address Address?
}
```

Emitted `contract.json` carries `domain.namespaces.<ns>.valueObjects.Address` with its field descriptors, and the `address` column lands as `codecId: "pg/jsonb@1"` / `nativeType: "jsonb"` in `storage`.

Canonical worked example: `examples/prisma-8-demo/src/prisma/contract.prisma`.

## Workflow — Enums

The concept: PSL `enum` blocks declare a domain enum: a named value-set stored through a declared codec (`@@type("pg/text@1")` → a `text` column) and enforced by a planner-generated CHECK constraint. Each member maps to its database value with `Name = "value"`. Use the enum name as a field type on any model in the same contract.

```prisma
enum user_type {
  @@type("pg/text@1")
  admin = "admin"
  user  = "user"
}

model User {
  id   String    @id @default(uuid())
  kind user_type
}
```

**Waiving enforcement (`@noCheck`).** A field can decline the generated CHECK constraints for its column: bare `@noCheck` waives every kind the column's shape derives; `@noCheck(membership)` and `@noCheck(elementNotNull)` waive one kind (`membership` is the enum value-set check; `elementNotNull` is the no-NULL-elements check every list column gets). The TS authoring equivalent is `.noCheck(...)` on the field builder. Declared types do not change: the field still types as the enum union, and a list still types with non-null elements — once enforcement is waived, runtime values may diverge from what the types claim. That divergence is the author's accepted risk, and it is scoped to the kinds actually waived: waiving `membership` stops the database rejecting out-of-set values, waiving `elementNotNull` stops it rejecting NULL elements. A list that waives only `membership` still rejects NULL elements. `contract infer` emits `@noCheck(elementNotNull)` automatically for list columns whose source database does not carry the generated check.

Canonical worked example: `examples/prisma-8-demo/src/prisma/contract.prisma`.

## Workflow — CHECK constraints (`@@check`)

The concept: `@@check` declares a hand-written CHECK constraint on a model — a rule you want the database to enforce, on top of whatever generated checks the model's enums and list columns already get (see *Workflow — Enums* above). Without it, a constraint you added by hand had no way into the contract, so it looked like an undeclared extra a destructive migration could drop.

```prisma
model Order {
  id    Int     @id
  total Decimal

  // name: is a prefix — the physical constraint becomes order_total_positive_<8-hex hash>.
  @@check(expression: "total > 0", name: "order_total_positive")
}
```

`expression` is the raw predicate — the text that goes inside `CHECK (...)` — and it is never parsed, so get it right; Prisma Next does not validate SQL syntax. Exactly one of `name:` or `map:` is required, and they're mutually exclusive:

- **`name:`** — declaring a new rule. Prisma Next picks the physical constraint name and future plans compare by that name, so Postgres's own reprint of your predicate (which rarely matches what you typed byte-for-byte) never causes false drift.
- **`map:`** — adopting a rule that already exists. Give the constraint's exact physical name and Prisma Next compares the predicate byte-for-byte against what's live. This is the form `contract infer` writes for you (see *Workflow — Brownfield introspection* below) when it finds a hand-written check in the database. Every `map:` body warns at emit time (`PN_EXACT_NAME_BODY_COMPARISON`) — the warning fires on the text, not on who wrote it, so the check `contract infer` just wrote warns again on your next `contract emit` too. That is expected, not a defect: the comparison is still sound because both sides are Postgres's own reprint. Prefer `name:` for anything you're authoring fresh: your text and Postgres's reprint of it rarely match character-for-character, and a byte comparison reports that as drift even when both mean exactly the same thing. Reserve `map:` for adopting what's already there, where both sides are the database's own reprint and so do match.

A model can carry any number of `@@check` attributes. The TS builder mirrors this with `check({ expression, name })` / `check({ expression, map })` on a model's `.sql({ checks: [...] })`, next to `index()`.

Check constraints need the target's `checkConstraint` capability. Postgres has it; SQLite does not. `@@check` on a SQLite contract is rejected at authoring time; `check()` on a SQLite contract isn't caught until migration DDL is rendered, but either way you get a refusal, never a silently-dropped constraint.

## Workflow — Namespaces (Postgres schemas)

The concept: wrap models in a `namespace <name> { ... }` block to place them in a non-default Postgres schema. Models outside any block go into the implicit default namespace.

```prisma
namespace public {
  model Profile {
    id       String @id @default(uuid())
    username String
    userId   String @unique
    @@map("profile")
  }
}
```

Canonical worked example: `examples/supabase/src/contract.prisma`.

## Workflow — Cross-contract foreign keys

The concept: a relation field can reference a model in another contract space using the `<space>:<namespace>.<Model>` form. The contract also supports top-level named-type aliases in a `types {}` block, backed by the same bare type-position constructors used by fields. The `@db.X(args)` channel is removed: rewrite `@db.X` as `X` and `@db.X(args)` as `X(args)`; remaining uses fail with an actionable diagnostic naming the replacement.

```prisma
types {
  AuthUserId = Uuid
}

namespace public {
  model Profile {
    id       String     @id @default(uuid())
    username String
    userId   AuthUserId @unique
    user     supabase:auth.AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)
    @@map("profile")
  }
}
```

`supabase:auth.AuthUser` means: model `AuthUser` in namespace `auth` of contract space `supabase`. The target space is provided by a registered extension pack (here `@internal/extension-supabase/pack`).

Canonical worked example: `examples/supabase/src/contract.prisma`.

## Workflow — `@@control` (control policy)

The concept: `@@control(<policy>)` on a model sets whether Prisma manages that table's DDL in migrations. The argument is a positional lowercase literal — one of `managed`, `tolerated`, `external`, or `observed`.

```prisma
model AuditLog {
  id        Int    @id
  message   String

  @@control(observed)
}
```

A contract-level default can be set via `defaultControlPolicy` on `prismaContract(path, { defaultControlPolicy })`. See `references/migrations.md` for how control policies affect DDL planning.

## Workflow — `@internal/extension-supabase`

The concept: the Supabase extension provides the `supabase` contract space (the `auth` / `storage` schemas as `external` tables, plus the platform roles) and its own role-first runtime factory. It does not expose a `/control` subpath so it cannot be registered via the user-facing `defineConfig({ extensions: [...] })` façade — it is wired via `extensions` in the low-level config. See `examples/supabase` for the full working pattern.

`prisma.config.ts` (mirrors the example):

```typescript
import supabasePack from '@internal/extension-supabase/pack';
import { defineConfig } from '@internal/cli/config-types';
// ... other low-level imports

export default defineConfig({
  // ...
  extensions: [supabasePack],
});
```

`db.ts` does **not** use the stock `postgres()` factory — a Supabase app builds its client with the `supabase()` factory from `@internal/extension-supabase/runtime` (role-first: `asUser(jwt)` / `asAnon()` / `asServiceRole()`, JWT validation, RLS). That runtime — and RLS policy authoring (`policy_select` / `@@rls`) — is covered by **`references/supabase.md`**; load it for anything past the config wiring.

Export subpaths: `@internal/extension-supabase/pack`, `@internal/extension-supabase/runtime`, `@internal/extension-supabase/contract`. Canonical worked example: `examples/supabase`.

## Workflow — Brownfield introspection

The concept: pull a contract source out of an existing database and continue from there. `prisma contract infer --db <url>` reads the live schema and writes a `contract.prisma` file. It stops there — follow it with `contract emit` and (when the schema matches a pinned hash) `db sign` as separate steps.

```bash
pnpm prisma contract infer --db $DATABASE_URL --output ./src/prisma/contract.prisma
pnpm prisma contract emit
```

Infer captures indexes at full fidelity — expression, partial (`where:`), unique non-constraint, `type:`/`options:` — adopting each under `map:` with the live name, except that a name shaped like a wire name whose hash recomputes from the content re-detects as wire-named and emits `name:` with the prefix. RLS surfaces too: `@@rls` on RLS-enabled models, and every policy as a `policy_<operation>` block with `@@map("<live name>")`, verbatim predicate reprints, and `permissive = false` for RESTRICTIVE rows (a policy whose role name can't be spelled as a PSL identifier is skipped with a comment note). Replacing an adopted `map:` with the plain wire spelling later converges via a single rename migration.

## Common Pitfalls

1. **Forgetting to re-emit after an edit.** `contract.json` and `contract.d.ts` go stale; downstream typecheck and `migration plan` see the old shape. Re-emit, or install the Vite plugin (`references/build.md`).
2. **Editing the emitted artefacts.** `contract.json` and `contract.d.ts` are emitted; edits there round-trip away on the next emit. Edit the source.
3. **Wrong factory/import path for the TS builder.** `defineContract`, `field`, `model`, `rel` come from `@internal/postgres/contract-builder` (or `@internal/mongo/contract-builder`). Outside the callback overload, the available field constructors are `field.column(...)`, `field.generated(...)`, `field.namedType(...)`.
4. **Reaching into internal packages from user code.** User-authored files (`prisma.config.ts`, `contract.ts`, `db.ts`, control clients) import only from `@internal/<target>/<subpath>` and `@internal/extension-<name>/<subpath>`. Imports from `@internal/cli/*`, `@internal/family-*`, `@internal/target-*`, `@internal/adapter-*`, `@internal/driver-*`, or `@internal/sql-contract-*` are framework-internal — the façade composes them for you. If a façade subpath you need is missing for your target, see *What Prisma Next doesn't do yet* and route to `references/feedback.md`. The canonical worked examples are `examples/multi-extension-monorepo/app/prisma.config.ts` and `examples/prisma-8-postgis-demo/prisma.config.ts`.
5. **Confusing the config `extensions` with the TS builder's `extensions`.** Same packs, two surfaces, one field name but two shapes: `defineConfig({ extensions: [pgvector] })` (array of *control* descriptors from `@internal/extension-<name>/control`) versus `defineContract({ extensions: { pgvector } })` (record of *pack* descriptors from `@internal/extension-<name>/pack`).
6. **Renaming a field and expecting the planner to detect it.** Prisma Next has no in-contract rename hint; the planner sees a destructive drop+add. Hand-edit `migration.ts` after `migration plan` (see `references/migrations.md`), or use the keep-then-drop two-migration pattern.

## What Prisma Next doesn't do yet

- **In-contract rename hint.** No `@@rename(old: ..., new: ...)` or similar. Use the workarounds in *Common Pitfalls* #6. To request first-class rename, file via `references/feedback.md`.
- **Model validations.** No declarative `@validates(...)` surface. Validate in application code (arktype). To request declarative validations in the contract, file via `references/feedback.md`.
- **Lifecycle callbacks** (`beforeSave`, `afterCreate`, etc.). Not supported. Use middleware (`references/runtime.md`) or app code. To request lifecycle callbacks, file via `references/feedback.md`.
- **Soft delete / `paranoid: true`.** No built-in soft-delete column. Add a nullable `deletedAt DateTime?` and filter explicitly in queries (or in middleware). To request built-in soft delete, file via `references/feedback.md`.
- **Scopes / default filters.** No ActiveRecord-style scopes. Compose query helpers yourself. To request scopes, file via `references/feedback.md`.
- **Implicit Prisma-ORM many-to-many.** List navigation on both sides without an explicit join model is rejected. Author the join model explicitly. To request implicit M2M, file via `references/feedback.md`.

## Reference

- Run `pnpm prisma contract --help` for the live command surface.
- PSL feature surface and what the interpreter accepts: `packages/2-sql/2-authoring/contract-psl/README.md`.
- TS builder surface and the callback-helper vocabulary: `packages/2-sql/2-authoring/contract-ts/README.md`.
- Layouts (where `contract.prisma`, `contract.json`, `contract.d.ts`, and `migrations/` live):
  - **App layout** (`src/prisma/...` + `migrations/app/...`) — what `examples/prisma-8-demo` demonstrates; the canonical shape consuming applications use.
  - **Contract-space-package layout** (`src/contract.{prisma,ts}` directly, `migrations/<timestamp>_<slug>/` without a space-id segment) — for extensions and aggregate-root packages, documented in `.cursor/rules/contract-space-package-layout.mdc` and ADR 212.

## Checklist

- [ ] Read `prisma.config.ts` and identified the contract source (path string ending in `.prisma` or `.ts`) and the installed `extensions: [...]`.
- [ ] All user-authored imports resolve to `@internal/<target>/<subpath>` (e.g. `@internal/postgres/config`) or `@internal/extension-<name>/<subpath>`. No imports from `@internal/cli/*`, `@internal/family-*`, `@internal/target-*`, `@internal/adapter-*`, `@internal/driver-*`, or `@internal/sql-contract-*` in user files.
- [ ] Edited the contract source (`contract.prisma` or `contract.ts`), not an emitted artefact.
- [ ] For new extension namespaces: added the package, imported its control descriptor (`@internal/extension-<name>/control`), added it to `extensions: [...]` in `defineConfig({...})` (and the matching pack descriptor to `defineContract({extensions: {...}})` if using the TS builder).
- [ ] For renames: hand-edited `migration.ts` after `migration plan` (or used the keep-then-drop two-migration pattern) — Prisma Next has no rename hint today.
- [ ] Ran `pnpm prisma contract emit` after the edit (or let the Vite plugin re-emit on save).
- [ ] Confirmed `contract.json` and `contract.d.ts` updated next to the source.
- [ ] Did **not** hand-edit `contract.json` / `contract.d.ts`.
- [ ] Did **not** confabulate a missing feature (validations, callbacks, soft delete, scopes, in-contract rename hint) — referred the user to *What Prisma Next doesn't do yet* + `references/feedback.md`.
