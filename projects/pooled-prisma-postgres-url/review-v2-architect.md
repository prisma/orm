# Architect review of design v2: stop forcing `lc_monetary=C` on every connection

Reviewer lens: names, concepts, boundaries and recorded decisions. Failure modes, cost and test adequacy are left to the principal engineer's review. All code references are to the base commit `234d27acb2`.

**Verdict: sound with changes.**

The change itself is the right size and in the right place: one line in the target's descriptor, and the money codec keeps the read check it already has. No simpler design gives the same user experience (see the last section). But the design treats the change as "the example list shrinks", and it is more than that. It changes what a target's session settings mean, and the framework type, the driver decision record, the error text and three doc comments all still state the old meaning. Those must change in the same pull request.

## Findings, most important first

### 1. The change redefines "session settings", and the design does not say so

**What the design says.** Section 5: "The decision record on driver terminology and lifecycle is not reversed. Its mechanism (target declares settings, driver ensures them) stays; only the example list of PostgreSQL's settings shrinks."

**What is wrong.** The framework defines a target's session settings by what the codecs need, not by what the driver can set. After the change, the money codec still needs `lc_monetary` to print the `C` form, and the target no longer declares it. So the declaration stops being the list of what the codecs need. That is a change to the concept's definition, not to an example.

**Evidence.**

- `packages/1-framework/1-core/framework-components/src/shared/framework-components.ts:229`: "Session settings the target's codecs need on every connection. A stack passes them to each driver it creates, and the driver ensures them on every connection it hands out." Read cold after the change, this says the PostgreSQL codecs need only `DateStyle`. That is false.
- The driver decision record, section "A target's session settings" (lines 102 to 110): "A target may need every database session to have certain settings. PostgreSQL's date and time codecs read ISO 8601 text, so they need `DateStyle=ISO`, and its `money` codec reads the text PostgreSQL prints under the `C` locale, so it needs `lc_monetary=C`. The target states this as data, `sessionSettings` on its descriptor". The rule here is "a target states the settings its codecs need". After the change the money codec still needs one and the target does not state it, so the rule itself is broken, not only the example.
- The extension upgrade recipe `driver-ensures-target-session-settings` (`skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md:465`) told extension authors the same thing: "A target can now state the settings every database session needs". That recipe is historical and should stay as it is, but it shows the meaning extension authors were given.

**Is the asymmetry a real difference or a defect?** It is a real difference, but the design never names it, so the code will read as an exception made for one pooler. The two settings differ in exactly one way that matters: a per-transaction pooler carries `DateStyle` for the client at connection start and refuses `lc_monetary` (`probe/probe2.out`: `-c DateStyle=German` connects and is applied; `-c lc_monetary=C` and `-c lc_monetary=en_US.utf8` are refused). PgBouncer also tracks `DateStyle` for its clients, as section 7.4 says. Both settings are things a codec needs. Only one is something the driver can guarantee on every connection without cost and without being refused.

So the system will have two kinds of requirement:

- A setting the driver sets on every connection: declared by the target, set by the driver, and checked by the codec on read. `DateStyle` is one.
- A setting the database must already have: not declared, not set by Prisma, and checked by the codec on read. `lc_monetary` is one.

The codebase already handles session output settings in two other ways. The interval and `bytea` codecs read every form their setting can print, so they need no session setting at all (`packages/3-targets/postgres/1-target/test/session-output-styles.test.ts:10` and `:51`). Introspection sets four output settings itself for the length of its read (finding 3). The design adds the second kind of requirement above without writing down the rule that decides which kind a setting is. The next person who adds a setting, for this target or for MySQL, has no rule to follow.

**What I would do.** State the rule once, and make the framework's definition match what the declaration now is:

