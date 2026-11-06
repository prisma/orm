# Pack extensions are found through the search_path

Closes TML-3772 and TML-3771. One pull request. The design is [ADR 316](../../docs/architecture%20docs/adrs/ADR%20316%20-%20An%20extension%20pack's%20extension%20is%20found%20through%20the%20connection's%20search_path.md).

## At a glance

On a Supabase database with `vector` in schema `extensions`, `prisma db sign` signs the pgvector space. Today it refuses, because the pack declares `vector` in `public`.

## Chosen design

1. **TypeScript builder.** Export a symbol `unbound`, created with `Symbol.for`, from the SQL family's TypeScript contract builder (`packages/2-sql-family/2-authoring/contract-ts`), and re-export it from the Postgres facade's contract entrypoint. The Postgres `extension()` builder (`packages/3-targets/postgres/9-facade/src/contract/extension.ts`) accepts it: `extension('vector', { namespace: unbound })`. `extension()` compares against the symbol once, at the call, and stores the unbound namespace id on the handle it returns. Nothing after that call holds or compares the symbol: not the handle, not `defineContract`, not `contract.json`. String namespaces keep their meaning, and the strings `'unbound'` and `'__unbound__'` stay refused (`packages/2-sql-family/2-authoring/contract-ts/src/contract-builder.ts:214`).
2. **Packs.** pgvector, PostGIS and citext (TypeScript contracts) and ParadeDB declare their extension in the unbound namespace. Re-emit each contract. Plan one migration per pack from the current head to the new head; it must have no operations. Add it to each pack's control descriptor, which lists migrations by hand. Re-pin the pack copies in `examples/` and in the upgrade-instruction fixtures with `pnpm fixtures:check`.
3. **Pack rule.** When a command loads the configuration, refuse a pack that declares an extension in a named namespace, and refuse two packs that declare the same extension. Put both next to `assertNoCrossSpaceFkReverseReferences` in `packages/2-sql-family/9-family/src/core/control-instance.ts`. Find extension-like kinds through the SQL family's `requiresNameUniqueAcrossNamespaces` hook, not by the name `extension`.
4. **Introspection.** The Postgres control adapter reads `current_schemas(true)` once. Each extension node read from the database carries its schema and that search path.
5. **Verification.** An extension node built from the contract for an unbound declaration has no fixed schema. Its comparison accepts a live node whose schema is on the live node's search path. Offline, the contract side assumes the search path `['public']`. The mismatch text names the installed schema and the search path. Bound declarations are unchanged.
6. **Planning.** The contract-side node no longer resolves unbound to `public` (`packages/3-targets/postgres/1-target/src/core/migrations/contract-to-postgres-database-schema-node.ts:127`). The issue planner (`.../core/migrations/issue-planner.ts:616`) creates an unbound extension with no `WITH SCHEMA`, reusing `installExtension`, which already omits it. The `__unbound__` value never appears in rendered SQL or `ops.json`. The planner never plans `SET SCHEMA` for an unbound extension; a schema mismatch is a conflict with the advice from the ADR. An application that changes a declaration from a named namespace to unbound plans nothing; one that changes from unbound to a named namespace plans `SET SCHEMA` from `public`, the offline assumption.
7. **Application against packs.** The Postgres planner refuses an application contract that declares an extension another space declares in the unbound namespace, by asking `SchemaOwnership.declaresEntity` for that coordinate. It never drops an extension another space declares. The PSL interpreter refuses the same at emit time, since it reads the composed packs.
8. **Prisma 7 reader.** Delete `PSL.PRISMA7_EXTENSION_SCHEMA_MISMATCH` and its check in `packages/2-sql-family/2-authoring/contract-prisma7/src/extensions.ts`. Update `examples/prisma7-adoption` to match.
9. **Docs.** ADR 316. ADR 312 gets a line under its status pointing at ADR 316. Update the comment in `postgres-migration.ts:108-113` that says Postgres migrations always name a schema, the `resolve-ddl-schema.ts` comment, and pack READMEs that say the extension lives in `public`. Add a release-notes fragment: projects using these packs run `contract emit` and `db migrate` after upgrading.

