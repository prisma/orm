# System-design review: the Postgres migration runner limits each wait for a table lock

Reviewed: `wip/lock-timeout/design.md`, against issue #31182 (`issue.json`) and `prior-art-a.md` to `prior-art-d.md`.

## Verdict

**Sound with changes.** Bounding lock waits inside the runner's transaction, with a default, set by the runner itself, is the right idea and fits the project's values. Five changes are needed before building it. The setting must reach the programmatic control client and configs assembled without the target package's `defineConfig`. The runner must own `lock_timeout` for the whole transaction, including the wait for the marker lock. The error code needs a clearer name and a change to the SQL family's code list. The design must say how it relates to the advisory-lock decision record. And the upgrade note is wrong for users who already set `lock_timeout` on the connection or the role.

## What I read

- Purpose and direction: `docs/design/00-purpose/project-intent.md`, `vision.md`, the steering list in `docs/architecture docs/ADR-INDEX.md` (no entry covers lock waits, retries or runner settings).
- `docs/architecture docs/subsystems/7. Migration System.md`: Runner, Advisory Locks and Concurrency, Per-space runner, how a runner reports a failure.
- Decision records: ADR 043 (advisory locks), ADR 037 (transactional DDL fallback), ADR 239 and ADR 245 (structured errors), ADR 254 (the money and session-settings passages, "the control plane owns every statement it runs"), ADR 324 (target package assembles components in one place), ADR 159 (session settings; currying options into a descriptor), ADR 005 (thin core, fat targets), ADR 150 (config is the single source of truth).
- `docs/glossary.md` (no lock terms; nothing the design contradicts), `docs/reference/error-reference.md`.
- Rules: `never-change-the-framework-domain.mdc`, `explicit-opt-in-over-diagnostics.mdc`.
- Code: the Postgres runner and `marker-lock.ts`, `1-target/src/exports/control.ts`, the facade's `define-config.ts`, `components.ts` and `exports/control.ts`, the MySQL `marker-lock.ts`, the framework config type and the `orm` config section schema, `control-api/client.ts`, `operations/run-migration.ts`, `orm/db/prepare.ts`, the CLI's runner advice, the SQL family's runner error codes and `signSpaces`, the Postgres control adapter's `lockMarker` and introspection settings.

## Findings, most severe first

### 1. The setting does not reach the programmatic control client, nor a config assembled from the framework's `defineConfig` (high)

Verified:

- The only production place a runner is built is `packages/1-framework/3-tooling/cli/src/control-api/operations/run-migration.ts:282`, `migrations.createRunner(familyInstance)`, where `migrations` is `this.options.target.migrations` (`control-api/client.ts:394`, `437`, `542`). So the value can reach the runner only through the target descriptor the client was given. Building it into `createRunner` needs no change under `packages/1-framework`; the design's claim holds for this part.
- The CLI path works: `orm/db/prepare.ts:133-139` builds the client from `config.target`, and the `orm` section schema declares `target` with `reference(...)` (`config-loader/src/orm-section.ts:79`), so the command receives the object the config file built.
- One runner serves every contract space (`run-migration.ts:282`, `runner.execute({ perSpaceOptions })`), so extension spaces get the same value. Verified.
- `createPostgresControlClient` (`9-facade/src/exports/control.ts:32-41`) builds from `controlComponents`, the module-level singleton target (`components.ts:12-15`, from `postgresTargetDescriptor` at `1-target/src/exports/control.ts:86`). It never goes through `defineConfig`. Its options carry only `connection` and `extensions`. A script, example or test that deploys with it gets 5 seconds and cannot change it. It is a real public surface: `examples/prisma-8-demo`, `examples/supabase`, `examples/multi-extension-monorepo` and several integration tests use it.
- ADR 324 says a target package "assembles its family, target, adapter and driver in one place. Its `defineConfig` and its control client both build from that, so a command run through the CLI and a script that uses the control client are given the same components." A target built only inside `defineConfig` breaks this.
- ADR 324 also supports configs "assembled directly from the framework's `defineConfig`". The extension packages do this with the singleton (`packages/3-extensions/pgvector/prisma.config.ts` imports `@internal/target-postgres/control`). Such a config has no way to set the value.