- Redefine `TargetDescriptor.sessionSettings` by what it does, at `framework-components.ts:229`. For example: "Session settings the driver sets on every connection it hands out. A target declares a setting its codecs need here when a driver can set it at connection start, including through a connection pooler. A setting a codec needs that a driver cannot set that way is a requirement on the database, and the codec refuses a value printed under another value of it."
- Amend the driver decision record's section "A target's session settings" with the same rule. Rewrite its first paragraph so that it no longer lists `lc_monetary` as a setting the target states. Add a sentence on why `lc_monetary` is the counter-example: per-transaction poolers refuse it as a startup option, and setting it by statement on a pooled connection leaks to other clients (`probe/probe.out`, the lines showing client B reading `de_DE.UTF-8` after client A set it). Section 5 of the design must then say that this record is amended, not left unchanged.
- Do not add a new declared field for "requirements the database must have", such as `requiredSessionSettings` or a field on the money data type. Nothing would read it: at the base, the only things that read `sessionSettings` are the two stacks and the drivers (`framework-components/src/control/control-stack.ts:766`, `execution/execution-stack.ts:114`, `9-facade/src/runtime/binding.ts:440`, `postgres-serverless.ts:213`). A field that nothing reads is guessing at future needs. If a later check, for example `db verify` reading `current_setting('lc_monetary')` once when the contract has a `money` column, needs that data, that check is what would justify the field.

With that, the requirement lives in one coherent place: the money codec owns the wire form it reads and refuses every other form, as the date codecs do. The asymmetry with `DateStyle` is then only in who must provide the setting, and the rule says why.

### 2. The error `RUNTIME.LC_MONETARY_NOT_C` and three doc comments say false things after the change

**What the design says.** Section 4.2 rewords the message and the `why`. It does not mention the error's doc comment, the money codec's doc comments, or the problem that `ALTER ROLE` reaches a pooled server connection late.

**What is wrong, piece by piece.**

- **The code name `RUNTIME.LC_MONETARY_NOT_C`.** Keep it. Whenever it fires, `lc_monetary` really is not `C`, because `C` always prints the form the codec reads. It names the setting the user must change, and it has the same shape as its sibling `RUNTIME.DATE_STYLE_NOT_ISO`. It has also shipped in releases (`docs/releases/v8.0.0-rc.22.md:81`, `v8.0.0-rc.24.md:81`), so renaming it would break anyone who matches on it, for no gain in accuracy. The name does not say that `en_US` also works, and it does not need to. The text below says it.
- **The error's doc comment** (`packages/3-targets/postgres/1-target/src/core/errors.ts:154`): "A money codec read text PostgreSQL printed under an `lc_monetary` other than C, which no codec reads." After the change, text printed under `en_US.utf8` is printed under an `lc_monetary` other than C and is read without error (`probe/locale-money.out`, the `en_US.UTF-8` rows). Change it to: "A money codec read text in a form other than the one PostgreSQL prints under `lc_monetary` C, which no codec reads."
- **The message** (`errors.ts:158`): "the driver could not ensure the lc_monetary=C the PostgreSQL target requires". This becomes false twice: the driver does not try, and the target does not declare it. The first half, "which PostgreSQL prints only when the connection's lc_monetary is not C", stays true. Suggested message: "Codec 'pg/money@1' read "1.234,50 €", which is not money as PostgreSQL prints it under lc_monetary C, as in $1,234.56 and -$1,234.56. Prisma reads money only in that form."
- **The `why`** (`errors.ts:160`): "The PostgreSQL driver ensures lc_monetary=C on every connection it uses: it starts each connection it opens with it, and sets it on a connection the application supplies before first use. A statement that sets lc_monetary on a connection undoes that, and so does a connection pooler between Prisma and PostgreSQL that drops the startup option". Every one of those sentences becomes false. Suggested replacement: PostgreSQL prints money in the session's `lc_monetary`, which comes from the server's configuration, the database, the role, a startup option or a `SET` statement; Prisma does not set it. The sentences about a write that returns its row being already committed stay. Add that under a locale whose number of fraction digits is not two, such as `ja_JP`, the written value was also stored scaled. The base text omits this, and the error reference says it (`docs/reference/error-reference.md:1355`).
- **The `fix`** (`errors.ts:161`): "Do not change lc_monetary on a connection Prisma uses. Behind a connection pooler, set lc_monetary on the role or database". After the change, the role or database is the fix for every connection, not only behind a pooler. The fix must also say when it takes effect. The measurement shows that after `ALTER ROLE` and `ALTER DATABASE`, a direct connection reads `C` but the pooled connection still reads `en_US.utf8`, because the pooler reuses a server connection opened earlier (`probe/probe2.out`, lines "direct after alter" and "pooled after alter"). Suggested fix: "Set lc_monetary to C for the role or the database: ALTER ROLE <role> SET lc_monetary = 'C', or ALTER DATABASE <database> SET lc_monetary = 'C'. It applies to server connections opened after it, so behind a connection pooler it applies once the pooler opens new ones. On a direct connection you can instead add the startup option to the URL: options=-c lc_monetary=C." The URL option works because the driver keeps the options the URL gives (`packages/3-targets/postgres/3-driver/src/session-settings.ts:49-50`).
- **The money descriptor's doc comment** (`packages/3-targets/postgres/1-target/src/core/codecs.ts:1240`): "PostgreSQL prints money in the session's `lc_monetary`, which the PostgreSQL target sets to C on every connection". This becomes false. Change it to say that the codec reads the form `C` prints, that the database or role must use a locale that prints that form, and that the codec refuses any other form.
- The two other money comments in `codecs.ts` (line 1188, `C_LOCALE_MONEY_TEXT`, and line 1192, `pgMoneyDecode`) describe the form, not who sets it. They stay true. The renderer's comment on `POSTGRES_PARAMETER_READ_AS` (`packages/3-targets/postgres/2-adapter/src/core/sql-renderer.ts:110`) also stays true.
- `RUNTIME.DATE_STYLE_NOT_ISO` (`errors.ts:141-152`) stays as it is. After the change, the two sibling errors give different reasons and different fixes. That is correct, because the two settings now differ in who provides them, as finding 1 says.