## Scope

In: the items above, and their tests.

Out:
- `packages/1-framework` is not changed.
- Top-level application declarations still mean `public`.
- How Postgres checks unbound tables (in `current_schema()` only) is unchanged.
- The upgrade guide in prisma/web (TML-3540) is a later PR.

## Pre-investigated edge cases

| Case | Expected |
| --- | --- |
| Supabase reference fixture: `postgres` role has `search_path` `$user, public, extensions`; `vector` in `extensions` | sign succeeds. First check with `SHOW search_path` that the test connection really has that search path: `ALTER ROLE` applies only to new sessions, the fixture runs `RESET ALL`, and PGlite has a single backend. If it does not, set the search path for the test connection explicitly. |
| `vector` in schema `extensions`, search path `public` only | verify fails; message names `extensions` and the search path |
| Extension installed in `pg_catalog` | passes, because `current_schemas(true)` includes `pg_catalog` |
| Database built from the old pack migrations (`vector` in `public`) | `db migrate` reaches the new head with no DDL |
| pgvector pack composed and the application declares `namespace extensions { extension vector {} }` | refused at plan time, and at emit time from PSL, naming both declarations |
| Application declared `vector`, then removes it while the pgvector pack is composed | the plan does not drop `vector` |
| `namespace unbound { extension pg_trgm {} }` in an application's PSL | emits and plans `CREATE EXTENSION IF NOT EXISTS "pg_trgm"` with no schema |

## Done when

The edge cases above have tests, and a Supabase-shaped database adopts with `contract emit` then `db sign`.

## Dispatch plan

One persistent Opus implementer runs every dispatch in order. One persistent Fable reviewer reviews each dispatch. Reviews go to `projects/pack-extensions-on-search-path/reviews/code-review.md`.

Gates for every dispatch: `pnpm typecheck`, and in each touched package `pnpm --filter <pkg> test --coverage` and `pnpm --filter <pkg> lint`; `pnpm lint:deps` when imports change; the integration test files that cover the touched code, one file at a time. Never `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`.

1. **Authoring surfaces.** Outcome: an extension can be declared in the unbound namespace from TypeScript (`extension('vector', { namespace: unbound })`) and from PSL (`namespace unbound { extension pg_trgm {} }`), and both emit `extension.<name>` under `__unbound__`. Builds on: main. Hands to: design item 1, with tests for both surfaces.
2. **Postgres verification and planning.** Outcome: design items 4, 5 and 6. An unbound extension verifies against the live search path, offline comparisons assume `['public']`, the planner creates it with no `WITH SCHEMA` and never plans `SET SCHEMA` for it. Builds on: 1 (tests author unbound extensions through the new surfaces). Hands to: target behaviour with tests for the search-path, off-path, `pg_catalog`, named-to-unbound and unbound-to-named cases. Reviewer gets an execution budget and the F34 and F35 probes from `drive/calibration/dod.md`.
3. **One declaration per extension.** Outcome: design items 3 and 7. Packs that declare an extension in a named namespace, or the same extension twice, are refused when the configuration loads; an application that declares a pack's extension is refused at plan time and at PSL emit time; the planner never drops an extension another space declares. Builds on: 1 and 2. Hands to: refusals with tests, `packages/1-framework` untouched.
4. **Packs and the Prisma 7 reader.** Outcome: design items 2 and 8. The four packs declare their extension in the unbound namespace, each has a migration with no operations to its new head, descriptors list it, pinned copies in `examples/` and fixtures are re-pinned, `PSL.PRISMA7_EXTENSION_SCHEMA_MISMATCH` is gone, and a Supabase-shaped database (the reference fixture) adopts with `contract emit` then `db sign`. Builds on: 1–3. Hands to: `pnpm fixtures:check` and `pnpm check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD` green, plus the edge-case table covered.
5. **Docs.** Outcome: design item 9. Builds on: 4. Hands to: the slice DoD, then `pnpm test:packages`, `pnpm lint:ratchets` and `pnpm fixtures:check` once before the PR.