Recommendation: the target package exports one factory that builds the Postgres control target descriptor from runner options, for example `createPostgresTargetDescriptor({ lockTimeoutMs })`, with the default export being the factory called with defaults. The facade's `defineConfig` and `createPostgresControlClient` both call it, and `PostgresControlClientOptions` gets the same option. This follows the existing pattern of currying options into a descriptor (ADR 159, "curry options into the descriptor"), and keeps ADR 324's "one place". Say in the design that the control API's `MigrateOptions` stays unchanged and why: the value is a property of the Postgres component, not of one call.

### 2. The marker lock is not "unchanged and unbounded", and the override of the session's value is only partial (high)

Verified in code: `executeOnConnection` runs `set_config('lc_monetary', …)`, then `pg_advisory_xact_lock` (`runner.ts:194-195`), and on the policies path `executeSpaces` takes the lock even earlier (`runner.ts:317-318`). The design sets the limit after that. Inferred from the Postgres documentation (not tested here): `lock_timeout` bounds a wait for any lock, advisory locks included.

Consequences:

- A session that already has `lock_timeout` (the issue's documented workaround through `PGOPTIONS` or the connection string, a role setting by a DBA, or strong_migrations' advice to `ALTER ROLE … SET lock_timeout`) bounds the marker lock wait by that value. Replicas that migrate at start-up then fail on each other after, say, 2 seconds. That is exactly the failure the design wants to avoid (#27636).
- That failure is SQLSTATE `55P03` thrown by `acquireLock`, before the limit is set. The design maps only `55P03` "from any statement after the limit is set", so this one leaves `execute` as a raw error after the rollback (`runner.ts:287-289`).
- The design says a session's `lock_timeout` "is overridden inside the runner's transaction". It is overridden only after the marker lock.

Recommendation: the runner owns `lock_timeout` for its whole transaction, as ADR 254 says the control plane does for `lc_monetary` ("The control plane owns every statement it runs, so it sets `lc_monetary=C` itself and needs nothing of the database"). Right after `BEGIN`, set it locally to `0` (no limit) for the marker lock. Once the lock is held, set the configured value. A later bound on the marker lock then changes only that first value. Do both next to every `acquireLock` call, or fold them into it. `executeOnConnection` is a public method of the SQL family's runner interface (`2-sql-family/9-family/src/core/migrations/types.ts:476`) and is called once per space, so the setting must not depend on `execute` having run first. Taking an advisory lock the transaction already holds does not wait, so repeating it per space is harmless.

### 3. The error code: name, where it is declared, and where the advice goes (medium)

Verified:

- Runner failure codes for SQL targets are a closed list in the SQL family, `SqlMigrationRunnerErrorCode` (`packages/2-sql-family/9-family/src/core/migrations/types.ts:424-433`). Adding a code changes that list. That is a family change, not a framework change, and it is fine, but the design should say so instead of only "no change under `packages/1-framework`". The framework type accepts any `MIGRATION.${string}` (`framework-components/src/control/control-migration-types.ts:388`).
- A runner failure carries only a code, a summary, `why` and `meta` (`migrationRunnerFailure`, same file, 429-445). The CLI writes `fix` and `nextActions` from typed facts only and never from a target's code (subsystem doc, "How a runner reports a failure"; `cli/src/utils/runner-failure-advice.ts:769-803`). For a new code with no typed fact, the CLI gives its general advice, "Resolve the cause the failure names, then re-run `db migrate`" (`runner-failure-advice.ts:689-693`). That advice is right for a lock timeout. So the specific advice in the design ("find the blocking session, or raise `migrations.lockTimeoutMs`") can only go in the runner's `why`. Adding a typed fact such as "safe to run again" to `MigrationRunnerFailureMeta` would change the framework domain, which needs Will's decision first. The design should choose the `why` and say so.
- The registry has `MIGRATION.MARKER_LOCK_TIMEOUT` (MySQL, the marker lock; `error-reference.md:1816-1818`). ADR 043 reserves `LOCK_UNAVAILABLE` for advisory-lock failures. `MIGRATION.LOCK_TIMEOUT` sits next to these and does not say which lock. Postgres's `lock_timeout` also covers row locks: a backfill `UPDATE` waiting for a row an application transaction holds fails the same way. So "table" in the name would be wrong too.

Recommendation: name it `MIGRATION.LOCK_WAIT_TIMEOUT`, declared in the SQL family's list so MySQL and MariaDB reuse it (MySQL reports both of its lock-wait limits as "Lock wait timeout exceeded", error 1205). In the `why`, name the operation, and the operation's table only as "the operation on table X". Do not say that table is the one whose lock was not granted: adding a foreign key also locks the referenced table, and the runner cannot ask which lock it waited for once the transaction is aborted. Update the error reference's list of runner codes (`error-reference.md:1558`) and the entry for `MIGRATION.EXECUTION_FAILED`. Today that entry says every SQL error of an alter with `using` belongs to the conversion.

### 4. The design does not say how it relates to the advisory-lock decision record (medium)

Verified: ADR 043 decides that every lock acquisition tries without waiting first, then backs off up to a 30-second ceiling, then fails with `LOCK_UNAVAILABLE`, and that migrations use session-level advisory locks. The Postgres runner does none of this. It waits without limit in `pg_advisory_xact_lock`, a lock scoped to the transaction (`marker-lock.ts:7`). The subsystem doc still says "`pg_advisory_lock`" (`7. Migration System.md`, Advisory Locks and Concurrency). MySQL bounds its marker lock at 60 seconds with `MIGRATION.MARKER_LOCK_TIMEOUT` (`mysql/1-mysql/1-target/src/core/marker-lock.ts:5, 26-34`). That limit is a constant, not a setting.

The design's reason for leaving the marker lock unbounded, that replicas are meant to wait for each other, argues against ADR 043's ceiling. Leaving the marker lock alone in this work is defensible as scope. It is a different lock with a different purpose, and the issue is about table locks. But the design should say plainly:

- that the Postgres marker lock already departs from ADR 043, and this work keeps that departure;
- that its argument for waiting would, if adopted, reverse ADR 043's ceiling for the Postgres marker lock. That belongs in its own decision record, not in a sentence here;
- that Postgres and MySQL then behave differently for replicas that migrate at start-up: MySQL fails after 60 seconds, and Postgres waits without limit.

Also record this work's own decisions in a new decision record. The project writes one when a later agent would otherwise propose the opposite (ADR-INDEX, "When to add a record"). That covers three decisions: a default limit set by the runner, the runner's value overriding the session's, and no automatic retry. Each is something a later agent will propose reversing. Update the subsystem doc's Runner and Advisory Locks sections to match.

### 5. The upgrade note is wrong for users who already set `lock_timeout` (medium)

Verified from the design text: the note says to set `0` "for the old behaviour". The old behaviour was the session's own `lock_timeout`. For the issue's workaround users, or a role with a DBA's setting, that was a limit, not `0`. After the upgrade, `0` removes their limit, and the default replaces a stricter one they chose (for example 2 seconds becomes 5).

Recommendation: the note says that a `lock_timeout` set on the connection or the role no longer applies to migration statements, and that the value to use is now `migrations.lockTimeoutMs`. The config is TypeScript, so a per-environment value can come from an environment variable in `prisma.config.ts`. With finding 2 fixed, add that such a setting no longer limits the marker lock either.

Overriding is still the right rule. ADR 254 says the control plane sets what it needs itself. Per-transaction poolers can refuse startup options they do not track (ADR 159, ADR 254 on `lc_monetary`), so a connection-level value is unreliable. And keeping the session's value would make the result depend on settings outside the project, against "Deterministic behaviour" in the project intent. The design's reason for rejecting "keep the session's value" should say this, not just "two ways to set one thing".

### 6. The config key: it leaks into the framework's section, needs validation, and its name is ambiguous (medium-low)

Verified: the facade spreads the user's `migrations` into the framework's section, `migrations: { ...options.migrations, module: … }` (`9-facade/src/config/define-config.ts:75`). The framework's `migrations` holds only `dir` and `module` (`config/src/config-types.ts:113-118`). Its schema ignores keys it does not declare, so `lockTimeoutMs` would pass into a framework-owned section unnoticed.

Recommendations:

- Take `lockTimeoutMs` out of `options.migrations` before the spread and pass it only to the factory from finding 1.
- Validate it where it enters: a non-negative integer. Refuse anything else with a structured config error, naming the field. `Number(process.env.X)` gives `NaN` for an unset variable, and Postgres would reject a negative value only at run time, as a raw error inside the migration.
- The name: in Atlas, sqitch and golang-migrate, "lock timeout" means the wait for the tool's own migration lock (`prior-art-a.md` section 6, `prior-art-b.md` sections 3 and 4). That is the marker lock here, which this setting deliberately does not cover. Keeping Postgres's own word helps people find it. If you keep it, the docs must say it does not cover the marker lock, and a later bound on the marker lock must get its own key (`markerLockTimeoutMs`). Better still, give the key the same words as the error code, for example `lockWaitTimeoutMs`.

"Composed, not configured" does not argue against the setting. That line is about the core and global flags (ADR 005). ADR 005 puts "migration operation executors and phased strategies per engine" in the target, and ADR 150 makes the config the single source, with no flags. A parameter of the Postgres component, set where the component is built, is composition. It would be configuration in the sense the project avoids if it were a framework flag or a `MigrateOptions` field.

### 7. A migration's own `SET LOCAL lock_timeout` leaks into the migrations after it (low)

Verified: Postgres migrations can contain raw SQL (`1-target/src/core/migrations/operations/raw.ts`), and every migration and space of a run shares one transaction (`runner.ts:283-301`). A user who writes `SET LOCAL lock_timeout = '30s'` for one slow migration changes the limit for every later migration in the run. Per-migration limits are the obvious next request: Flyway has per-script settings, Atlas has migration hooks, GitLab has per-migration retries (see the prior-art files).

Recommendation: either set the configured limit again at each migration's first operation (the runner already has `migrationEdges` with each migration's operation count), so a migration's own `SET LOCAL` lasts only for that migration, or document the leak. Doing the first now makes a later per-migration override a small addition, not a change of meaning.