### 3. Introspection already sets the settings that shape printed values, and after the change it misses one

**What the design says.** Section 7.3 lists "the control plane's reading of `money` defaults during introspection and migration planning" as something to check.

**What is wrong.** The repository already has a mechanism for exactly this problem on the control plane, and the design does not use it. `readWithDefaultOutputSettings` in `packages/3-targets/postgres/2-adapter/src/core/control-adapter.ts:1813-1825` says it runs introspection "with the settings that shape printed values pinned ... so pinning them gives the same text whatever the server, the role, or the caller set". Its list, `INTROSPECTION_OUTPUT_SETTINGS` (`control-adapter.ts:1771-1776`), has `TimeZone`, `DateStyle`, `IntervalStyle` and `bytea_output`, but not `lc_monetary`. At the base that gap was covered, because the session already had `lc_monetary=C` from the startup option. After the change, a money column's default prints in the role's locale: `'12,34 €'::money` under `de_DE` and `'￥1,234'::money` under `ja_JP` (`probe/locale-money.out`, section "column default spelling"). `db verify`, the planner and the runtime read a reported default through the column's codec (the decision record on data types and casts, "Consequences": "`db verify`, the planner and the runtime read a default or a row the database reports through the column's codec"). So `db verify` and migration planning would start to depend on the role's locale. The target README's section "Introspection session settings" (`packages/3-targets/postgres/1-target/README.md:259-261`) would then also be false, because it promises text that "does not depend on the server, the role, or what the caller had set".

