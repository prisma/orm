# ADR 327 — db migrate advances the db ref when the connection comes from the config

**Status:** Accepted
**Date:** 2026-11-22
**Domain:** Migration System
**Supersedes:** the `migrate` row of [ADR 218](ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md)'s asymmetric ref-advancement table, and its rejected alternative "Implicit `db` ref advancement on `migrate`"

## At a glance

A developer plans a migration, applies it, and plans the next one:

```bash
prisma migration plan --name add_phone
prisma db migrate
prisma migration plan --name add_avatar
```

`db migrate` takes its connection from `prisma.config.ts` and the CLI does not detect CI, so after the apply it moves the `db` ref to the contract the database is now at. The second `migration plan` starts from there and plans only the avatar change.

Before this decision, `db migrate` never moved the `db` ref unless `--advance-ref db` was passed. Without the flag the ref still named the contract from before `add_phone`, so the second plan repeated the phone change. Nothing reported it: the ref existed, it was only stale. Applying the repeated migration then failed with `MIGRATION.PATH_UNREACHABLE`, or did nothing because every postcheck already held, and the migration file was wrong either way.

## Decision

`db migrate` follows the rule `db init` and `db update` already have, with one addition for pipelines:

| Situation | Ref advancement |
| --- | --- |
| Connection from `prisma.config.ts`, CI not detected | Advance `db` |
| Connection from `prisma.config.ts`, CI detected | None, and the run says so |
| `--db <url>` | None |
| `--advance-ref <name>` | Advance `<name>` instead, in every case above |
| `--no-advance-ref` | None |
| The run ends at the empty contract, no `--advance-ref` | None; `db` is left unchanged, and the run says so |
| The run ends at the empty contract, `--advance-ref <name>` | Refused before anything is applied |

`--advance-ref` together with `--no-advance-ref` is refused with `CLI.ADVANCE_REF_ARG_CONFLICT`, as on `db sign`. The two flags are the ones `db sign` already has.

The CLI engine decides whether it runs in CI, with `ci-info`'s rules applied to the environment the engine was given: CI is detected when the `CI` variable is set to anything but `false`, or when a variable that CI services set is present, such as `BUILD_NUMBER`, `BUILD_ID` or `GITHUB_ACTIONS`. The engine also uses this decision to choose whether to prompt. The CLI's telemetry reads the same rules through its own helper. A developer's shell, or a `.env` file that `prisma.config.ts` loads (for example with `import 'dotenv/config'`), can set one of these variables, so when CI detection is the only reason `db` is not advanced, the run reports the `info` diagnostic `MIGRATION.REF_NOT_ADVANCED_IN_CI`. That notice fires on every ordinary CI run too, so it is written for the developer it helps: on a development machine, unset the variable or set `CI=false`, or advance `db` now with `--advance-ref db`; in a pipeline, `--no-advance-ref` silences it. The engine does not say which variable it matched, so the notice cannot name it.

After a rollback with `--to <dir>^`, `db` names the contract the rollback applied, as after any other apply: it records where the development database is. The exception is a rollback to the empty contract, for example `--to @empty` or `--to <first migration>^`. A ref cannot name the empty contract (`migration ref set` refuses it with `MIGRATION.REF_SET_EMPTY_SENTINEL`), so `db migrate` leaves `db` unchanged and reports the `info` diagnostic `MIGRATION.REF_NOT_ADVANCED_TO_EMPTY`, whose next action is `migration ref delete db`. With no `db` ref, the next `migration plan` asks where to start rather than starting from a contract the database is not at. This notice replaces the CI notice, because CI is then not the only reason. With an explicit `--advance-ref <name>`, the ref could never be written, so the run is refused before anything is applied, with `MIGRATION.REF_TARGET_EMPTY`.

Deleting `db` automatically after a rollback to the empty contract was considered and left out. It would match the meaning of "no `db` ref", but deleting a tracked file is a change to the repository that issue prisma/orm#30370 did not decide, and the notice lets the developer make it with one command.

A ref that cannot be written after the apply, for example on a read-only filesystem in a deploy image, is a warning and the command exits 0. The warning is the diagnostic `MIGRATION.REF_NOT_WRITTEN` on the successful result. It carries the failing error's code as `causeCode`. Its next action writes the ref later: `migration ref set <name> <hash>` when the store already held the snapshot, and otherwise the same `db migrate` with `--advance-ref <name>`, which applies nothing and writes the snapshot and the ref, since `migration ref set` needs the snapshot to exist. The migrations have already applied at that point, and failing after the apply is the worst order to fail in.

