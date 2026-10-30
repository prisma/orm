# System design review: database policies (slice 3)

Branch `tml-3727-policies`, range `origin/main...HEAD` (22 commits). Reviewer lens: architect (names, types, layer placement, dependency direction, decision records).

Read for this review: `CLAUDE.md`; `drive/code/README.md`; the slice spec and the project spec, including its table of decisions the orchestrating agent made; ADR 309 (new), ADR 021, ADR 218, ADR 228, ADR 245, ADR 287, ADR 307; `docs/architecture docs/subsystems/7. Migration System.md`; `docs/glossary.md`; `docs/onboarding/Repo-Map-and-Layering.md`; the rules `no-family-vocabulary-in-framework`, `no-bare-casts`, `import-validation`.

## What the branch adds

A database now records two policies in each contract space's marker, under `meta.policies`:

- a **change policy**: the strategies (`migrate`, `reconcile`) that may move the database;
- a **data protection policy**: a level for `dataLoss` and one for `accessWidening`.

A ref file may declare the policies its database should have (`RefEntry.policies`). `db migrate`, `db update` and `db sign` read the policies in force before they plan. A ref whose declaration differs fails with `MIGRATION.POLICY_MISMATCH` unless `--permit-policy-change` is given; a strategy the policy lacks fails with `MIGRATION.CHANGE_POLICY_FORBIDS`. With consent, the runner writes the new policies in the same marker update that ends the run.

Invariants the branch introduces:

