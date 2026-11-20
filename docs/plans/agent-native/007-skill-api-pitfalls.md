# Task: Skill — API Pitfalls & Preview-Feature Guidance

## Overview

Document the client API behaviors that reliably trip up both humans and agents, with
**engine-verified semantics** (sources below are the query-engine test suite and compiler
sources at the matching engines revision). Land as `references/` additions to the existing
`prisma-client-api` skill in prisma/skills, plus a preview-feature guidance reference.

## Content (verified semantics)

### 1. Empty logical operators

Verified in `query-compiler/core/src/query_graph_builder/extractors/filters/mod.rs` and pinned
by engine tests (`filters.rs: empty_and / empty_or / empty_not`):

| Filter    | Result               | SQL rendering |
| --------- | -------------------- | ------------- |
| `AND: []` | matches **all** rows | `1=1`         |
| `OR: []`  | matches **no** rows  | `1=0`         |
| `NOT: []` | matches **all** rows | `1=1`         |

The practical trap: building `OR` clauses dynamically and passing an empty array returns zero
rows — usually the opposite of intent. Rule of thumb for generated filters: omit the operator
entirely (or use `undefined`, which is dropped) instead of passing `[]`. Note the validation
edge: nested arrays like `AND: [[]]` throw `PrismaClientValidationError`.

### 2. `some` / `every` / `none` relation filters

Verified in engine tests (`extended_relation_filters.rs`, `self_relation.rs`):

- `some: {}` → "has at least one related row"; `none: {}` → "has no related rows".
- **`every` is vacuously true on empty relations**: `every: { ... }` includes parents with
  zero related rows. `every` means "no counterexample", not "has rows and all match".
- Composition with empty operators is where it gets truly counterintuitive:
  `some: { OR: [] }` matches nothing; `every: { OR: [] }` matches **only** parents with zero
  related rows. Document these as worked examples.
- Recipes: "every, but at least one" = `AND: [{ rel: { some: {} } }, { rel: { every: cond } }]`.

### 3. Explicitly `undefined` values

Verified in `packages/client/src/runtime/core/jsonProtocol/serializeJsonQuery.ts`:

- By default, an explicitly `undefined` object value is **silently dropped** from the query.
  The catastrophic case: `deleteMany({ where: { id: undefined } })` becomes
  `deleteMany({ where: {} })` — **it deletes every row**. Same for `updateMany`.
- With the `strictUndefinedChecks` preview feature, the same input throws
  `PrismaClientValidationError` ("explicitly `undefined` values are not allowed");
  `Prisma.skip` expresses intentional omission. Array elements always throw, feature or not.
- Skill guidance: enable `strictUndefinedChecks` in agent-managed projects; never build
  `where` objects by spreading possibly-undefined values into destructive operations without
  the feature on.

### 4. Full-text search on PostgreSQL

- `fullTextSearch` is stabilized for MySQL, but on PostgreSQL the renamed
  `fullTextSearchPostgres` preview remains limited. Recommendation: on PostgreSQL use raw SQL
  or TypedSQL with `tsvector`/`tsquery` (and a GIN index) instead of the preview API; include
  a worked TypedSQL example. Cross-reference task 008 (unhiding `typedSql`).

### 5. Preview-feature guidance reference

A "when to suggest what" table for the currently-active preview features, so agents propose
them at the right moment instead of never or always: `relationJoins` (deep includes; see task
009), `nativeDistinct` (distinct is otherwise in-memory), `strictUndefinedChecks` (see above),
`views`, `partialIndexes`, `postgresqlExtensions`, `shardKeys`, `fullTextSearchPostgres`.
For each: symptom that should trigger the suggestion, provider support, maturity caveat.

## Scope

- prisma/skills: `references/` files under `prisma-client-api` (pitfalls) + one
  preview-features reference (placement: `prisma-client-api` or `prisma-cli`, maintainers'
  call).
- Semantics must be re-verified against the ORM version the skills target whenever the
  targeted minor is bumped; each reference should cite the engine test file that pins the
  behavior, so re-verification is mechanical.

## Acceptance criteria

- Every behavioral claim carries its engine-test citation.
- The `undefined`-in-`deleteMany` trap is prominent, with the `strictUndefinedChecks`
  mitigation shown as the default recommendation.
- An agent asked to "search posts by keyword on Postgres" produces TypedSQL/raw SQL with a GIN
  index, not `fullTextSearchPostgres`, when following the skill.
