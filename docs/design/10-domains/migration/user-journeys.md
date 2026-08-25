# Migration user journeys

The load-bearing user journeys the migration surface is designed around. Each names the persona, the question they are trying to answer, the verb sequence, and where the journey is exercised end-to-end.

Treat this doc as a companion to the [domain README](./README.md): the README defines the vocabulary; this doc shows the vocabulary in use, sequenced into the workflows real users walk through. Pathological / single-feature regression scenarios (drift edge cases, resolver internals, single-verb integration probes) live in the `test/integration/test/cli-journeys/` suite but are not catalogued here — they are not load-bearing as user stories.

The journeys are grouped by the user's *posture*, not by namespace:

- **Authoring** — at a keyboard, evolving the contract
- **Operating** — actually changing a live database
- **Reading** — interrogating the state of things
- **Adopting** — bringing pre-existing state into the migration graph
- **Recovering** — undoing or reconciling history

The CLI verb taxonomy ([namespacing rule](./README.md#namespacing-rule-subject-not-surface)) intentionally cuts across postures: a single posture pulls verbs from several namespaces. That is correct — the namespaces describe what a verb's *subject* is, not what the user's posture is.

---

## Authoring

### Bootstrap a new project

**Persona:** application developer starting fresh.
**Question:** "How do I get from `pnpm init` to a project that can talk to a database?"

```bash
prisma orm init        # scaffold project (schema.psl, config, etc.)
contract emit           # produce contract.json + contract.d.ts
db init                 # lay down marker + ledger tables in an empty DB
```

After `db init` the database is signed against the initial contract and ready for either dev iteration (`db update`) or first-migration authoring.

**Exercised by:** `test/integration/test/cli-journeys/init-journey.e2e.test.ts`, `greenfield-setup.e2e.test.ts`.

### Dev inner loop

**Persona:** application developer iterating on the schema.
**Question:** "I'm changing the contract often; how do I keep my local DB in sync without producing migration files I'd throw away?"

```bash
# edit schema.psl or the TS contract
contract emit
db update               # off-graph reconciliation; rebuild from desired state
```

`db update` is *not* the dev-DB equivalent of `migrate`. It does not produce a migration and does not walk the graph. It tears down and rebuilds the database to satisfy the current contract, and on the default dev URL it advances the `db` ref to record the contract the dev database now satisfies — the checkpoint `migration plan` chains from (see [ADR 218](../../../architecture%20docs/adrs/ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md)). That makes it the right verb during iteration (no junk migrations in the PR) and the wrong verb for anything reaching production (no audit trail; destructive).

A rewind during iteration is also `db update --to <contract>` — same verb, parameterised by target.

**Exercised by:** `db-update-workflows.e2e.test.ts` (Direct + Destructive), `interleaved-db-update.e2e.test.ts`.

### Plan and promise

**Persona:** application developer ready to commit a schema change to a PR.
**Question:** "I'm done iterating; how do I turn this dev state into a migration the team can review, and declare 'this PR advances production to the new state'?"

```bash
# contract.json reflects the new desired state
migration plan --advance <ref>  # diff the ref's contract against current,
                                # scaffold the migration package,
                                # advance the ref in one act
# review the generated migration.ts, edit ops if needed
migration compile               # lower migration.ts -> ops.json (if you edited)
```

This is the "freeze + promise" verb: producing the migration package and writing the ref pointer are one act, committed in one PR. `ref set` exists as the rarely-used direct-write escape hatch (creating a new ref, or correcting a wrong pointer after the fact) — the normal authoring path is `migration plan --advance <ref>`.

`migration new` is the sibling for hand-authored migrations: scaffolds an empty package with `from`/`to` set, ops blank, ready for the user to write by hand.

> **Status:** `--advance <ref>` is the resolved authoring path in the domain model but is not yet implemented in `migration plan`. Tracked under [TML-2560](https://linear.app/prisma-company/issue/TML-2560).

**Exercised by:** `schema-evolution-migrations.e2e.test.ts`, `multi-step-migration.e2e.test.ts`, `migration-plan-details.e2e.test.ts`, `migration-round-trip.e2e.test.ts`.

---

## Operating

### Migrate a database to a ref

**Persona:** operator running CD, or application developer pointing a fresh DB at a known state.
**Question:** "Where should this database be, and how do I get it there?"

```bash
migrate --to <ref>      # walk the graph from marker to the ref's contract,
                        # execute each migration on the path
```

This is the dominant CD operation. The verb is dead-simple by design: the *only* question the verb answers is "what state should the DB be in?", and the answer is a ref name. The directional vocabulary (`--to`) is reserved for `migrate`; signing the marker is a static claim and uses different vocabulary ([see `db sign`](./README.md#verbs)).

`migrate` is forward-only. It walks the directed graph from the current marker to the ref. Backward motion is not a `migrate` mode — that's `db update --to <contract>` (off-graph rebuild, destructive, dev-only).

**Exercised by:** `schema-evolution-migrations.e2e.test.ts`, `multi-step-migration.e2e.test.ts`, every journey that lands a real schema change.

### Continuous deployment

**Persona:** CD pipeline (or the operator monitoring it).
**Question:** "What will run on merge, and is that what we want?"

The CD signal is a three-part flow:

```bash
migration check         # graph integrity: every migration self-consistent,
                        # every edge's from/to lines up, no orphans,
                        # no dangling refs. Read-only, no DB.
migration status --from <contract>  # offline preview of the deploy path
migrate --to production  # the actual execution
```

The preview is required to be **rock solid** — it is the go/no-go signal. `migration check` covers artifact and graph integrity; `migration status --from` previews the deploy path. Both are fully offline: diffing runs against on-disk contract snapshots, so there is no sandbox execution and no shadow database will ever exist. The behavioural half of the question is enforced at apply time — the runner checks each operation's pre/post invariants and the destination hash, and refuses to advance the marker on violation.

**Exercised by:** `migration-check.e2e.test.ts` (integrity); the operational side rolls up through every end-to-end migration journey.

---

## Reading

### Status landing

**Persona:** anyone wondering what's going on.
**Question:** "Where is this database right now, and what's pending?"

```bash
migration status                   # the single landing pad
migration status --to <ref>        # path & pending against a target
migration status --from <contract> # offline mode; ignore the live DB
```

This is the load-bearing CI/CD question and the most-likely "I just got dropped into a repo and want to orient myself" verb. It is live but offline-capable via `--from`.

**Exercised by:** `migration-status-diagnostics.e2e.test.ts`.

### Pre-deploy review

**Persona:** db admin (or reviewer in PR review).
**Question:** "What's about to run against the database, and what does each step do?"

```bash
migration log                # applied history from the ledger; live
migration list               # flat enumeration of migration packages; offline
migration graph              # relational view of the graph; offline
migration graph --dot        # DOT output for renderers
migration show <m>           # single migration's full detail; offline
```

These four verbs answer different shapes of the same question — they share a common subject (migrations and their relationships) but differ in framing. Each verb's `--help` cross-references the others under a *See also* section so the reader can pivot quickly.

**Exercised by:** the catalogue above is exercised piecewise by `migration-graph-dot.e2e.test.ts`, `migration-show-reachability.e2e.test.ts`, and the various journey tests that print logs.

### Verification

**Persona:** anyone before doing something risky, or after suspecting something is wrong.
**Question:** "Is the world in the state I think it's in?"

Two distinct verification verbs, two distinct questions:

| Verb | What it verifies | Touches live DB? |
|---|---|---|
| `db verify` | Live DB satisfies its contract | Yes (read-only) |
| `migration check [<m>]` | Migration artifact / graph integrity | No |

The two are deliberately separately named — sharing `verify` across both would make "which verification?" the question at every call site. There is no sandbox-execution verb: no shadow database will ever exist, so a migration's behaviour is enforced during the real apply (pre/post invariants, destination-hash check), not previewed in a sandbox. See the [glossary entry for `migration check`](../../../glossary.md#migration-check) for the per-PN-code breakdown of what graph-integrity covers.

**Exercised by:** `migration-check.e2e.test.ts`.

---

## Adopting

### Brownfield: bring an existing database into the graph

**Persona:** application developer adopting Prisma Next on a database that already has schema and data.
**Question:** "I have a real database with real tables. How do I start managing it with migrations without nuking it?"

```bash
# point the CLI at the existing DB
contract infer            # introspect -> derive a contract that matches the DB
# review/edit the inferred contract.json
db sign                   # write the marker: 'this DB satisfies <contract>'
# from here, the normal author + migrate flow applies
```

The contract becomes the graph's root node (an `∅`-from migration is not produced — brownfield contracts simply exist as graph nodes the marker points at). Subsequent contract changes go through the normal `migration plan` / `migrate --to <ref>` flow.

Step-count ergonomics for this path are a tracked concern — the underlying steps are correct but the user-facing sequence is currently more verbs than it should be. Follow-up: [TML-2561](https://linear.app/prisma-company/issue/TML-2561) (brownfield adoption ergonomics).

**Exercised by:** `brownfield-adoption.e2e.test.ts` (happy path + mismatch case), `contract-infer-workflow.e2e.test.ts`.

### Adopting migrations on production

**Persona:** operator enabling the migration workflow on a database that's been running without it.
**Question:** "We've been using `db update` (or no Prisma Next at all) on production; how do we switch to managing it with migrations from now on?"

```bash
# on the running DB
contract infer            # capture current production state as a contract
# commit the contract; review it
db sign --contract <contract>   # marker now points at the captured state
# subsequent PRs author migrations forward from this point
migration plan --advance production
```

The trick is that the production DB and the inferred contract must already match — `db sign` performs no structural changes and refuses if the DB does not already satisfy the contract. That is the safety pivot the verb is named for.

**Exercised by:** `adopt-migrations.e2e.test.ts`.

---

## Recovering

### Roll back via forward migration

**Persona:** application developer or operator whose live DB needs to go back to an earlier state.
**Question:** "We need to undo a migration that's already been applied. How?"

```bash
# in the schema
# rewrite contract back to the earlier shape (e.g. via git revert of schema)
contract emit
migration plan --advance <ref>    # produces a new forward migration
                                   # whose to-contract is the earlier shape
# review the generated ops carefully; they describe how to *undo*
migrate --to <ref>                # apply forward
```

The mental model maps to `git revert`: we never reverse-execute a migration; we author a *new forward migration* whose `to`-contract is the earlier contract. The graph stays a DAG, the ledger gets a new row, and the rollback is itself reviewable in PR.

For *dev* rewinds (no ledger entry needed), `db update --to <contract>` does the same job destructively and off-graph.

**Exercised by:** `rollback-cycle.e2e.test.ts`.

### Reconcile a divergence between branches

**Persona:** two application developers, each working on a branch off the same contract.
**Question:** "We both authored migrations from the same base; what happens when both branches merge?"

Three shapes the merge can take, all valid:

- **Converging paths** — both migrations are compatible. Either order works; the second to merge is rebased onto the new tip and gets its `from` updated. Both end up in the graph as siblings of the shared base, then one chains off the other.
- **Diamond convergence** — the graph genuinely has two paths from the same root that meet again later. The model supports this; `migration graph` shows the diamond.
- **Same-base divergence with conflict** — both migrations target the same column/table in incompatible ways. The second PR's `migration check` fails with a structured error; the author rebases the contract on top of the merged tip and re-runs `migration plan`.

The graph is content-addressed: migration hashes change when ancestry changes, but the rules for "does this migration make sense from this contract?" are encoded in the verb taxonomy (`migration check`'s PN codes), not in branch ordering.

**Exercised by:** `diamond-convergence.e2e.test.ts`, `divergence-and-refs.e2e.test.ts`.

---

## What this doc deliberately does not cover

- **Mechanics of individual verbs.** Argument grammars, exit codes, output shapes — see the [domain README](./README.md) and `prisma orm <verb> --help`.
- **The full e2e test suite.** Drift edge cases, resolver internals, single-verb regression probes, error-envelope golden tests — these live in `test/integration/test/cli-journeys/` but are not load-bearing as user stories.
- **Extension-author workflows.** Authors of new contract spaces follow a parallel surface (contract-space namespaces, pinned mirrors). That surface is captured separately in `docs/architecture docs/subsystems/7. Migration System.md`.
- **Disaster recovery and squashing.** Squashing the migration graph, baselining from `∅`, recovering from a corrupted ledger — these are operational topics tracked separately and not part of the day-to-day user surface.