1. A marker with no `meta.policies` means the defaults, which equal the behaviour before this branch. Nothing writes the defaults out.
2. Only a run given consent and a ref whose declaration differs writes `meta.policies`, and only through the runner's marker update, so ADR 021's "the runner is the only marker writer" still holds.
3. Every marker write on every target keeps the `meta` keys it does not set (fixes MySQL's upsert, which reset `meta` to `{}`).
4. Every ref writer keeps the fields it does not change (`advanceRef` replaces four `writeRef({hash, invariants: []})` calls).
5. The policy check happens before any planning or DDL.

## Subsystem fit and dependency direction

- **Policy types in `framework-components/control`.** Right layer. The types carry no family or target vocabulary, every family consumes them, and the runner options already live there. `migration-tools/refs.ts` importing the arktype schema from `framework-components` points downward, as the layering requires.
- **`policiesOf` throwing a structured error from `@internal/utils`.** The constraint is real: `@internal/errors` depends on `framework-components`, so the framework cannot build a `CliStructuredError`. The chosen workaround is a catch-by-code rewrap in the CLI, and it raises the wrong code (A04).
- **`databasePolicies` on the runner options.** It is declared on the framework's `MigrationRunnerPerSpaceOptions`, again on `SqlMigrationRunnerExecuteOptions`, again on `MongoMigrationRunnerExecuteOptions`, and once more on the control API's `RunMigrationInputs`. The framework options reach the SQL runners through a cast and the MongoDB runner through an object spread, so the compiler does not check that the names match (A08).
- **`TargetRef` replacing `refHash`/`refInvariants`/`refName`.** One field instead of three is the right direction. The type it uses allows states that cannot happen, reuses the word "target", and means different things on `migrate` and `dbUpdate` (A02).
- **`markerLocation` on the read aggregate.** `buildReadAggregate` already passes one family fact through (`storageNameOf`); this adds a second so `migration status` and `migrate --show` can name the marker table in an error. Acceptable as is. It stays needed after A04.
- **`database-policies.ts` in the control API operations.** It sits beside the other per-operation helpers, and the command layer already imports from that folder (`planEverySpace`). Fine as a placement. The command layer also runs the check itself, so `db migrate` checks twice (A09).
- **Family and target packages.** `2-sql-family` and `2-mongo-family` only widen interfaces with the framework type. The four targets each implement "write `meta.policies`, keep the rest of `meta`" with a different mechanism: read-then-spread on Postgres and SQLite, `JSON_SET` and read-then-spread on MySQL, a dotted `$set` path on MongoDB. Each adapter owning its write is the adapter pattern working as intended. What is missing is a single owner for the key name and the stored shape (A06). No family vocabulary leaks into `packages/1-framework`.

## ADR 309

The decision section reads clearly: two policies, where each lives, the agreement rule, consent, enforcement, defaults, and no ledger rows. The alternatives are well chosen and each rejection gives a reason. Problems:

- Its number is taken on `main` (A01).
- It says "every database records two policies in its marker", but the code keeps one record per contract space and can only ever write the application space's (A03).
- It changes the recovery rule of ADR 307, but neither ADR 307 nor the steering list says so (A12).
- It describes data protection enforcement (`MIGRATION.DATA_PROTECTION_FORBIDS`) that this branch does not build, and the error reference does not list that code yet. That is acceptable for a decision record. The PR description should say the data protection policy is recorded and compared, but not yet enforced.

## Test strategy

The layers are tested where they live. `framework-components` tests `policiesOf` and `policyDifferences`. `migration-tools` tests that ref writers keep `policies` and `invariants`. Each target has a runner test that covers recording, keeping `meta`, and a failed run. The control API has operation tests. The CLI has command tests and four end-to-end journeys, one per target. The MySQL upsert regression has its own test.

Two gaps at the architecture level:

- The extension-space refusal is tested only with a hand-built map of policies (`cli/test/control-api/database-policies.test.ts`). No command can produce that state (A03).
- Nothing at the type level ties the framework's runner option to the SQL and MongoDB runner options. Only the end-to-end journeys would catch a renamed field (A08).

## Findings

Ordered by priority.

### A01 — ADR 309's number is already taken on `main` (high)

Location: `docs/architecture docs/adrs/ADR 309 - Databases record a change policy and a data protection policy.md`; references in `docs/architecture docs/ADR-INDEX.md` (steering list and table), `docs/glossary.md` (Change Policy, Data Protection Policy), `ADR 021` and `ADR 218` status lines, the slice `spec.md` and `plan.md`.

Issue: `origin/main` already has `ADR 309 - Value objects are storage entities, and a discriminator column names a value set.md`, and also ADRs 310 to 313. After merge, two documents would be called ADR 309, and every link to "ADR 309" on this branch would be ambiguous.

Suggestion: renumber to the next free number on `main` at merge time (314 today) and update every reference listed above.

### A02 — `TargetRef` allows states that cannot happen and means different things on `migrate` and `dbUpdate` (high)

Location: `packages/1-framework/3-tooling/cli/src/control-api/types.ts` lines 241-251 and 629-660; `.../control-api/operations/database-policies.ts` line 96; `.../control-api/operations/contract-snapshot-resolution.ts` line 72; `.../orm/migrate.ts` lines 419-423; `upgrade-instructions/pending/database-policies/app/instructions.md`.

Issue:
- `TargetRef = { name?: string } & RefEntry` lets a caller pass `policies` without a `name`. `checkRunPolicies` then needs a fallback, `refName: ref.name ?? ref.hash`, so `POLICY_MISMATCH` could name a hash as the ref.
- On `migrate`, a bare contract hash travels as a nameless `TargetRef` (`{hash, invariants: []}`, as the upgrade note tells Composer). On `dbUpdate`, a hash target sends no `ref` at all, and when a ref is sent, its `hash` and `invariants` are ignored: the target comes from `contract`. The two options carry the same doc comment, yet only `policies` and `name` matter on `dbUpdate`. A Composer caller that passes `ref: { hash: X }` to `dbUpdate`, following the upgrade note, is silently not moved to `X`.
- The resolver already uses the shape the spec chose, `{ name: string } & RefEntry`. So the branch now has two types for "a ref with its name".
- "Target" already means the database target (`targetId`, `TargetBoundComponentDescriptor`). Read cold, `TargetRef` sounds like a reference to Postgres or MySQL.

Suggestion: name the concept "a ref with its name" once, for example `NamedRef = { readonly name: string } & RefEntry`, with `name` required, and use it in the resolver and on both options. On `migrate`, keep a contract-hash target separate from the ref: either a discriminated union (`{ kind: 'ref'; ref: NamedRef } | { kind: 'contract'; hash: string }`) or a plain `toHash` field next to `ref`. On `dbUpdate`, document `ref` as the ref whose declared policies are checked and written, since the contract decides where the database goes. Update the upgrade instructions to match.

### A03 — ADR 309 calls the policies a property of the database; the code makes them a property of each contract space (medium)

Location: ADR 309, Decision section; `.../control-api/operations/database-policies.ts` lines 79-114; `.../control-api/operations/run-migration.ts` (application space only gets `databasePolicies`); `cli/test/control-api/database-policies.test.ts` lines 8-27.

Issue: The ADR, the glossary and the error text all say "the database's change policy", "its marker", as if there were one. The code keeps one `meta.policies` per contract space and checks the change policy of every space. But only the application space's marker is ever written: extension spaces have no refs, and `runMigration` passes `databasePolicies` to the application space only. So an extension space's policies are always the defaults unless someone edits the marker row by hand. The "extension space with `change: [migrate]`" case in the spec and its test describe a state that no command produces. A reader of the ADR cannot tell which model is intended.

Suggestion: decide and write it down in ADR 309. Either:
- the application space's marker is the database's record of its policies, every space is checked against it, and the per-space reads go away; or
- policies are per contract space, and the ADR says that an extension space's policies can only be set by hand, and why checking them is still worth it.

The first matches the ADR's wording and the user's mental model ("this database changes only through migrations"). It also stops a database from holding two disagreeing change policies.

### A04 — An invalid `meta.policies` is reported as a driver failure, through an error rewrap that ADR 245 rules out (medium)

Location: `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts` lines 184-204; `.../control-api/operations/database-policies.ts` lines 26-48; `docs/reference/error-reference.md` (`CONTRACT.MARKER_READ_FAILED`, `CONTRACT.MARKER_ROW_CORRUPT`); slice spec, "The policy types live in the framework's control types".

Issue:
- `CONTRACT.MARKER_READ_FAILED` is documented as "a driver-level failure … connectivity, permissions, or locking problems rather than bad marker content". Its `fix` says to check read permissions, connectivity and locks. An invalid `meta.policies` is bad marker content. The code for that is `CONTRACT.MARKER_ROW_CORRUPT` ("the marker row exists but its column values fail schema validation"), whose fix (re-sign) is the right one. The spec chose the wrong code, and the code followed it.
- `policiesOf` throws a half-built error: it has no space and no marker location. `policiesInForce` catches it by its code string and builds a new one. ADR 245 bans this: errors are structured where they are raised, and no mapper translates one error into another. The rewrap exists only because the framework cannot import `@internal/errors`.

Suggestion: make the framework function a pure parser that does not throw. For example, `parseRecordedPolicies(meta): Result<DatabasePolicies, { why: string }>`. `policiesInForce`, which knows the space and the marker location, then raises `errorMarkerRowCorrupt` directly. Update the spec line and the error reference entry for `MARKER_ROW_CORRUPT` to name `meta.policies` as one cause.

### A05 — The bare word "policy" now names four different things (medium)

Location: `MIGRATION.POLICY_MISMATCH` (`.../utils/policy-errors.ts`, `docs/reference/error-reference.md`) beside the existing `MIGRATION.POLICY_VIOLATION`; `policiesOf`, `policyDifferences`, `PolicyDifference`, `DEFAULT_POLICIES` (`control-migration-types.ts` lines 156-255); `policiesUpdated` on `MigrateSuccess` and `DbUpdateSuccess` (`control-api/types.ts`); `checkRunPolicies`, `PolicyCheckedCommand` (`database-policies.ts`, `policy-errors.ts`).

Issue: The spec bans the bare name `policy` because the runner's `options.policy` already means allowed operation classes. The branch follows the ban for one option field only. The same file and error namespace already use "policy" for three other things:
- the operation policy (`MigrationOperationPolicy`, and `MIGRATION.POLICY_VIOLATION`, whose payload is `allowedClasses`);
- the control policy (ADR 224);
- Postgres row-level-security policies. The data protection policy's own `accessWidening` setting is about dropping these.

Read cold, `MIGRATION.POLICY_MISMATCH` next to `MIGRATION.POLICY_VIOLATION` looks like the same family of error, and it could even mean an RLS policy that differs from the contract. `policyDifferences(declared, inForce)` exported from the framework's control entry point does not say which policy it compares.

Suggestion: qualify the new names with "database". The framework exports become `databasePoliciesOf`, `databasePolicyDifferences`, `DatabasePolicyDifference` and `DEFAULT_DATABASE_POLICIES`; the result field becomes `databasePoliciesUpdated`. The error code is public, so changing it is cheapest now: `MIGRATION.DATABASE_POLICY_MISMATCH`. `CHANGE_POLICY_FORBIDS` is already qualified. The `--permit-policy-change` flag comes from the settled design and can stay.

### A06 — No single owner for the layout of `meta.policies` (medium)

Location: reader, `control-migration-types.ts` line 185 (`marker?.meta['policies']`); writers: `packages/3-targets/postgres/2-adapter/src/core/control-adapter.ts` line 574, `packages/3-targets/sqlite/2-adapter/src/core/control-adapter.ts` line 478, `packages/3-targets/mysql/2-adapter/src/core/migrations/marker-ledger.ts` lines 120-124, 151-154 and 192-195 (`'$.policies'`), `packages/3-targets/mongo/2-adapter/src/core/migrations/mongo-control-adapter.ts` lines 42-50 and 218-219 (`'meta.policies'`); ADR 021 status note.

Issue: The key `policies` and the stored shape appear as literals in one reader and four writers. MongoDB copies the shape field by field in `policiesDocument`. ADR 021's new note says every marker write "preserves the `meta` keys it does not own", but nothing says who owns which key. The next `meta` field will copy the pattern a fifth time.

Suggestion: let the framework own the key and the serialised shape. Export the key as a constant beside `DatabasePolicies`, plus a function that returns the plain-data form to store, and use them in all four adapters. State in ADR 309 that the framework owns `meta.policies` and adapters store it opaquely.

### A07 — The policy rules are split between the framework and the CLI (medium-low)

Location: `.../control-api/operations/database-policies.ts` lines 56-65 (`withDeclared`); `control-migration-types.ts` lines 175-177 (`sortedStrategies`) and 184-204.

Issue: The framework owns "fill absent settings from the defaults" (`policiesOf`) and "compare a declaration with what is in force" (`policyDifferences`). The CLI owns the third rule, "lay a declaration over what is in force" (`withDeclared`), and repeats the set-and-sort normalisation of strategies. Composer needs the same three rules for its "already at target" check, which compares policies, so it would have to copy the overlay or import a CLI internal.

Suggestion: move the overlay next to `policyDifferences` in the framework, for example as `applyDeclaredPolicies(inForce, declared)`. Reuse the one normalisation. Consider moving the policy types and functions into their own module (`control/database-policies.ts`), since `control-migration-types.ts` is mostly plan and runner types.

### A08 — The marker destination shape and the runner option are repeated 21 times, linked only by matching names (medium-low)

Location: `{ storageHash; profileHash; invariants?; databasePolicies? }` written inline in `packages/2-sql-family/9-family/src/core/control-adapter.ts` (2), `.../control-instance.ts` (4), `packages/2-mongo-family/9-family/src/core/control-adapter.ts` (4), Postgres, SQLite and MongoDB adapters (2 each), plus MySQL's local `MarkerDestination`. `databasePolicies` is also declared on `MigrationRunnerPerSpaceOptions`, `SqlMigrationRunnerExecuteOptions`, `MongoMigrationRunnerExecuteOptions` and `RunMigrationInputs`. The framework options reach the SQL runners through a cast of the runner (`blindCast` in `packages/3-targets/mysql/1-target/src/core/migrations/control-target.ts` lines 36-39, a bare `as` in `packages/3-targets/sqlite/1-target/src/core/migrations/control-target.ts` line 39), and the MongoDB runner through an object spread (`packages/3-targets/mongo/1-target/src/core/migrations/control-target.ts` lines 68-74). Neither checks that the optional field names match.

Issue: This branch had to add the same line in 21 places. A marker destination is a framework concept (what a marker update writes), but it has no name. Because the runner options cross a cast, renaming the field in one place compiles and silently drops the policies.

Suggestion: add a named framework type, for example `MarkerDestination` in `framework-components/control` (MySQL already has one locally), and use it in every family and target signature. Define the family runner options' shared fields from the framework's, for example `Pick<MigrationRunnerPerSpaceOptions, 'policy' | 'databasePolicies'>`, so the compiler links them through the cast.

### A09 — `db migrate` checks the policies in two layers (medium-low)

Location: `packages/1-framework/3-tooling/cli/src/orm/migrate.ts` lines 419-441; `.../control-api/operations/migrate.ts` lines 156-175.

Issue: The command reads the markers, runs `checkRunPolicies`, plans every space, then calls `client.migrate`. The control API reads the markers again and runs the same check again. `db update` checks once, in the control API. The enforcement rule now has two call sites that must be kept identical, and the command layer reimplements part of an operation the control API owns.

Suggestion: keep one enforcement site, the control API, since Composer only reaches that one. If the command needs the refusal before its own preview planning, expose one control-API preflight step (read markers, check policies, plan) that both the command and `executeMigrate` call. Then the command does not assemble the check itself.

### A10 — The policy value lists are written out three times (low)

Location: `control-migration-types.ts` lines 126-136 (TypeScript unions) and 164-173 (arktype string literals); `packages/1-framework/3-tooling/cli/src/commands/json/schemas.ts` lines 115-125 (JSON schema with `'string'`).

Issue: Adding a level means editing two hand-written lists that the compiler does not compare. The JSON schema accepts any string. The marker is also parsed with `DeclaredPoliciesSchema`, a name that says "what a ref declares", although the marker records rather than declares.

Suggestion: define each list once as a `const` array (`CHANGE_STRATEGIES`, `DATA_LOSS_LEVELS`, `ACCESS_WIDENING_LEVELS`) and derive both the types and the arktype schema from them, or derive the types with `typeof Schema.infer`. Use the same lists in the CLI JSON schema. Name the schema by its shape, not its consumer, for example `PartialDatabasePoliciesSchema`.

### A11 — Difference setting names do not match the ref file's keys (low)

Location: `control-migration-types.ts` lines 207-222 (`setting: 'change' | 'dataLoss' | 'accessWidening'`); `.../utils/policy-errors.ts` lines 15-20.

Issue: The ref file nests the data settings under `dataProtection`, but a difference names them flat. The error says `production declares dataLoss: …`, while the user has to edit `policies.dataProtection.dataLoss`. Two sibling shapes for the same settings.

Suggestion: name each setting by its path in the ref's `policies` object (`change`, `dataProtection.dataLoss`, `dataProtection.accessWidening`) in the type, the error text and the payload.

### A12 — ADR 307's recovery rule is changed without a note on ADR 307 (low)

Location: `docs/architecture docs/adrs/ADR 307 - No recovery resets or drops a database.md` (status and Consequences); `docs/architecture docs/ADR-INDEX.md` steering line for ADR 307; ADR 309, Consequences.

Issue: ADR 307 says a person chooses between `db update` and authored migrations by whether the database's migration history must be kept. With this branch, the change policy makes that choice, and `MARKER_MISMATCH` offers only the recovery the policy permits. The steering list still states ADR 307's old rule, and ADR 307 has no status note pointing to ADR 309. ADR 309 mentions ADR 287 but not this change to ADR 307.

Suggestion: add a status line to ADR 307 saying the change policy now decides the recovery (ADR 309). Reword its steering-list line. Name the change in ADR 309's Consequences.

### A13 — The Migration System subsystem doc does not mention policies (low)

Location: `docs/architecture docs/subsystems/7. Migration System.md`, "Refs (environment targets)" (still shows `{ "hash", "invariants" }` only), "Pre-DDL marker drift check", "Runner".

Issue: The subsystem doc is the narrative entry point for the migration system. After this branch it does not say that refs declare policies, that the marker records them, that commands check them before planning, or that the runner writes them. The `doc-maintenance` rule asks for this. The spec's documents list left it out.

Suggestion: add a short section, for example "Database policies", after the marker drift check. It should describe the read, the check, the consent and the write in the runner's marker update, and link ADR 309. Add `policies` to the ref example.

## Routed to the code review

- Postgres and SQLite `metaWithPolicies` read the marker's `meta` and then write it back. The compare-and-swap only guards `core_hash`, so a concurrent change to another `meta` key between the read and the write would be lost. No other writer of `meta` exists today. Check whether a JSON merge in the update statement is simpler.
- `settingValue` is written twice (`utils/policy-errors.ts`, `orm/migration/status.ts`), and `writtenSettingsText` a third time.
- `policiesInForce` returns a `Map`, so callers add fallbacks that never run, spelled two ways: `?? policiesOf(undefined)` and `?? DEFAULT_POLICIES` (`database-policies.ts` line 89, `migrate.ts` `planEverySpace`, `status.ts`).
- `db sign` passes `invocation: undefined` to `checkRunPolicies`, so the refusal's next action cannot repeat `--config`.
- The branch's merge base is behind `main`, which has since added ADR 312, "db sign refuses a space with unmet invariants". Expect conflicts in `db-sign.ts` on rebase.

## Round 2

Re-reviewed at `6d00fb7146`, after the rebase onto `main` and the fixes recorded in the slice spec under "Decisions after the first review". New code read: `framework-components/src/control/database-policies.ts`, `framework-components/src/control/marker-destination.ts`, `NamedRef` in `migration-tools/src/refs.ts`, `expectedDatabasePolicies` through the runners and `signSpaces`, and the new order in `executeMigrate`.

### Verdicts on the first round

| ID | Verdict | Evidence |
|---|---|---|
| A01 | Fixed | The record is `docs/architecture docs/adrs/ADR 314 - Databases record a change policy and a data protection policy.md`. No reference to the old ADR 309 is left; the remaining "ADR 309" links point at the value-objects record on `main`. |
| A02 | Fixed | `NamedRef` (required `name`) is used by the resolver, `MigrateOptions.ref` and `DbUpdateOptions.ref` (`cli/src/control-api/types.ts` lines 250 and 661). `migrate` has a separate `targetHash` (line 667). `dbUpdate` refuses a ref whose hash differs from its contract (`db-run.ts` lines 240-244). `TargetRef` is gone. One gap remains: A15. |
| A03 | Fixed | ADR 314 line 27 says the policies are the database's, stored on the application space's marker, and govern every space. `databasePoliciesInForce` reads the application space's marker only (`cli/src/control-api/operations/database-policies.ts` lines 25-35). How the runner re-checks them is A14. |
| A04 | Fixed | `databasePoliciesOf` returns a `Result` (`framework-components/src/control/database-policies.ts` lines 112-124). The CLI raises `errorMarkerRowCorrupt` once (`database-policies.ts` line 32). No catch by code is left. |
| A05 | Partly fixed, by decision | The internal names now say "database policies": `databasePoliciesOf`, `databasePolicyDifferences`, `DatabasePolicyDifference`, `DEFAULT_DATABASE_POLICIES`, `databasePoliciesUpdated`. The public codes `MIGRATION.POLICY_MISMATCH` and `MIGRATION.CHANGE_POLICY_FORBIDS` stay, as the spec's decision table records. |
| A06 | Partly fixed | Code fixed: the framework exports `DATABASE_POLICIES_META_KEY` and `storedDatabasePolicies`, and all four adapters use them. ADR 314 line 48 still says marker writes preserve "the `meta` keys it does not own" without saying who owns `meta.policies`. Suggestion: add "The framework owns `meta.policies`: its key and stored form; adapters write it as given." |
| A07 | Fixed | `withDeclaredDatabasePolicies` is in the framework module (lines 88-101). The CLI calls it (`database-policies.ts` line 77). There is one normalisation, `sortedStrategies`. |
| A08 | Fixed | `MarkerDestination` (`marker-destination.ts`) is used by the SQL and MongoDB family adapters, the SQL family instance and the four target adapters. The SQL and MongoDB runner options take `Pick<MigrationRunnerPerSpaceOptions, 'databasePolicies' \| 'expectedDatabasePolicies'>` (`2-sql-family/9-family/src/core/migrations/types.ts` line 380; `mongo-runner.ts` line 96). One local copy remains, in the control API's `RunMigrationInputs` (`run-migration.ts` lines 211-214); it could use the same `Pick`. |
| A09 | Fixed | `checkRunPolicies` is called only in the control API (`migrate.ts`, `db-run.ts`, `db-sign.ts`, `migrate-show.ts`). `orm/migrate.ts` reads the policies only to give the off-graph advice. |
| A10 | Fixed | Each list is one `const` array (`database-policies.ts` lines 10-20). Types and both schemas derive from the arrays. A type test ties each schema to its interface. The CLI JSON schema uses the same arrays (`cli/src/commands/json/schemas.ts` lines 120-134). |
| A11 | Fixed | `DatabasePolicyDifference.setting` is the ref file's key path (`database-policies.ts` lines 132-147). |
| A12 | Fixed | ADR 307 has a status line pointing to ADR 314. Its steering-list line ends "the database's change policy (ADR 314) says which". |
| A13 | Fixed | `7. Migration System.md` has a "Database policies" section (line 370). The ref example mentions `policies` (line 444). |

### New findings

#### A14 — A database-wide check is passed and run per space, at the last space (medium)

Location: `framework-components/src/control/control-migration-types.ts` lines 772-779 (`expectedDatabasePolicies` on `MigrationRunnerPerSpaceOptions`); `framework-components/src/control/control-operation-results.ts` lines 121-130 (`SpaceToSign.expectedDatabasePolicies`); `cli/src/control-api/operations/run-migration.ts` lines 277-283; `cli/src/control-api/operations/db-sign.ts` line 212; `3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts` lines 275-291; `run-migration.ts` line 196 (apply order: extensions first, application space last).

Issue: ADR 314 now says the policies belong to the database. The runner re-check under its lock is still modelled as a per-space option, though. Each caller has to remember to set it on the application space only (`space.spaceId === appSpaceId ? …`). The application space runs last, so the check runs after every extension space has applied.
- On Postgres, SQLite and MySQL, the shared transaction rolls the extensions back, so the run is only wasted.
- On MongoDB, which has no cross-space transaction, the extension migrations stay applied when the check then fails.
- `signSpaces` has the same shape: extension markers are written before the application marker is compared.

So "a concurrent policy change fails the run instead of being overridden" (ADR 314 line 29) holds for the application space, but not for the run as a whole.

Suggestion: make the expected policies a parameter of the whole run, beside `perSpaceOptions` on `MigrationRunner.execute` and beside `spaces` on `signSpaces`. The runner compares them with the application space's marker under its lock before the first space. `databasePolicies`, which the application space's marker update writes, can stay per space.

#### A15 — `migrate` accepts both `ref` and `targetHash` and silently prefers `ref` (low)

Location: `cli/src/control-api/types.ts` lines 655-667; `cli/src/control-api/operations/migrate.ts` line 159 (`ref?.hash ?? options.targetHash ?? …`).

Issue: The two options are alternatives ("when `--to` named a contract rather than a ref"), but the type allows both. When a caller sets both, `targetHash` is ignored without a word. `dbUpdate` refuses its equivalent inconsistency, a ref whose hash differs from the contract, with an internal error. `migrate` does not.

Suggestion: make the target one discriminated field (`{ kind: 'ref'; ref: NamedRef } | { kind: 'contract'; hash: string }`). Or, at least, refuse both being set with the same internal error `dbUpdate` uses.

#### A16 — MongoDB's `RecordedPolicies` reads as typed policies but holds a raw stored value (low)

Location: `2-mongo-family/9-family/src/core/control-adapter.ts` lines 15-22 and 33-38 (`RecordedPolicies { recorded: unknown }`, parameter `unchangedPolicies`); `mongo-runner.ts` lines 443-447.

Issue: Beside `DatabasePolicies`, `DeclaredDatabasePolicies` and `StoredDatabasePolicies`, the name `RecordedPolicies` suggests a fourth typed form of the policies. It is actually the raw `meta.policies` value, kept so the marker compare-and-swap can match it exactly. It wraps a single `unknown` field. The parameter name `unchangedPolicies` describes the condition, not the value.

Suggestion: name it by its role, for example the parameter `expectedStoredPolicies: unknown`, with the doc comment "the raw `meta.policies` the runner read; the update matches only while the marker still stores exactly this". Drop the wrapper interface.

#### A17 — Exports that nothing uses (low)

Location: `framework-components/src/exports/control.ts` lines 145-167 (`DatabasePoliciesSchema`, `DatabasePolicySetting`, `InsertedMarker`); `framework-components/src/control/marker-destination.ts` lines 13-14.

Issue:
- `DatabasePoliciesSchema` validates nothing in source. Its only user is a type test, which imports it from the source file anyway.
- `DatabasePolicySetting` is used nowhere, not even by `DatabasePolicyDifference`, which spells the same three strings again.
- `InsertedMarker` is a framework export that only the SQL family's `insertMarker` uses. Its doc comment names a consumer ("`db sign`'s insert"). Its name reads as a marker record that was inserted, not as the input to an insert, so it does not pair with its sibling `MarkerDestination`.

Suggestion: drop `DatabasePoliciesSchema` from the public exports (keep it in the module for the type test if wanted). Either use `DatabasePolicySetting` in `DatabasePolicyDifference` or delete it. Type `insertMarker`'s parameter as `Omit<MarkerDestination, 'databasePolicies'>` in the SQL family, or give the framework type a name that pairs with `MarkerDestination` and describes what it is, not who calls it.

### Routed to the code review (round 2)

- `markerHoldsDatabasePolicies` treats an unreadable `meta.policies` as "policies changed". A marker corrupted after the check therefore fails under the lock as `MIGRATION.MARKER_CAS_FAILURE` with the advice to run again, instead of `CONTRACT.MARKER_ROW_CORRUPT`.

## Round 3

Re-reviewed at `a85fdf669b`, after the round 2 fixes and a merge of `main`. New code read: the run-wide `expectedDatabasePolicies` on `MigrationRunner.execute` and `signSpaces`, `compareMarkerDatabasePolicies` and `databasePoliciesMovedFailure` in the framework module, `errorMarkerPoliciesCorrupt` in `@internal/errors`, each runner's `checkDatabasePolicies`, `MigrateTarget`, `MarkerInsert`, MongoDB's `StoredPoliciesValue`, and the `reason` field on `MIGRATION.MARKER_CAS_FAILURE` and on `SpaceMarkerConflict`.

### Verdicts on the second round

| ID | Verdict | Evidence |
|---|---|---|
| A06 (ADR part) | Fixed | ADR 314 line 48: "The framework owns that key: it exports the key, the stored form, the parser and the comparison, and the targets write the value it gives them without interpreting it." |
| A08 (leftover) | Fixed | `RunMigrationInputs` takes `databasePolicies` and `expectedDatabasePolicies` through `Pick` of the framework types (`cli/src/control-api/operations/run-migration.ts` lines 185-186). |
| A14 | Fixed | `expectedDatabasePolicies` is a parameter of the whole run on `MigrationRunner.execute` (`framework-components/src/control/control-migration-types.ts` lines 822-827) and on `signSpaces` (`control-instances.ts` lines 66-72), and is gone from the per-space options and `SpaceToSign`. Every runner compares it with the application space's marker before the first space: Postgres `executeSpaces` (`postgres/1-target/src/core/migrations/runner.ts` lines 314-317), SQLite (lines 225-233), MySQL inside `withMarkerLock` (lines 113-118), MongoDB in `control-target.ts` lines 107-116. Both SQL and MongoDB `signSpaces` compare before writing any marker. Each target has a test with an extension space scheduled first that asserts no operation started. |
| A15 | Fixed | `MigrateOptions.target` is one discriminated `MigrateTarget` (`cli/src/control-api/types.ts` lines 655-670). |
| A16 | Fixed in substance | The wrapper is now `StoredPoliciesValue { value: unknown }` with a doc comment saying it is the raw stored value for the compare-and-swap (`2-mongo-family/9-family/src/core/control-adapter.ts` lines 15-22). Keeping the wrapper is justified: an absent argument means "do not compare policies", while `{ value: undefined }` means "compare, expecting none". The parameter is now `storedPolicies`. The names around it are A20. |
| A17 | Fixed | `DatabasePolicySetting` is gone; `DatabasePoliciesSchema` is no longer exported (`framework-components/src/exports/control.ts` lines 146-168); `InsertedMarker` is now `MarkerInsert = Pick<MarkerDestination, …>` (`marker-destination.ts` line 13). |

### Subsystem fit and the framework boundary

The framework module `framework-components/src/control/database-policies.ts` holds the value lists, the types, the meta key, the parser, the overlay, the comparison, the stored form and the structured runner failure (`databasePoliciesMovedFailure`). It also exports two text helpers, `databasePolicyValueText` and `movedDatabasePoliciesWhy`. They write the failure's `why`, which the runners need, and the CLI reuses them so `db sign` and the runners word a moved policy the same way. That matches the spec's "Framework domain" rule. No family or target vocabulary was added to `packages/1-framework`, except the word "row" in the new error's advice (A23). Dependency direction holds: targets import `errorMarkerPoliciesCorrupt` from `@internal/errors`, which they already depended on, and adapters already threw `errorMarkerRowCorrupt` from `readMarker`, so a runner throwing the same code is not a new pattern.

### New findings

#### A18 — A moved-policies comparison reuses `DatabasePolicyDifference`, whose field names then mean something else (medium-low)

Location: `packages/1-framework/1-core/framework-components/src/control/database-policies.ts` lines 177-202 (`MarkerDatabasePoliciesComparison`, `compareMarkerDatabasePolicies`) and 209-221 (`movedDatabasePoliciesWhy`); `control-operation-results.ts` lines 159-168 (`SpaceDatabasePoliciesConflict.comparison`).

Issue: `DatabasePolicyDifference` has `declared` (what a ref declares) and `inForce` (what the database has). `compareMarkerDatabasePolicies` calls `databasePolicyDifferences(checked, inForce)`, so in the `moved` arm `declared` holds the value the caller checked and `inForce` holds the newer value the marker records now. A doc comment on line 183 explains the switch. In the CLI, `inForce` means the value read at check time, so the same word names the older value in one place and the newer value in the other. The type is public through `SpaceDatabasePoliciesConflict`, so a consumer reading `comparison.differences[0].declared` sees "declared" for something no ref declared. The `moved` arm also carries `found`, and the conflict carries `checked`, so `differences` is derivable from data already present.

Suggestion: drop `differences` from the `moved` arm. Let `movedDatabasePoliciesWhy(actor, checked, found)` compute the settings that moved and print them as "from … to …". If a list is still wanted, give it its own shape, `{ setting, checked, found }`, rather than reusing the ref-versus-database type.

#### A19 — ADR 314 and the Migration System doc describe the runner's re-check as "under its lock, as it compares the hash" (low)

Location: `docs/architecture docs/adrs/ADR 314 - Databases record a change policy and a data protection policy.md` line 29; `docs/architecture docs/subsystems/7. Migration System.md` line 374; slice `spec.md` line 209.

Issue: The code now compares the policies once, before the first space, and that order is the property that keeps extension spaces from applying under a policy that moved. The hash comparison, by contrast, is the compare-and-swap at the end. MongoDB has no lock: it compares before the first space and again in the application marker's compare-and-swap. The error reference entry for `MIGRATION.MARKER_CAS_FAILURE` already says this correctly. The ADR and the subsystem doc say neither "before the first space" nor how MongoDB differs.

Suggestion: in both documents, replace the sentence with: "Before it applies the first space, the runner compares the policies the check used with the application space's marker, under its lock where the target has one; MongoDB, which has none, also writes the application marker only while it still stores them. A concurrent policy change fails the run instead of being overridden." Update spec line 209 the same way.

#### A20 — Three names for the same MongoDB record, and one of them clashes with a different CLI type (low)

Location: `packages/3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts` lines 239-242 (`CheckedDatabasePolicies { checked; stored }`); `packages/2-mongo-family/9-family/src/core/control-instance.ts` lines 239-242 (`CheckedPolicies { checked; stored }`); `packages/1-framework/3-tooling/cli/src/control-api/operations/database-policies.ts` lines 47-51 (`CheckedDatabasePolicies { inForce; toWrite }`); `StoredPoliciesValue` beside the framework's `StoredDatabasePolicies`.

Issue: The MongoDB runner and the MongoDB family define the same shape twice under two names. The runner's name is the same as a CLI type with a different shape and meaning. "Stored" also names two things: `StoredDatabasePolicies` is the typed form the framework writes, and `StoredPoliciesValue` is the raw value read back.

Suggestion: define the MongoDB record once, in the MongoDB family next to `StoredPoliciesValue` and `MarkerOperations`, and use it in the runner and in `signSpaces`. Give it a name that does not collide with the CLI type and says it holds the checked policies plus the raw value for the compare-and-swap. Name the raw value by what it is, for example `RawStoredPolicies`.

#### A21 — The same under-lock policy check is written in three SQL runners (low)

Location: `packages/3-targets/postgres/1-target/src/core/migrations/runner.ts` lines 335-351; `packages/3-targets/sqlite/1-target/src/core/migrations/runner.ts` lines 260-277; `packages/3-targets/mysql/1-target/src/core/migrations/runner.ts` lines 126-142.

Issue: The three `checkDatabasePolicies` bodies are the same: read the application marker through `this.family`, compare, throw `errorMarkerPoliciesCorrupt` when unreadable, return `databasePoliciesMovedFailure` when moved. Only the doc comment differs. Where to read the marker and how to report the result is SQL-family behaviour, not target behaviour; only when to call it (inside the lock or transaction) is the target's choice.

Suggestion: put one function in the SQL family's migrations code, for example `checkDatabasePoliciesHeld(family, driver, checked)`, and call it from each runner at the point the target chooses.

#### A22 — Some text still describes the policies as per space, or names the old functions (low)

Location: `packages/1-framework/3-tooling/cli/src/utils/marker-mismatch.ts` line 32 ("The space's change policy in force"); `docs/reference/error-reference.md`, `MIGRATION.MARKER_MISMATCH` payload ("`change`, the space's change strategies in force"); slice `spec.md` line 66 (`policiesOf`, `DEFAULT_POLICIES`, `policyDifferences`, and "the CLI raises the error", although the runners raise it too now); `docs/glossary.md` "Change Policy" (lists the refusal of `db update` and `db sign`, but not of `db migrate` on a database whose policy is `reconcile` alone).

Issue: ADR 314 says the policies are the database's. These places still say "the space's", use names that were renamed, or describe only half of the enforcement.

Suggestion: say "the database's change policy" in the doc comment and the payload description; update spec line 66 to the current names and say that the CLI raises the error on the first read and the runners raise it on the re-check; add `db migrate` needing `migrate` to the glossary entry.

#### A23 — The new framework error tells a MongoDB user to edit a "row" (low)

Location: `packages/1-framework/1-core/errors/src/execution.ts` lines 97-118 (`errorMarkerPoliciesCorrupt`).

Issue: The advice says "correct meta.policies in the marker row; do not delete the row" and "The <location> row for space …". On MongoDB the marker is a document. The code `CONTRACT.MARKER_ROW_CORRUPT` already uses "row", so the code name has a precedent, but the advice is new text in the framework.

Suggestion: say "marker" instead of "marker row" and "the marker for space … in <location>". `markerLocation` already names the table or collection.

#### A24 — Two targets do not test a policy value that becomes unreadable between the check and the lock (low)

Location: `packages/3-targets/sqlite/2-adapter/test/migrations/runner.database-policies.test.ts`; `packages/3-targets/mysql/2-adapter/test/migrations/migrate.database-policies.live.test.ts`.

Issue: Postgres (line 298) and MongoDB (line 364) test that an unreadable `meta.policies` read again by the runner fails as `CONTRACT.MARKER_ROW_CORRUPT` and keeps the row. SQLite and MySQL have no such test, although each has its own copy of the check (A21). If A21 is fixed, one SQL-family test covers all three.

Suggestion: add the case to SQLite and MySQL, or to the shared SQL-family function once A21 lands.

### Routed to the code review (round 3)

- MongoDB's `updateMarker` failure path (`mongo-runner.ts` lines 460-482) compares policies only when the storage hash still matches, and acts only on `moved`. When the policies became unreadable after the check, it reports `MIGRATION.MARKER_CAS_FAILURE` with `reason: 'storageHash'`, while the expected and found storage hashes are equal. That is the round 2 routed item, now in this form.

## Round 4

Re-reviewed at `6f6e6c1200`, covering `8693a70269...HEAD` (five commits). New code read: `checkDatabasePoliciesHeld` (`packages/2-sql-family/9-family/src/core/migrations/database-policies-check.ts`), `checkMarkerPolicies` and `CheckedMarkerPolicies` (`packages/2-mongo-family/9-family/src/core/marker-policies.ts`, `control-adapter.ts`), the required `MarkerOperations.markerLocation`, the re-signed `movedDatabasePoliciesWhy(actor, checked, found)` and `databasePoliciesMovedFailure(checked, found)`, the MongoDB marker swap retry in the runner and in `signSpaces`, and the document changes. `pnpm lint:deps` passes; the SQL family's new dependency on `@internal/errors` points down to framework core, as the MongoDB family's already did.

### Verdicts on the third round

| ID | Verdict | Evidence |
|---|---|---|
| A18 | Fixed | The `moved` arm is `{ kind: 'moved'; found }` (`framework-components/src/control/database-policies.ts` line 180). `movedDatabasePoliciesWhy(actor, checked, found)` and `databasePoliciesMovedFailure(checked, found)` compute the settings that moved themselves (lines 203-243). `SpaceDatabasePoliciesConflict` no longer carries `differences` or `contract`. |
| A19 | Fixed | ADR 314 line 29, `7. Migration System.md` line 374 and slice spec line 209 now say the runner compares before the first space, under its lock (SQLite: its exclusive transaction), and that MongoDB compares first and then guards the application marker's write. |
| A20 | Fixed | One record, `CheckedMarkerPolicies { checked; raw }`, in the MongoDB family (`control-adapter.ts` lines 20-31), used by the runner and `signSpaces`. The raw value is `RawStoredPolicies`. The CLI's `CheckedDatabasePolicies` no longer has a namesake. |
| A21 | Fixed | The three SQL runners call `checkDatabasePoliciesHeld(family, driver, checked)` (Postgres `runner.ts` line 313, SQLite line 230, MySQL line 113). The check has its own family test (`2-sql-family/9-family/test/database-policies-check.test.ts`). |
| A22 | Fixed | `marker-mismatch.ts` line 32 and the `MIGRATION.MARKER_MISMATCH` payload say "the database's"; spec line 66 uses the current names and says who raises the error; the glossary's Change Policy entry names the `db migrate` refusal. |
| A23 | Fixed | `errorMarkerPoliciesCorrupt` says "the marker" and "the marker for space … in <location>" (`errors/src/execution.ts` lines 98-117), with a test. Its summary is now "The marker's policies cannot be read". |
| A24 | Fixed | SQLite and MySQL each test unreadable policies inside the run, and each also tests that an extension space's marker policies are ignored. |

### New findings

#### A25 — The MongoDB swap retry reports "the policies changed" when they did not, and puts that MongoDB case into the framework's text (medium-low)

Location: `packages/3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts` lines 500-527 (`updateMarker`, `attempt === 2` returns `databasePoliciesMovedFailure(guard.checked, guard.checked)`); `packages/2-mongo-family/9-family/src/core/control-instance.ts` lines 255-284 (same loop in `signSpaceMarker`, returning `{ kind: 'moved', found: guard.checked }`); `packages/1-framework/1-core/framework-components/src/control/database-policies.ts` lines 203-220 (`movedDatabasePoliciesWhy`, new branch for no differences).

Issue: MongoDB guards the application marker's write by matching the raw `meta.policies` subdocument, and that match is sensitive to field order and array order. So another writer can store the same settings in a different form, and the swap fails although no setting changed. The code retries once with the raw value it found. If the second swap also fails, it reports a `moved` comparison and a `MIGRATION.MARKER_CAS_FAILURE` with `reason: 'databasePolicies'` whose `foundDatabasePolicies` equals `checkedDatabasePolicies`. That breaks the meaning of `moved` ("the marker records different policies"). A consumer that reads `found` sees the policies it checked, presented as the policies another process wrote. To make the message read correctly, `movedDatabasePoliciesWhy` gained a branch for "no setting moved". That branch only exists because of how MongoDB's swap compares, and the framework now carries that MongoDB case in its shared text.

Suggestion: keep "the settings moved" and "the marker kept changing under the swap" apart. Either make MongoDB's guard compare the policies in an order-independent way (match each setting's path, and `change` as a set), so a form change never fails the swap and the retry goes away. Or, if the retry stays, report its second failure as its own cause in the MongoDB code, with what was found. Then `movedDatabasePoliciesWhy` loses the no-difference branch and `moved` always has a real difference.