Before anything is applied, the ref name is checked, and an explicit ref with an empty-contract target is refused. The snapshot's `contract.d.ts` is rendered then too, but only when the store has no entry for the target's hash; a migration's destination already has one, written by `migration plan`, so the default path renders nothing and adds no way to fail. So an invalid ref name, a ref to the empty contract, or a contract that cannot be snapshotted refuses the run before it changes the database. After the apply, the pointer is written only if the store holds the snapshot for the hash the database ended at; otherwise that is the warning above. A directory that cannot be written is found only after the apply, and is the warning above.

## Why ADR 218's reasons no longer hold

ADR 218 rejected this with three reasons.

**"`migrate` is generic — deploy, CI apply, rollback rehearsal — and must not infer dev-state intent."** The command does not infer intent from what it applies; it reads where the connection comes from. `db.connection` in `prisma.config.ts` is the project's own definition of its development database, and `db init` and `db update` already treat it that way. A deploy or a CI apply that passes `--db`, or runs where the CLI detects CI, writes no ref; a deploy that does neither writes `db` unless it passes `--no-advance-ref` (see Consequences). A rollback rehearsal on the development database moves `db` back with it, which is what `db` is for: it records the contract that database is at.

**Implicit advancement "would make `db` behave like a magic reserved ref".** It makes `db` less special. Before, `db` moved after `db init`, `db update` and `db sign` but not after `db migrate`, so whether it was current depended on which command last touched the database. Now every command that changes the configured database moves it the same way. `db` keeps its storage, carries no protection, and can still be set with `migration ref set`.

**It would "blur the boundary between 'apply migrations' and 'record dev iteration state'".** The boundary ADR 218 protects is between a database's history and the repository's record of the development database. That boundary stays where the connection is chosen: a run against the configured development database records where it is, and a run against any other database records nothing. The control API's `migrate`, which Composer deploys call, never writes a ref.

## How the other ref-writing commands differ

| Command | Suppressed by `--db` | Suppressed in CI | Ref write fails after the database changed |
| --- | --- | --- | --- |
| `db init`, `db update` | yes | no | command fails |
| `db migrate` | yes | yes | warning, exit 0 |
| `db sign` | no | no | command fails (`MIGRATION.SIGN_REFS_NOT_WRITTEN`) |

- `db sign` advances under `--db` because adopting a database normally names it with `--db`. It fails on a failed write because signing is cheap to repeat: a second run writes only the refs.
- `db init` and `db update` ignore CI and fail on a failed write because issue prisma/orm#30370 decided only `db migrate`, the command most pipelines run. The reasons given here for `db migrate` apply to them too: they also run in pipelines from the config, and they also change the database before they write the ref. Giving them the CI rule and the warning is follow-up work, not part of this decision.

## Consequences

- The `db` ref follows the development database whether it is moved by `db update` or by `db migrate`, so `migration plan` starts from the right contract by default.
- The docs no longer tell readers to pass `--advance-ref db` on every development `db migrate`, and lose the paragraph on recovering when they forget it.
- A deploy that runs `db migrate` from `prisma.config.ts` outside a detected CI runner now writes `migrations/app/refs/db.json`. That covers a container entrypoint, a Kubernetes job, a release command such as Fly's `release_command`, and a deploy script on a server checkout. In a throwaway container the write is harmless, or is the read-only warning. On a persistent checkout it changes the tracked file, and the next `git pull` that touches it refuses. Such a deploy passes `--no-advance-ref`, or names its database with `--db`. A job that commits its results back to the repository does the same.

## Alternatives considered

- **Keep advancement opt-in and warn when the ref is stale.** The warning would arrive at `migration plan`, after the developer has moved on, and would still need the flag to fix. It treats the symptom.
- **Advance the ref even with `--db`, as `db sign` does.** A `db migrate` with `--db` is usually a deploy to another database, whose contract is not the development database's.
- **Fail the command when the ref cannot be written.** `db sign` does this, because signing is cheap to repeat. A migration is not: the database has already moved, and a failure tells a pipeline to retry an apply that has already happened.