**What I would do.** Add `lc_monetary = 'C'` to `INTROSPECTION_OUTPUT_SETTINGS` and to the `set_config` and `current_setting` statements beside it, and add it to the target README's list. This uses the existing statement, so it adds no statement and no per-connection cost, and the user configures nothing. It keeps the rule that introspection text does not depend on the role. It also means the control plane, which owns its whole read, holds no new database requirement. Only reads of rows at runtime then depend on the database's `lc_monetary`. This is the one place where the requirement should be expressed in code, beyond the codec's check. The principal engineer should check whether the default-reading path can run outside `readWithDefaultOutputSettings`.

### 4. Section 5 leaves out sentences in the data types record that become false

**What the design says.** Section 5 says the record on data types and casts reverses "the target declares it and the driver ensures it", and that the rejected `::numeric` alternative is not revisited.

**What is missing.** These sentences in `docs/architecture docs/adrs/ADR 254 - Data types and casts.md` at the base must be amended:

- Line 3, the status line: "Amended 2026-10-27: the Postgres target sets `lc_monetary=C` so `money` reads exactly (see "Money")." After the change the target does not set it. Add a new dated amendment that says what is reversed; do not edit the old one in place.
- Line 384, "Money": "The target declares `lc_monetary=C` beside `DateStyle=ISO`, and the driver ensures both the same way, so PostgreSQL prints `$1,234.56` and `-$1,234.56`." This is the sentence the design names.
- Line 384: "PostgreSQL has no conversion to `money` that ignores the setting, so `lc_monetary=C` stays a requirement for writes too." This stays true as a requirement. Add that the database or role must now provide it, and that Prisma no longer sets it.
- Line 384: "The setting also changes how `money` prints in an application's own raw SQL." After the change this is false. Prisma no longer changes it, so raw SQL prints in the database's own form. This is the behavior change in section 7.6, and the record must say it.
- Line 463, alternatives: "Reading `money` through a `::numeric` cast in every query instead of setting `lc_monetary`." The rejection stands, but the baseline it compares against ("instead of setting `lc_monetary`") is gone. Reword it to compare against requiring the setting of the database. Also add the rejected alternatives from section 8 of the design, including the previous decision itself: "Setting `lc_monetary=C` as a startup option on every connection. A per-transaction connection pooler, such as Prisma Postgres's pooled address, refuses the connection." The rejected options to set it by statement or to retry the connection belong there too.
- The record's text on reads should say that only a row read at runtime depends on the database's locale, if finding 3 is adopted.

One small correction in the other direction: section 4.3 says the record's date section must be amended. At the base, that section (line 380) mentions only `DateStyle` and stays true. It needs no change, unless the rule from finding 1 is written there rather than in the driver record. The driver record is the better place, because the rule is about the driver.

A user-facing promise is also reversed, and section 5 does not list it. The rc.22 release note says: "The Postgres driver sets `lc_monetary=C` on every connection ... so `money` reads and writes the same value in any locale" (`docs/releases/v8.0.0-rc.22.md:81`, `CHANGELOG.md:271`). Leave the old note as it is, but the new changelog entry and the upgrade note should say that this promise is withdrawn.

### 5. Factual errors in section 4.3, the list of docs to change

- "the target README": at the base it does not mention `lc_monetary` or `money` (`git grep -i lc_monetary 234d27acb2` finds nothing in `packages/3-targets/postgres/1-target/README.md`). It needs a change only for finding 3.
- "the `prisma-8` skill's references that mention `lc_monetary`": there are none. `git grep -c -i lc_monetary 234d27acb2` lists no file under `skills/`.
- The list leaves out the framework doc comment (`framework-components.ts:229`, finding 1), the error's doc comment (`errors.ts:154`), the money descriptor's doc comment (`codecs.ts:1240`) and the introspection settings (finding 3).

Full list of files that mention `lc_monetary` at the base, for the implementer: `CHANGELOG.md`, the two decision records, `docs/reference/error-reference.md`, `docs/reference/scalar-types.md`, two release notes, `codecs.ts`, `descriptor-meta-runtime.ts`, `errors.ts`, `sql-renderer.ts`, the driver README, and tests in `1-target`, `2-adapter`, `3-driver`, `9-facade` and the Supabase extension. Leave the release notes, the old changelog entries and `projects/prisma7-contract-source/slices/09-postgres-native-types/spec.md` as they are, because they record history.

