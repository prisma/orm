# Project plan — Migration statements

**Spec:** [`spec.md`](./spec.md) · **Linear:** [Destructive changes need stated intent](https://linear.app/prisma-company/project/destructive-changes-need-stated-intent-7626c0107cd9), plan issue [TML-3474](https://linear.app/prisma-company/issue/TML-3474)

## At a glance

| Slice | What it delivers | Builds on | State |
| --- | --- | --- | --- |
| 1 | `--rename` for models and fields, Postgres and SQLite | — | Merged, prisma/orm#30638 |
| 2 | Data loss refused until answered; `--delete`, `--allow`; the interactive prompt | 1 | Merged, prisma/orm#30648 |
| 3a | `--convert` and `--backfill`, Postgres and SQLite | 2 | Spec: [`slices/convert-backfill/`](./slices/convert-backfill/spec.md) |
| 4a | Renames and deletes on MongoDB | 2 | Spec: [`slices/mongo-renames/`](./slices/mongo-renames/spec.md) |
| 4p | MongoDB contracts written in TypeScript get the same validator as PSL; removes 4a's temporary refusal | 4a | Next after 4a |
| 3b | The remaining SQL renames and deletes | 3a | Not started |
| 4b | `--convert`, `--backfill` and value object renames on MongoDB | 3b, 4a | Not started |
| Stored-name renames, PR 1 | A model, field or enum member that keeps its name while its stored name or value changes is renamed with no question, on PostgreSQL and SQLite; the refusals of swaps, chains and takeovers; ADR 324 | — | Built on `tml-3839-stored-name-renames`, in review. Spec: [`slices/stored-name-renames/`](./slices/stored-name-renames/spec.md) |
| Stored-name renames, PR 2 | The same on MongoDB | PR 1 | Not started |

```text
1 → 2 ─┬─ 3a ── 3b ─┐
       └─ 4a ───────┴─ 4b → close-out
```

- 3a and 4a run in parallel now.
- Each slice is one pull request against `main`.
- Slices 3 and 4 were split on 2026-10-08. Each was too large to review as one pull request.

## Slices still to build

### 3a — `--convert` and `--backfill` on Postgres and SQLite

**Linear:** [TML-3477](https://linear.app/prisma-company/issue/TML-3477) · **Spec:** [`slices/convert-backfill/spec.md`](./slices/convert-backfill/spec.md)

- A lossy type change is answered with `--convert` (fill in the conversion) or `--delete`.
- `--backfill` writes a slot to fill existing rows of a field that became required.
- `migration plan` stops writing placeholders nobody asked for.
- A new required field gets a temporary value on both targets. SQLite lacks this today.
- The `SET NOT NULL` failure names the NULL rows (TML-3517).

**Hands to 3b and 4b:** the two flags and how their questions and placeholders work.

### 4a — Renames and deletes on MongoDB

**Linear:** [TML-3478](https://linear.app/prisma-company/issue/TML-3478) · **Spec:** [`slices/mongo-renames/spec.md`](./slices/mongo-renames/spec.md)

- A model rename renames the collection. A field rename rewrites the documents.
- Removing a field is asked about. `--delete` removes it from every document.
- Both commands, including `db update`.
- The temporary setting that makes MongoDB refuse renames is deleted.

**Hands to 4b:** a MongoDB planner that takes statements.

### 4p — TypeScript MongoDB contracts get the PSL validator

**Linear:** [TML-3553](https://linear.app/prisma-company/issue/TML-3553) · **Folder:** [`slices/mongo-ts-validator/`](./slices/mongo-ts-validator/investigation.md)

Decided by Will on 2026-10-12: contracts written in either form must behave the same, and this slice comes right after 4a, before 3b and 4b. Two pull requests:

1. The validator derivation moves into `@internal/mongo-contract`. No output changes.
2. The TypeScript builder calls it. 4a's temporary refusal goes. An upgrade fragment covers the closed validator TypeScript users gain.

**Why now:** without a validator, a TypeScript contract's field names are not in its storage hash, so a MongoDB field rename on it gives a migration `db migrate` refuses. 4a refuses that case for now.

### 3b — The remaining renames and deletes on Postgres and SQLite

**Linear:** [TML-3537](https://linear.app/prisma-company/issue/TML-3537) · **Folder:** `slices/remaining-nouns/`

- `--rename` for enum values, namespaces and fields inside value objects. This slice builds the statement support for value objects, which 4b reuses.
- Moving a model to another namespace (`alter table set schema` on Postgres).
- `--convert` on a variant whose discriminator value changed.
- `--delete` on an enum value: sets it to NULL where the field is optional, otherwise refuses.
- `--delete` on a variant stored in its base's table: deletes its rows and drops its columns. The refusal says rows are deleted.
- `--delete <namespace>` answers every question for the models in it.
- The `allow` question and its types use family-neutral words (Will, 2026-10-19). The CLI asks "would widen who can read and write its data", not "its rows". The framework doc comments drop the row-level-security examples. `accessWidening` is renamed `accessChanges`, because it also lists changes that do not widen access, such as dropping a policy. This touches the framework, the CLI and the Postgres target.

**Risk to settle in its spec:** a value object can contain itself (ADR 178's `NavItem.children`). Renaming a field inside it means rewriting to any depth, which a fixed SQL JSON expression or MongoDB update cannot do.

**Hands to:** close-out for Postgres and SQLite.

### 4b — `--convert`, `--backfill` and value object renames on MongoDB

**Linear:** [TML-3538](https://linear.app/prisma-company/issue/TML-3538) · **Folder:** `slices/mongo-convert-backfill/`

- The same two flags as 3a, writing a data transform with a placeholder.
- Making a field required on a collection with documents is no longer silent. It is answered with `--backfill`, or the command says the existing documents need the field.
- Renaming a field inside a value object rewrites the embedded documents, including lists, dictionaries and unions.
- Removing a variant model is data loss: today its documents stay and fail every update. `--delete <Variant>` deletes the documents with that discriminator value, as 3b does for SQL rows.

**Hands to:** close-out for MongoDB.

### Alongside — a changed stored name is a rename

Will asked on 2026-10-07 for a critical discussion, with prior art, before any syntax for naming storage objects was chosen. He decided on 2026-11-18 that no such statement is needed now: a model, field or enum member with the same name in both contracts is the same object, and the planner renames its storage with no statement. The discussion and the decision are in [`storage-naming.md`](./storage-naming.md); the design is in [`slices/stored-name-renames/spec.md`](./slices/stored-name-renames/spec.md).

- **Linear:** [TML-3839](https://linear.app/prisma-company/issue/TML-3839) (PostgreSQL and SQLite), [TML-3840](https://linear.app/prisma-company/issue/TML-3840) (MongoDB).
- Two pull requests, the SQL family first, then MongoDB.
- A statement that names storage stays deferred (see [`deferred.md`](./deferred.md)).

## Delivered: the interactive prompt

Recorded on 2026-10-06 as the stretch goal: when a human runs the command in a terminal, the refusal becomes a question per operation, and the answer is the same statement the flags take. Slice 2 built it on the CLI engine's statement prompt (prisma/prisma-cli#337). Scripts, agents and CI get the refusal that names the flags.

## Close-out (required)

- [ ] Verify every project DoD item in [`spec.md`](./spec.md)
- [ ] Final retro
- [ ] Write the ADR and amend ADR 001, ADR 028 and the Data Contract and Migration System subsystem docs
- [ ] Migrate long-lived docs into `docs/`
- [ ] Strip repo-wide references to `projects/migration-statements/**`
- [ ] Delete `projects/migration-statements/`
