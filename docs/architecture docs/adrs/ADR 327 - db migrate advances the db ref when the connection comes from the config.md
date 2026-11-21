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

`db migrate` takes its connection from `prisma.config.ts` and the `CI` environment variable is unset, so after the apply it moves the `db` ref to the contract the database is now at. The second `migration plan` starts from there and plans only the avatar change.

Before this decision, `db migrate` never moved the `db` ref unless `--advance-ref db` was passed. Without the flag the ref still named the contract from before `add_phone`, so the second plan repeated the phone change. Nothing reported it: the ref existed, it was only stale. Applying the repeated migration then failed with `MIGRATION.PATH_UNREACHABLE`, or did nothing because every postcheck already held, and the migration file was wrong either way.

## Decision

`db migrate` follows the rule `db init` and `db update` already have, with one addition for pipelines:

| Situation | Ref advancement |
| --- | --- |
| Connection from `prisma.config.ts`, `CI` unset | Advance `db` |
| Connection from `prisma.config.ts`, `CI` set to any value but `false` | None |
| `--db <url>` | None |
| `--advance-ref <name>` | Advance `<name>` instead, in every case above |
| `--no-advance-ref` | None |

`--advance-ref` together with `--no-advance-ref` is refused with `CLI.ADVANCE_REF_ARG_CONFLICT`, as on `db sign`. The two flags are the ones `db sign` already has.

CI is detected by the CLI engine, which also uses it to turn off telemetry and prompts: the `CI` variable, the other conventional variables `ci-info` checks, and the variables of each CI provider it knows. `CI=false` turns detection off.

A ref that cannot be written after the apply, for example on a read-only filesystem in a deploy image, is a warning and the command exits 0. The warning is the diagnostic `MIGRATION.MIGRATE_REF_NOT_WRITTEN` on the successful result, with `migration ref set <name> <hash>` as its next action. The migrations have already applied at that point, and failing after the apply is the worst order to fail in. The ref name is still checked and the snapshot's `contract.d.ts` still rendered before anything is applied, as for `db init` and `db update`, so a ref that could never be written refuses the run before it changes the database.

## Why ADR 218's reason no longer holds

ADR 218 kept `migrate` explicit so that a deploy or CI run never writes a file into the repository. Two things make the default safe without that:

- The rule that a `--db` connection never advances a ref already exists for `db init` and `db update`. A pipeline that passes `--db` is untouched.
- A pipeline that reads its URL through `prisma.config.ts` is untouched too, because the CLI already detects CI.

## Consequences

- The `db` ref follows the development database whether it is moved by `db update` or by `db migrate`, so `migration plan` starts from the right contract by default.
- The docs no longer tell readers to pass `--advance-ref db` on every development `db migrate`, and lose the paragraph on recovering when they forget it.
- A program that runs `db migrate` from `prisma.config.ts` outside CI and commits the result back to the repository now commits a moved `db` ref. No such setup is known. It passes `--no-advance-ref`.

## Alternatives considered

- **Keep advancement opt-in and warn when the ref is stale.** The warning would arrive at `migration plan`, after the developer has moved on, and would still need the flag to fix. It treats the symptom.
- **Advance the ref even with `--db`, as `db sign` does.** `db sign` advances under `--db` because adopting a database normally names it with `--db`. A `db migrate` with `--db` is usually a deploy to another database, whose contract is not the development database's.
- **Fail the command when the ref cannot be written.** `db sign` does this, because signing is cheap to repeat. A migration is not: the database has already moved, and a failure tells a pipeline to retry an apply that has already happened.