#### A26 — The MongoDB swap-and-retry loop is written twice (low)

Location: `mongo-runner.ts` lines 500-527; `2-mongo-family/9-family/src/core/control-instance.ts` lines 255-284.

Issue: The runner's `updateMarker` and the family's `signSpaceMarker` each contain the same loop: swap with the raw guard, re-read on failure, report a storage-hash conflict if the hash moved, compare the policies, retry once with the new raw value, give up on the second attempt. They differ only in the result type they build. A21 moved the SQL version of this rule into the family; the MongoDB version is still in two places, one of them in the target.

Suggestion: put the loop in the MongoDB family beside `checkMarkerPolicies`, returning a small result (`swapped`, `storageHashMoved` with what was found, `policiesMoved` with what was found, `unreadable`). The runner and `signSpaces` then only map that result to their own failure or conflict. If A25 removes the retry, this mostly goes away.

#### A27 — The error reference and the upgrade note do not describe the retry (low)

Location: `docs/reference/error-reference.md`, `MIGRATION.MARKER_CAS_FAILURE` ("The database's policies moved") and `CONTRACT.MARKER_ROW_CORRUPT`; `upgrade-instructions/pending/database-policies/extension/instructions.md` line 5.

Issue: The code can now produce the `why` "Another process stored the database's policies again after … checked them, with the same settings in a different form." The error reference does not list it. `MARKER_ROW_CORRUPT` still says the runners raise it "when they read the policies again under their lock", but MongoDB has no lock and raises it after a failed swap. The upgrade note tells an extension author to "swap again with the raw value found" without saying how many times, though the code stops after one retry. An author who follows the note literally could retry forever.

