# Design v2: stop forcing `lc_monetary=C` on every connection

Status: proposal for review, 2026-11-18. Will has agreed to the user experience in section 3. Nothing is built. This replaces `design.md` (the pooler-option design), which Will rejected because it made the user track which environments need which option and which extra SQL.

All code references are to the base commit `234d27acb2` (`git show 234d27acb2:<path>`). The worktree's checked-out files hold a superseded implementation; never read them as current behavior.

## 1. The problem, with measurements

A pooled Prisma Postgres URL (`pooled.db.prisma.io`) fails to connect through every entry point: `postgres({ url })`, `postgresServerless().connect({ url })` and the CLI. The error is "Failed to connect to upstream database. Please contact Prisma support if the problem persists."

The PostgreSQL target declares two session settings (`packages/3-targets/postgres/1-target/src/core/descriptor-meta-runtime.ts:26`): `DateStyle=ISO` and `lc_monetary=C`. The driver sends both as startup options, `-c DateStyle=ISO -c lc_monetary=C`, on every connection it opens.

Measured on 2026-11-18 against a real Prisma Postgres database (scripts and output in `probe/`):

- The pooled address accepts `-c DateStyle=ISO` as a startup option. It also accepts `TimeZone` and `extra_float_digits`.
- It refuses `-c lc_monetary=C`, and also `statement_timeout`, `search_path` and `lc_messages`. So `lc_monetary` alone is why our connection fails.
- It pools per transaction: two clients connected at once shared one server process.
- `lc_monetary` set by a statement lands on the shared server connection and is visible to other clients; it is not reliable from the client side.
- With the server's default `lc_monetary` (`en_US.utf8`), `money` prints `$1,234.50` and `-$1,234.50`, the same text as under `C`.
- The direct address accepts both startup options.

## 2. Why `lc_monetary=C` is there

Only for the `money` column type (the recorded decision on data types and casts, section "Money"):

- Reading: PostgreSQL prints `money` in the session's `lc_monetary` format. The codec `pg/money@1` reads only the `C` form (`$1,234.56`, `-$1,234.56`) and a plain numeral. Any other text is refused with `RUNTIME.LC_MONETARY_NOT_C`.
- Writing: the adapter sends a `money` parameter as `$1::numeric::money`, which reads no separators. The conversion still scales by the locale's number of fraction digits, so it is exact under `C` and every locale with two fraction digits, and not under one with none, such as `ja_JP`.

It was put on every connection because a startup option is free on a direct connection and the driver cannot know at connect time whether a later query touches `money`. The same record rejected reading `money` through a `::numeric` cast in every query, because no codec can add SQL to a plain read.

So every connection carries a setting that only `money` users need, and that setting is what a per-transaction pooler refuses.

## 3. The decision

The PostgreSQL target stops declaring `lc_monetary` as a session setting. `sessionSettings` becomes `{ DateStyle: 'ISO' }`. Nothing else in the mechanism changes: the driver still sends the target's settings as startup options on connections it opens, and still applies them by statement on pools and clients the user supplies.

What the user experiences (agreed with Will):

- A pooled Prisma Postgres URL connects through `postgres()`, the serverless client and the CLI, with no option and nothing to know.
- Direct connections behave as today. No extra statements anywhere.
- `money` works as today on any database whose `lc_monetary` prints the `C` form. That includes the usual `C`, `POSIX` and `en_US` locales, and Prisma Postgres.
- On a database whose `lc_monetary` prints another form, a `money` read fails with `RUNTIME.LC_MONETARY_NOT_C`, which names the setting and the fix (`ALTER ROLE <role> SET lc_monetary = 'C'` or `ALTER DATABASE`). Today the forced setting hides that case. A `money` write there can be stored scaled or rounded by that locale before the first read fails.

## 4. The change

