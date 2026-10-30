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