Suggestion: after deciding A25, describe what the code then does in all three places. If the retry stays, say "once" in the upgrade note, list the second cause under `MARKER_CAS_FAILURE`, and say "under their lock, or after a failed swap on MongoDB" under `MARKER_ROW_CORRUPT`.

### Notes that need no change

- `MarkerOperations.markerLocation` is a fact about the store those operations write to, so it belongs there. The runner no longer needs `family.markerLocation` passed beside the operations. The upgrade note announces the new required field.
- `checkDatabasePoliciesHeld` is exported from `@internal/family-sql/control` and `checkMarkerPolicies` from `@internal/family-mongo/control`. Both are the family's rule, called by that family's targets, and neither leaks into the framework.

## Round 5

Re-reviewed at `21b10444b4`, covering `4fa51b5430...HEAD` (two commits). MongoDB now guards the application marker's write with a query that compares the policy settings, not their stored form. The retry is gone.

### Verdicts on the fourth round

| ID | Verdict | Evidence |
|---|---|---|
| A25 | Fixed | `movedDatabasePoliciesWhy` has no "nothing moved" branch (`framework-components/src/control/database-policies.ts` lines 203-215), so the framework carries no MongoDB-only text. `MongoControlAdapter.updateMarker` takes `heldPolicies: DatabasePolicies` and matches with `policiesHoldExpr`, a query predicate that compares `change` as a set and each data protection setting by value (`mongo/2-adapter/src/core/migrations/mongo-control-adapter.ts` lines 55-113, 287-289). A different stored form no longer fails the swap, so nothing retries, and a `moved` result always has a real difference. |
| A26 | Fixed | The loop is gone. One family function, `markerSwapFailure` (`2-mongo-family/9-family/src/core/marker-policies.ts`), explains a failed swap. The runner (`mongo-runner.ts` `updateMarker`) and `signSpaceMarker` only map its three results to their own failure or conflict. The function belongs in the family because both a target and the family call it. The predicate belongs in the adapter because it builds a query. |
| A27 | Fixed | The error reference describes MongoDB's write guard and the `databaseUnchanged: false` case under `MIGRATION.MARKER_CAS_FAILURE`, and says when `CONTRACT.MARKER_ROW_CORRUPT` is raised after a failed write. The upgrade note describes `heldPolicies` and `markerSwapFailure`, and says "Do not retry the update". |