### 8. Future non-transactional steps need their own rule (low)

Verified: ADR 037 plans steps that run outside the transaction, such as `CREATE INDEX CONCURRENTLY`. Inferred: a limit set with `set_config(…, true)` does not reach them. Through a per-transaction pooler, a session-level `SET` before such a step can land on a different server connection, or stay on one that other clients share. Tools that run concurrent index builds turn the limit off for them (safe-pg-migrations, `prior-art-a.md` section 3).

Recommendation: no redesign is needed. The design and the docs should say the setting bounds lock waits of statements inside the run's transaction, and that each future non-transactional step will state its own rule. Then the config's meaning does not promise more than the mechanism can deliver.

### 9. What the limit bounds when several waits happen (low)

Inferred from the runner's structure. The design's "What the limit does not do" list, which the issue had, was dropped from the design. Two points belong in the docs and the upgrade note:

- Locks taken by earlier operations stay held until `COMMIT`. A run with several waits can block the first table for up to the limit at each wait.
- Replicas that migrate at start-up wait for each other on the marker lock without limit. So when a long transaction blocks the table, each replica in turn blocks it for up to the limit, then fails and is restarted. The outage is bounded per attempt, not per deploy. It is still far better than today's unbounded wait.

### 10. Reasons for the rejected alternatives (low)

