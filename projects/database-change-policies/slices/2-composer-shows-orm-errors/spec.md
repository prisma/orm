# Slice: deploy shows Prisma ORM's own migrate errors

## Outcome

When the deploy step's `migrate` fails, the user sees Prisma ORM's error as the ORM's own CLI shows it: its code, summary, why, next actions and docs link. Composer no longer writes its own text for these failures. `noPathRefusal` is deleted, and the codes `MIGRATION_PATH_NOT_FOUND` and `RUNNER_FAILED` are gone; the error's `code` is the ORM's code, such as `MIGRATION.MARKER_MISMATCH`. The codes for failures Composer finds itself (`CONTRACT_INVALID`, `CONTRACT_ARTIFACT_UNREADABLE`, `CONTRACT_IDENTITY_MISMATCH`, `TARGET_REF_NOT_FOUND`) stay as they are. A failed migrate, returned or thrown, throws `PrismaOrmError`, a subclass of the foundation's `CliStructuredError` built from the ORM's failure. `OrmMigrationError` is only Composer's own checks. The connection retry retries neither.

## What the user sees

The deploy settles as `DEPLOY.ENGINE_FAILED` with the converge's reasons under it. The reason line for the migration is `<ORM code>: <message>`: `PrismaOrmError` is a `CliStructuredError`, so `failureReasonOf` (after unwrapping the provider failure Alchemy wraps it in) uses its code as the tag in the framework's existing reason format (`tag: message`). `meta.reasons[].tag` carries the same code. Hashes below are shortened to `<widget>` (the database's contract) and `<gadget>` (the target).

### (a) The database's marker is not in the migration graph

Before:

```text
✘ [DEPLOY.ENGINE_FAILED] Alchemy could not deploy the app.
OrmMigrationError: Prisma ORM migrate (RUNNER_FAILED): MIGRATION.MARKER_MISMATCH: The database is at a contract that is not in the migration graph
```

After:

```text
✘ [DEPLOY.ENGINE_FAILED] Alchemy could not deploy the app.
MIGRATION.MARKER_MISMATCH: The database is at a contract that is not in the migration graph
  why: The database's marker names <widget>, which no migration in migrations/app starts or ends at. A migration it applied was planned again or deleted, or `db update` moved it to a contract no migration ends at.
→ Unless this database changes only through migrations, as production does, move it with db update; its data stays:
→ Preview the changes: prisma db update --dry-run --db <url>
→ Reconcile the database: prisma db update --db <url>
→ Otherwise plan a migration from the empty contract to its current contract, then one to <gadget>, and deploy again.
```

### (b) No authored path to the target

Before (fresh database, no migrations):

```text
OrmMigrationError: Prisma ORM migrate (MIGRATION_PATH_NOT_FOUND): The database carries no schema marker and the committed migrations/ directory has no authored path from empty to the target — the deploy pipeline only replays authored migrations, it never creates schema itself. Iterating locally? Bring the database along with `prisma db update`. Shipping? Author the migration path — `prisma contract emit && prisma migration plan --name <slug>` (baseline first if the migration graph is empty) — and commit migrations/. (No on-disk migrations for contract space "app")
```

After (database at `<widget>`, target `<gadget>`, no edge between them):

```text
MIGRATION.PATH_UNREACHABLE: Current contract has no planned migration path
  why: No migration edge connects the current state "<widget>" to the target "<gadget>" in contract space "app". The on-disk migration graph does not join the two, and migrate replays existing edges — it never invents one.
→ Plan the missing edge: prisma migration plan --from <widget> --to <gadget> --name <slug>
→ Apply it: prisma db migrate --to <gadget>
→ A rollback (reverse) plan is expected to contain destructive (DROP) operations — review them before applying
→ Plan a rename with --rename old:new; re-adding a required field without a safe default, or a type change that needs data, may need you to fill in the planned migration.ts
→ Inspect the on-disk graph: prisma migration list
→ Inspect a bundle in the path you expected: prisma migration show <bundle>
```

### (c) A migration fails while it applies

Before:

```text
OrmMigrationError: Prisma ORM migrate (RUNNER_FAILED): MIGRATION.EXECUTION_FAILED: Operation table.Widget failed during execution: divide by zero
```

After:

```text
MIGRATION.EXECUTION_FAILED: Operation table.Widget failed during execution: divide by zero
  why: division by zero. The failed apply changed nothing.
→ Resolve the cause the failure names, then re-run `prisma db migrate --db <url>`
  docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.EXECUTION_FAILED
```

The ORM decides where `--db <url>` appears: it adds it to `db update` and to the label in (c), but not to `db migrate --to` in (b).

## Design

- `applyOrmMigration` turns a failed `migrate` result, or a structured error `migrate` throws, into `PrismaOrmError`. It carries the ORM's code as `code`, its why as `why`, its advice (each next action as `label: command`, or the lines of its `fix` when it has no next actions) as `fix`, and its docs link as `docsUrl`; `toEnvelope()` is the foundation's. Its message is the ORM's summary, then `  why: …`, then one `→ label: command` line per next action, then `  docs: …`, in the layout the CLI engine uses for a diagnostic. When the failure carries no next actions, each line of its `fix` is one `→` line, as the ORM's CLI does. This is close to, not exactly, what `prisma db migrate` prints: there the engine also fills in a docs link from the ORM family's docs base URL for codes whose error carries none, and the deploy shows a docs link only when the ORM's error carries one.
- The message is the only part of a provider error that reaches the user, on all four paths: the `deploy` summary (`DEPLOY.ENGINE_FAILED`), the `dev` rebuild message, the `--report` file (`meta.engineCause`, `meta.reasons`) and the platform build's `errorMessage`. Each is built from `failureReasonOf`'s tag and message through `convergeReasonsText`; none reads a structured error's `why` or `fix`. So the message repeats the why and the advice, and that small formatting stays in `PrismaOrmError`. Rendering `why` and `fix` in the framework CLI instead is the open system-design question about where the renderer lives.
- `{bin}` in the ORM's text is replaced by `prisma` when the message is written. The engine replaces `{bin}` only in the final error's summary, why and next actions; the same text also reaches `dev`'s rebuild messages, the `--report` file and the platform build's error message, which nothing rewrites. Composer's commands are mounted in the `prisma` CLI next to the ORM's, and Composer's other user-facing text already names `prisma` (for example `prisma project env add` in preflight), so `prisma` is the name the engine would substitute.
- `invocation.dbGiven` is now `true`. The database a deploy migrates is the one Composer provisioned, not the one `prisma.config.ts` names, so a printed `prisma db update` must carry `--db <url>` or it would run against the wrong database. The ORM uses `dbGiven` only to decide whether to print `--db <url>`.
- `invocation.configPath` is the database resource's `prisma.config.ts`, relative to the working directory, and left out when it is `prisma.config.ts` there. A module's config can sit in the module's directory, and the ORM's commands find only the one in the working directory.
- The converge failure cause was capped at 1000 characters, which cuts the next actions off the path and schema errors. The cap rises to 4000, which still fits the platform build's 5000-character `errorMessage` with the summary line in front.

## Decided without the operator

- Render next actions (not `fix`) when both exist, as the CLI engine does; `fix` only as a fallback.
- `prisma` as the binary name, `dbGiven: true`, and the resource's config as `--config`, as above.
- Raise the cause cap in the framework CLI from 1000 to 4000 characters.
- Errors `migrate` throws (rather than returns), such as `MIGRATION.NO_INVARIANT_PATH`, are converted the same way and not retried. Checked against the ORM at rc.24: its connection failures carry `DRIVER.*` codes, a raw driver error has no dotted code, and a failed marker read wraps whatever the driver threw in `CONTRACT.MARKER_READ_FAILED`; those three keep being retried.
- A deploy pinned to a ref passes `rerunArgs: ['--to', <ref>]`, so the re-run advice keeps the ref.