### New findings

#### A28 — MongoDB's adapter now has its own reading of `meta.policies`, which ADR 314 says targets do not do, and it accepts markers the framework parser rejects (medium-low)

Location: `packages/3-targets/mongo/2-adapter/src/core/migrations/mongo-control-adapter.ts` lines 55-113 (`policiesHoldExpr` and helpers); `packages/1-framework/1-core/framework-components/src/control/database-policies.ts` lines 66-74 (`PartialDatabasePoliciesSchema`, `'+': 'reject'`); ADR 314 line 48; `packages/3-targets/mongo/2-adapter/test/marker-policies.test.ts` lines 128-175.

Issue: `policiesHoldExpr` decides in the database whether a marker records the given policies. To do that it repeats the framework's rules: an absent setting means its default, `change` is compared as a set, and each setting is compared by value. ADR 314 line 48 says the framework owns the parser and the comparison, and that targets write the value "without interpreting it". For MongoDB that is no longer true. The two readings also differ: the framework schema rejects unknown keys at both levels, while the predicate only checks that `policies` and `dataProtection` are objects. A marker storing `{ change: ['migrate'], …, extra: 1 }` is unreadable to `databasePoliciesOf`, but the predicate says it holds the checked policies, and the write goes ahead. No test covers an unknown key, so only reading the code shows that the two have drifted apart.