1. `packages/3-targets/postgres/1-target/src/core/descriptor-meta-runtime.ts`: `sessionSettings: { DateStyle: 'ISO' }`.
2. `RUNTIME.LC_MONETARY_NOT_C` (`packages/3-targets/postgres/1-target/src/core/errors.ts:154-161`): the message and `why` say "the driver could not ensure the lc_monetary=C the PostgreSQL target requires". After the change the driver does not try. Reword: the codec reads `money` only as the `C` locale prints it; the database or role prints another form; the fix is the `ALTER ROLE` or `ALTER DATABASE` statement, or a session `SET` on a direct connection the application owns.
3. Docs that state the old behavior: the "Money" and date sections of the decision record on data types and casts (amended, dated, saying what is reversed and why, with the measurement); the session-settings section of the decision record on driver terminology and lifecycle, whose example names both settings; the driver README (line 122 at the base), the target README, `docs/reference/scalar-types.md`, `docs/reference/error-reference.md`, the `prisma-8` skill's references that mention `lc_monetary`.
4. Tests: every test that expects `lc_monetary` in startup options or in the `set_config` statement changes to expect `DateStyle` alone. New tests in section 6.
5. Upgrade notes under `upgrade-instructions/pending/`: applications that read or write `money` on a database whose `lc_monetary` is not a `C`-form locale must set it on the role or database; applications whose own raw SQL relied on `money` printing in the `C` form now see the database's own form.
6. The draft pull request prisma/orm#31081 is rebuilt from the base with only this change. Its current commits are dropped. Title and description are rewritten.

Not in this change: the facade option to turn off the client-side pool, and exposing `preparedStatements: false` on the facade. Both are separate work. The pooled address handled named prepared statements correctly in the measurement.

## 5. What this reverses in recorded decisions

- The decision record on data types and casts says the target declares `lc_monetary=C` beside `DateStyle=ISO` and that "`lc_monetary=C` stays a requirement for writes too". This design reverses "the target declares it and the driver ensures it". The requirement stays, but it becomes a property the database must have, checked by the codec on read, not something the driver forces.
- The same record rejected reading `money` through a `::numeric` cast. This design does not revisit that.
- The decision record on driver terminology and lifecycle is not reversed. Its mechanism (target declares settings, driver ensures them) stays; only the example list of PostgreSQL's settings shrinks.

## 6. How we will know it works

- Unit: the target's descriptor declares exactly `{ DateStyle: 'ISO' }`. The startup options built from it are `-c DateStyle=ISO`. The guard's statement sets one setting.
- Integration, targeted files only: a `money` round trip on the test database (default locale) still reads and writes exactly. A session with `lc_monetary` set to a non-`C`-form locale, if the test image has one installed, makes a `money` read fail with `RUNTIME.LC_MONETARY_NOT_C` and the new text; if the image has none, a unit test of the codec on such text covers it.
- A local stand-in for the pooler: a test server that refuses a startup message whose `options` name `lc_monetary` and accepts `DateStyle` (the repository has `test/utils/src/startup-parameters.ts` for reading startup parameters). `postgres({ url })`, the serverless connection and the control driver each connect to it.
- Manual, against a real pooled Prisma Postgres URL, with packages built from the branch: `postgres({ url })` runs a query and a `money` round trip; `postgresServerless().connect({ url })` runs a query; one CLI command that connects (for example `prisma db push` or the migration status command) succeeds. This uses a temporary `create-db` database.
- The getting-started nightly's agent test no longer hits the connect failure once this ships.

## 7. Risks and unknowns

1. **`money` on a non-`C`-form locale loses forced protection.** Reads fail loudly. Writes can be stored scaled or rounded before a read reveals it. Population: applications with `money` columns on a database or role whose `lc_monetary` is, for example, `de_DE` or `ja_JP`. Unknown how many exist. This is the cost Will accepted.
2. **Does `en_US` always print the `C` form?** Measured on Prisma Postgres only, and that server printed the `C` form for every locale name tried, which suggests those locales are not installed there. On a glibc system `en_US.UTF-8` prints `$1,234.56` and `-$1,234.56`; this should be confirmed on a stock PostgreSQL image with real locales.
3. **Which code besides the codec assumed the setting?** Aggregates over `money` (`sum`, `min`, `max`), nested-relation JSON (`projectJson` for `pg/money`), the control plane's reading of `money` defaults during introspection and migration planning, and the Supabase extension's `RESET ALL` on release. Each must be checked: does it go through the codec's refusal, or can it read a non-`C` form silently?
4. **Other poolers and `DateStyle`.** This design keeps sending `DateStyle` as a startup option. PgBouncer tracks `DateStyle` as a client parameter. Other poolers (Supavisor, pgcat, RDS Proxy, Cloudflare Hyperdrive) are untested, as they are today. Not made worse by this change.
5. **The CLI through a per-transaction pooler.** The connect now succeeds. Migrations use `pg_advisory_xact_lock` inside one transaction, which worked in the measurement. Other CLI behavior through the pooler is untested beyond the manual check in section 6.
6. **Removing a declared setting is a behavior change for raw SQL.** An application's own raw SQL that printed `money` relied, perhaps unknowingly, on the `C` form. Covered by the upgrade note.