- "Automatic retry … rejected: it reruns the whole transaction, data changes included, without the user asking." After a rollback the database is unchanged, so a rerun does what the user's own rerun would do. That reason is weak. The real reasons are the project's: "Explicit behaviour. No hidden extra round-trips, fallbacks or guesses" (project intent). And the caller already retries: an orchestrator restarts a failed start-up, and a person reruns a failed deploy. Retry can come later as an explicit option (`explicit-opt-in-over-diagnostics.mdc`) without changing the default.
- "No default, only a warning" has no reason. `explicit-opt-in-over-diagnostics.mdc` supplies one: a warning on every run is noise, and `lockTimeoutMs: 0` is the explicit opt-in to waiting without limit.

## Answers to the questions asked

1. **Home and reach.** The Postgres target is the right home (ADR 005, ADR 150). Through the CLI and `prisma.config.ts` the value reaches the runner, for every space, with no framework change. It does not reach `createPostgresControlClient` or configs assembled from the framework's `defineConfig` (finding 1). Tests that build the runner directly get the default, which is fine. There is no existing pattern of a user-tunable target option. The closest is currying options into a descriptor (ADR 159), and ADR 324's "assemble in one place" sets the shape: one factory. "Composed, not configured" does not argue against it (finding 6).
2. **Recorded decisions.** It does not reverse ADR 043 in code, but its argument for an unbounded marker lock contradicts ADR 043's 30-second ceiling. It should say so and record it, or leave the argument out (finding 4). Leaving the marker lock unbounded is defensible only if the runner actually makes it unbounded; today a session limit applies to it (finding 2). The name `MIGRATION.LOCK_TIMEOUT` is ambiguous next to `MIGRATION.MARKER_LOCK_TIMEOUT`; use `MIGRATION.LOCK_WAIT_TIMEOUT` in the SQL family's list (finding 3).
3. **Overriding the session.** Right, for determinism, for poolers, and because the control plane owns its statements (ADR 254). It must also cover the marker lock (finding 2), and the upgrade note must tell workaround and role-setting users what changed (finding 5).
4. **No retry, 5 seconds.** Right, for the reasons in finding 10. 5 seconds without retry sits between the operators' 1 to 3 seconds with retry and strong_migrations' 10 seconds. It is the value of the closest tool that runs inside a transaction without retrying inside it (safe-pg-migrations, about 5 seconds). It matches the SQLite driver's 5-second `busy_timeout` (`sqlite/3-driver/src/core/migrations/control-driver.ts:72`). Defensible.
5. **Scope.** Once per transaction is correct for several spaces, because the setting lasts for the transaction. Put it next to every marker-lock acquisition so the policies path and direct `executeOnConnection` calls are covered (finding 2). Leaving out `db sign` is defensible: its statements touch only Prisma's control tables, and it goes through the control adapter (`2-sql-family/9-family/src/core/control-instance.ts:759`), which has no access to the target's options. Introspection and `db verify` only read the catalog. Deferring MySQL is right: its DDL commits as it runs, and the setting is the session's `lock_wait_timeout` (and `innodb_lock_wait_timeout` for rows), both in whole seconds. So `lockTimeoutMs` carries over if it is rounded up to seconds and documented that way. SQLite's `busy_timeout` is in milliseconds and could take the same key later. MongoDB has no equivalent, so it should have no key.
6. **What could force a redesign.** Nothing does if findings 7 and 8 are addressed now: scope the limit per migration so a per-migration override stays a small addition, and state that non-transactional steps get their own rule. Long data migrations are not affected. The limit bounds waits, not how long a lock is held.

## Verified and inferred

- Verified by reading code or docs: every file and line cited in findings 1, 3, 4, 6 and 7, and the code order in finding 2.
- Inferred, not tested: that Postgres's `lock_timeout` applies to the wait in `pg_advisory_xact_lock` (from the Postgres documentation's description of `lock_timeout`, which covers a lock on "a table, index, row, or other database object"); that a transaction-local setting does not reach a future non-transactional step and that a session `SET` is unsafe through a per-transaction pooler; that the outage pattern in finding 9 follows. Not checked: how Composer builds its control client. If it uses `createPostgresControlClient` and not the loaded config, finding 1 applies to it too.