The predicate may well be the right mechanism. MongoDB has no lock, and the write has to be guarded by the meaning of the settings, not their form. But it is a second implementation of a framework rule, and that should be stated and kept narrow.

Suggestion: make the predicate reject unknown keys in `policies` and `dataProtection`, as the schema does. Build its key list from the framework's exports instead of literals, and add the unknown-key case to the adapter's test table. Change ADR 314 line 48 to say that MongoDB, which has no lock, also expresses the comparison as a query predicate on the marker write, built from the framework's key, value lists and defaults.

#### A29 — A marker changed and then restored is reported as a moved storage hash, although the hash did not move (low)

Location: `packages/2-mongo-family/9-family/src/core/marker-policies.ts` lines 8-9 and 39-41 (`case 'held'` returns `storageHashMoved`); `mongo-runner.ts` `storageHashMovedFailure`.

Issue: When the swap fails but the marker read afterwards holds both the expected hash and the checked policies, another process changed the marker and put it back in between. The function reports this as `storageHashMoved`, so the runner returns `MIGRATION.MARKER_CAS_FAILURE` with `reason: 'storageHash'` and equal `expectedStorageHash` and `foundStorageHash`. The doc comment explains this, but the result's name says something that did not happen, and the error reference does not cover the case.

Suggestion: name the result for what the code knows, "the marker changed under the swap". For example, rename the arm `markerChanged` and keep `found`. Add one sentence to the error reference: the found hash can equal the expected one when another process changed the marker and restored it.

#### A30 — One value has three names on its way to the MongoDB marker write (low)

Location: `MigrationRunner.execute` `expectedDatabasePolicies`; `MongoMigrationRunnerExecuteOptions.checkedPolicies` (`mongo-runner.ts` line 127) and `signSpaceMarker`'s `checkedPolicies`; `MarkerOperations.updateMarker` and `markerSwapFailure` `heldPolicies`; `MarkerSwapFailure` arms repeat it as `checked`.

Issue: The same `DatabasePolicies` value is called "expected", "checked" and "held" across four hops. The `policiesMoved` and `policiesUnreadable` arms also return `checked`, which is just the argument the caller passed. Each name makes sense where it is used, but a reader following the value has to work out that they are one thing.

Suggestion: use `checkedPolicies` from the runner down to the adapter, keeping "held" only for the comparison result. Drop `checked` from the `MarkerSwapFailure` arms, since the caller already has it.