## 8. Alternatives considered

- **An explicit option that says the URL reaches a pooler** (`design.md`). Rejected by Will: the user must track which environments need it, and `money` behind the pooler still needed a one-time `ALTER ROLE`.
- **Each statement that touches `money` sets `lc_monetary` inside a transaction.** Reliable everywhere, but it adds a transaction and a statement to every `money` query, and new machinery in the runtime, to protect a rare setup.
- **Read `money` through a `::numeric` cast.** Rejected in the recorded decision; plain projections and `RETURNING` have no codec hook. It also does not fix scaling under locales without two fraction digits.
- **Retry the connection without the refused setting.** Rejected by Will: the code never guesses why a connection failed.
- **Apply both settings by statement on every connection.** Rejected by Will: worse for every direct connection, and unreliable for `lc_monetary` behind a per-transaction pooler.

## 9. Questions for the reviewers

1. Is the decision sound? Is there a reader or writer of `money` that would now produce a wrong value silently on a `C`-form locale, where today it is correct?
2. Section 7.3: check each named path at the base commit. Report any that bypasses the codec's refusal.
3. Is the reworded error and its fix correct for each situation that can now raise it?
4. Does removing the setting leave any name, doc or type that now says something false?
5. Is the test plan enough? What is missing?
6. What did this document get wrong? Check sections 1, 2 and 4 against the base commit.

## 10. Revised after review (2026-11-18): what gets built

Both reviewers found the decision sound with changes (`review-v2-architect.md`, `review-v2-principal-engineer.md`). The user experience in section 3 stands, with one improvement: `money` writes and filters become exact under every locale. Where this section and sections 4 to 7 differ, this section wins.

### 10.1 Corrections to this document

- Section 7.2: real `en_US.UTF-8`, `C.UTF-8` and `POSIX` print exactly the `C` form (measured on glibc, `probe/`). `en_GB` prints `£`, `de_DE` prints `1.234,50 €`, `ja_JP` prints `￥1,235`. Prisma Postgres accepted every locale name and printed the `C` form, which is how a musl C library behaves; it does not show that those locales are missing.
- Section 4.3: the target README and the `prisma-8` skill do not mention `lc_monetary` at the base, and the date section of the data-types record needs no change. The list missed the doc comment on `sessionSettings` in `framework-components.ts:229`, the doc comment at `errors.ts:154`, and the money descriptor's doc comment at `codecs.ts:1240`. The principal engineer's finding 8 is the complete list of affected tests and docs.
- Section 5: the decision record on driver terminology and lifecycle is affected. It defines a target's session settings by what its codecs need, and names `lc_monetary=C` for `money`. That definition changes (10.2).
- Section 2 and the data-types record say PostgreSQL has no conversion to `money` that ignores `lc_monetary`. That is wrong: `money`'s binary input reads the stored count of cents directly.

### 10.2 The rule, stated once

`sessionSettings` on a target are the settings the driver sets on every connection it hands out. A setting a codec needs that cannot be set at connection start on every server, including through a pooler, is a requirement on the database, and the codec checks it on read. `DateStyle=ISO` is the first kind. `lc_monetary=C` is the second. No new declared field for database requirements.

### 10.3 Part A: the runtime