### 6. Section 3 says more than the measurement supports about which locales work

**What the design says.** "`money` works as today on any database whose `lc_monetary` prints the `C` form. That includes the usual `C`, `POSIX` and `en_US` locales".

**What is right and what to add.** On a stock image with real locales, `C`, `POSIX`, `C.UTF-8` and `en_US.UTF-8` print the `C` form (`probe/locale-money.out`). This settles risk 7.2 in section 7, and the design should cite this file. But `en_GB.UTF-8` prints `£1,234.50`, which the codec refuses. "en_US" is the user-facing example in the docs and the error text, so the docs should not suggest that English locales in general work. In `docs/reference/scalar-types.md:203`, name the locales that work and give `en_GB` as an example of one that does not.

## Is there a simpler or more coherent design?

No simpler one. The change is one line, and the codec's check already exists. I considered three more coherent alternatives and would not take any of them:

- **Each codec declares the settings it needs, and the stack combines them for the contract's columns.** This would make the declaration truly "what the codecs need". But an application with `money` columns on a pooled URL would still fail to connect, which section 3 promises to avoid. It also needs the contract when the driver is created, which the stacks do not have.
- **A declared, inert list of requirements on the database.** Nothing reads it (finding 1).
- **Read `money` through `::numeric` in nested relation JSON only.** The descriptor has a hook that adds SQL to a nested JSON read (`jsonProjection`, `packages/3-targets/postgres/1-target/src/core/codec-descriptor.ts:57`; the money descriptor's version returns the expression unchanged, `codecs.ts:1244`). So the record's statement "No codec can add SQL to a read today" is not quite true for nested JSON. But using that hook would make an included row read where a top-level row fails, which is one value with two behaviors. Do not use it.

The coherent version is the design as written, plus: the rule and the new definition from finding 1, the corrected text from finding 2, `lc_monetary` added to introspection's settings from finding 3, and the record amendments from finding 4.

## Checked and found correct

- Section 1: the target declares both settings at `packages/3-targets/postgres/1-target/src/core/descriptor-meta-runtime.ts:26`. The driver sends them as startup options on pools and clients it creates (`3-driver/src/session-settings.ts:25-52`, used by `postgres-driver.ts:1047`, the control driver `exports/control.ts:72`, the facade `binding.ts:433` and `postgres-serverless.ts:211`). It sets them by statement on pools and clients the user supplies (`SessionSettingsGuard`, `session-settings.ts:92-119`).
- Section 1: the measurements match `probe/probe.out` and `probe/probe2.out`. That covers the refused and accepted startup options, the shared server process, a statement-set `lc_monetary` that leaks across clients, and the default `en_US.utf8` printing the `C` form.
- Section 2: the codec reads the `C` form and a plain numeral, and refuses anything else with `RUNTIME.LC_MONETARY_NOT_C` (`codecs.ts:1188-1211`). A numeral that `money` cannot hold gets `RUNTIME.DECODE_FAILED` instead, which does not affect the design. The parameter cast `$1::numeric::money` is at `sql-renderer.ts:110-114`. The `ja_JP` scaling is confirmed in `probe/locale-money.out`. The rejected `::numeric` read alternative is quoted correctly (data types record, line 463).
- Section 4.2: the line range `errors.ts:154-161` is right (the function runs to line 165).
- Section 4.3: the driver README sentence is at line 122, as stated.
- Section 5: the quoted sentence "`lc_monetary=C` stays a requirement for writes too" is in the data types record at line 384.
- The design keeps the rule from the driver record that "A codec never sets a session setting" (line 110). The money codec still only refuses.
- Keeping `DateStyle` as a startup option is consistent with the pooler measurement and with PgBouncer's tracked client settings.
