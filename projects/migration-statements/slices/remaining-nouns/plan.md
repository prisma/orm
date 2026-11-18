# Slice plan — 3b, the remaining renames and deletes on Postgres and SQLite

**Spec:** [`spec.md`](./spec.md) (approved by Will, 2026-10-21) · **Linear:** [TML-3537](https://linear.app/prisma-company/issue/TML-3537) · **Grounding:** `wip/3b-grounding.md` (gitignored, in the orchestrator's worktree)

Four pull requests, in the order the spec gives. This plan covers PR 1. Each later PR gets its dispatches added here when the one before it is queued. One implementer and one reviewer, both on Opus, resumed across every dispatch of a PR. Briefs are in `dispatches/`.

## PR 1 — namespaces, and the access question (merged, prisma/orm#30823)

**Branch:** `tml-3537-namespaces`, from `tml-3537-remaining-nouns-spec` (the spec and ADR 309 ride in this PR). Postgres only for the namespace work; the access rename touches every target.

### Gate for every dispatch

- `pnpm typecheck`; `pnpm --filter <touched package> lint`; `pnpm --filter <touched package> test --coverage` in every touched package (CI enforces per-package thresholds).
- `pnpm lint:deps` when imports change; `pnpm fixtures:check` when rendering or classes change; `pnpm check:error-reference` when error codes change; `pnpm lint:framework-vocabulary` when `packages/1-framework` changes; `pnpm lint:throws` and `pnpm lint:casts`; `pnpm check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD` when a fragment is added.
- Integration and e2e: only named files, run as `pnpm test <file>` inside `test/integration`. Never `pnpm test:integration`, `test:e2e` or `test:all`.
- Before the PR is queued: every integration and e2e file that runs `migration plan` or `db update`, including through `journey-test-helpers.ts` (F44), by name in groups of about 20.
- The reviewer runs the code against PGlite, not only reads it (F34), and follows every printed advice (F46).

### Dispatches

| # | Outcome | Builds on |
| --- | --- | --- |
| 1 (done) | The access question says "data", not "rows"; `accessWidening` is `accessChanges` and `acceptAccessWidening` is `acceptAccessChanges` everywhere, with an app upgrade fragment; framework doc comments carry no row-level-security examples | — |
| 2 (done) | Three Postgres operations exist end to end, usable from a hand-written `migration.ts`: move a table to another schema, rename a schema, drop a schema. Each with a call class, checks, rendering, a facade method and a subjects entry | — |
| 3 (done) | `--rename Invoice:billing.Invoice` plans the table move on both commands, through the working schema; foreign keys from other tables follow; the `moveNamespace` refusal is gone | 2 |
| 4 (done) | `--rename billing:finance` renames the schema; a namespace the origin declares and the destination does not is asked about per model; `--delete billing` answers every one of them and drops the schema after its tables; a schema another contract space declares is refused | 2, 3 |
| 5 (done) | Journeys for the spec's namespace rows through both commands; docs (Migration System § Statements and its rename limits, error reference, CLI README, `skills/prisma-8/references/migrations.md`); ADR 223's multi-namespace statement corrected; the PR text | 1, 3, 4 |

**Hand-offs**
- 1 → 5: the new names are used in docs and output.
- 2 → 3, 4: the three calls can be planned and rendered, and `migration.ts` re-runs reproduce `ops.json`.
- 3 → 4: statement planning has a working-schema step for a namespace change.
- 4 → 5: both commands move, rename and delete namespaces.

### Open items

- **Renaming the target's default namespace (`public`).** The spec allows it when no other contract space declares it. Dispatch 4 checks whether Postgres lets an ordinary database owner run `ALTER SCHEMA public RENAME` on PGlite and on a managed Postgres; if not, the planner refuses it with advice, and the spec's edge case row is corrected.
- **Names of the three facade methods.** Named after the SQL they run, as `createSchema` and `renameTable` are. The reviewer checks them against the existing facade.
- **For PR 3: three points on ADR 309 from PR 1's system-design review.** (1) The storage value object keeps domain field names; state that value object fields have no mapped names, or store the stored key. (2) The discriminator value set is keyed `<Base>.<field>` and relies on enum names never containing a dot; use a key the column's coordinate determines, or state the rule where entity names are validated. (3) The ADR has no **Status** or **Date** header, unlike its neighbours.

## PR 2 — enum values

**Branch:** `tml-3537-enum-values`, from `origin/main` after PR 1 merged. Postgres and SQLite. Package paths moved on main (#30829: one folder per database, such as `packages/3-targets/postgres/1-target`, and `packages/2-sql-family`); use the paths in the current tree, not the ones in older notes.

Scope, from the spec: enum values that a contract declares (a domain enum, stored as a column with a derived check on Postgres and a plain column on SQLite). Native Postgres enums keep their existing refusal. Enum values inside value object JSON come in PR 4.

### Gate for every dispatch

As for PR 1, with `pnpm lint:ratchets` in place of the separate cast, throw and vocabulary lints.

### Dispatches

| # | Outcome | Builds on |
| --- | --- | --- |
| 1 (done) | `--rename Status.ARCHIVED:Status.RETIRED` and `--delete Status.ARCHIVED` resolve as enum values in the framework resolver, with a new resolved statement kind and a new data-loss subject kind; every exhaustive switch over subjects handles it; MongoDB refuses enum value statements with one message | — |
| 2 (done) | Postgres and SQLite operations that rewrite stored values: change a stored value to another in a column, and set it to NULL or remove it from a list. Postgres handles scalar and list columns; SQLite has no list columns, so scalar only. Usable from a hand-written `migration.ts`, with checks that let a re-run skip finished work; a re-run of the file reproduces `ops.json` | — |
| 3 (done) | The SQL planner compares the origin and destination enums by stored value: a removed or changed stored value in a column that holds it is data loss, asked about as an enum value; `--rename` plans the rewrite, ordered on Postgres after the old check's drop and before the new check's creation; `--delete` sets it to NULL where the column is optional, removes it from lists, and for a required scalar column applies when no row holds the value and otherwise fails at apply with next actions that keep the rows; a member-name-only rename plans nothing and is reported as applied | 1, 2 |
| 4 (done) | Journeys on Postgres and SQLite through both commands; docs (Migration System § Statements, error reference, CLI README, skill); spec rows updated; the PR text | 3 |