1. `sessionSettings: { DateStyle: 'ISO' }` in the PostgreSQL target's descriptor.
2. **`money` parameters are sent in binary.** The codec's wire value for a parameter becomes the 8-byte big-endian count of cents, which `pg` sends in binary format, bound as `$n::money`. PostgreSQL's binary input for `money` ignores `lc_monetary`, so writes, filters, `updateMany`, `deleteMany`, `count`, cursors and increments are exact under every locale (measured under `C`, `de_DE`, `ja_JP`, `ar_KW`; `probe/binary-money.out`). `POSTGRES_PARAMETER_READ_AS` loses its `money` entry. `money[]` parameters use the binary array format if that is straightforward; if it is not, the implementer stops and reports rather than leaving arrays on the `numeric` cast silently. This must work on every driver path the repository supports, including the test database (PGlite); if one cannot send a binary parameter, stop and report.
3. Reads do not change: the codec reads the `C` form and a plain numeral and refuses anything else with `RUNTIME.LC_MONETARY_NOT_C`. The code stays; its message, `why`, `fix` and doc comment are rewritten to be true: the database or role prints `money` in another locale's form; nothing was written wrongly; the fix is `ALTER ROLE` or `ALTER DATABASE ... SET lc_monetary = 'C'`, which applies to server connections opened afterwards (a pooler's existing connections keep the old value until replaced), or `options=-c lc_monetary=C` in the URL of a direct connection. Do not suggest a session `SET`. Do not say English locales in general work.
4. With binary parameters, the silent corruption in the principal engineer's finding 1 cannot happen from Prisma's own writes, so the error does not need a warning about mixed units.

### 10.4 Part B: the CLI (control plane)

1. Add `lc_monetary: 'C'` to `INTROSPECTION_OUTPUT_SETTINGS`, so `db verify`, `migration plan` and `contract infer` read a `money` default the same on every server. No extra statement.
2. The migration runner sets `lc_monetary = 'C'` locally inside its transaction, right after `BEGIN`, so `DEFAULT '12.34'::money` is stored exactly under every locale. Fold it into an existing statement if the code allows; otherwise it is one statement per migration run.
3. When introspection is not already inside a transaction, it runs inside one, so its pinned settings are local and never land on a server connection a pooler shares. This replaces the session-level set-and-restore path.

Parts 1 and 2 go together: without them, migrations with a `money` default fail on `de_DE`-style databases where they work today.

### 10.5 Docs and records

- Amend the data-types record: status line; the Money section (the target no longer declares the setting; parameters are binary; the false sentence about no locale-free conversion; the sentence about raw SQL); the alternatives list gains the previous decision (forcing `lc_monetary=C` on every connection) as rejected, with the measurement, and the `::numeric` alternative's baseline is updated.
- Amend the driver terminology and lifecycle record with the rule in 10.2.
- `framework-components.ts:229` doc comment, driver README, `docs/reference/scalar-types.md`, `docs/reference/error-reference.md`, the target README's "Introspection session settings" section.
- Upgrade note and changelog entry: the rc.22 promise that `money` "reads and writes the same value in any locale" changes to: writes are exact in any locale; reads need the database to print the `C` form, and fail loudly otherwise. Raw SQL that printed `money` now shows the database's own form.

### 10.6 Tests

- Codec unit tests with the real locale texts from `probe/` as fixtures (refused forms, accepted forms).
- Binary parameter encoding unit tests (zero, negative, sub-unit, both bounds), and a targeted integration round trip for write, filter and increment.
- A local stand-in for the pooler built from `startStartupParameterRecorder` (`test/utils/src/startup-parameters.ts`): it refuses a startup whose `options` name a setting outside an allow-list (`DateStyle`, `TimeZone`, `extra_float_digits`). The runtime driver, the serverless connection and the control driver each connect to it.
- Control plane: introspection settings include `lc_monetary`; the runner's transaction sets it; introspection outside a transaction runs inside one.
- Every test in the principal engineer's finding 8 updated.
- Manual, against a real pooled Prisma Postgres URL with a second client connected: `postgres({ url })` query and `money` round trip, a serverless connection, and `db verify`, `migration plan` and one migration apply through the CLI.
