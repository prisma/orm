# Design notes — Convenience date and time types

Record of the design discussion between the operator and the orchestrator on 2026-10-21 and 2026-10-22. It started from a research report comparing how a user declares and reads date and time fields on PostgreSQL in Prisma 7 and Prisma 8.

## What the research found

- **Prisma 7** had one type, `DateTime`, whose value was always a JavaScript `Date`. `@db.*` attributes changed the column type. It was easy to learn, but a `Date` is the wrong value for a calendar date or a time of day. A birthday created at local midnight east of UTC was stored as the day before, and a `timetz` offset was lost on read.
- **Prisma 8** has eleven type names for dates and times. Each fixes both the column type and the kind of value. Nothing says which to start with, and each kind of value had a problem:
  - The Temporal types fail on Node without a polyfill. The failure comes at the first read, not at startup. A `create` can commit and then throw, and without the type declarations the fields are typed `any`.
  - The string types return PostgreSQL's display text, which depends on the server's `TimeZone` and `DateStyle`. Every schema Prisma 8 writes for the user uses them.
  - A `Date` is available only for `timestamptz`.
  - An upgraded Prisma 7 app goes from `Date` values to strings.

## Principles

- **Explicit controls first, convenience on top.** Prisma 8 gives users explicit, predictable controls, then makes the common cases easy by composing convenience APIs over them, as the client facades compose the runtime, adapter and driver. The date and time types had the first half only.
- **The schema describes the application's data in the application's terms;** database details are configuration (architecture overview, "Domain-first surfaces").
- **A convenience API never hides a choice the explicit layer exposes.** Every convenience form becomes one explicit type, and the contract records only that.

## Decisions and why

**Convenience types over explicit types, not a renaming.** An early version of the proposal renamed every type after the application's meaning, which would have reversed ADR 257. The operator reframed it as layering: the database-named types stay as the precise form, and the new types are the short form built on them. Nothing is reversed, and a user who needs a specific column type and value kind keeps writing the explicit type.

**A type choice names the explicit type.** (Refined when slice 4 was grounded: the first plan let a type constructor's codec be a select template over option arguments, but selects have no defaults and no refusals, and that machinery is being removed with the presets. A type choice is a table from argument values to explicit constructor names.) One codec for `DateTime` with the database type as a parameter was rejected: a codec represents values of exactly one data type, and a column stores the data type its codec represents (ADR 254). A type alias with arguments was rejected: an alias attaches attributes to one fixed type, while choosing a type from arguments is what a type constructor does. Type constructors already take arguments.

**Names follow the application's concepts: `DateTime`, `Date`, `Time`, `Duration`.** Naming them after the Temporal types (`Instant`, `PlainDate`, `PlainTime`) was rejected as library vocabulary, not domain vocabulary: a user thinks "a birthday", not "a plain date". The mapping from each name to its value must be obvious.

**The explicit Temporal types get a suffix.** `Date` and `Time` were explicit types (Temporal-valued), and the convenience layer needed the names. Renaming only those two would leave `Timestamptz` as an unmarked name for one kind of value next to suffixed neighbours. So all four Temporal-valued explicit types carry `Temporal`, as the others carry `String` and `JsDate`. The orchestrator first claimed that today's `Date` and `Time` broke ADR 257's naming rule; that was wrong. ADR 257 suffixes only the second codec of a stored type, so this is a refinement of the rule, recorded as an amendment.

**Defaults need no setup.** The operator's rule: pick a default, and the other options must be possible. `DateTime` defaults to a JavaScript `Date`: it works everywhere and matches Prisma 7. `Date`, `Time` and `Duration` default to ISO 8601 strings, because JavaScript has no built-in calendar-date or time-of-day value, and a `Date` there causes the wrong-day bug.

**Plain strings, not a Prisma value class or a branded string.** A class owned by Prisma was rejected: users would learn another date API, it would not survive JSON across a server-client boundary, and Temporal will make it redundant. A branded string (`string & { __brand }`) was rejected: almost every written value starts as a plain string from a form or a request, so every write would need a helper or a cast, to catch a mistake the codec already reports at runtime.

**`Duration` defaults to an ISO duration string.** Today's `{ months, days, micros: bigint }` breaks `JSON.stringify`, and the contract already stores interval defaults as ISO durations. The object stays available as `as: parts`.

**`@db.*` does not come back.** Storage options are arguments in the type position, which agrees with ADR 241.

**`contract infer` and `contract print` write convenience types,** with arguments only where they differ from the defaults, so a schema the tools write reads like one a user would write. Only `Temporal.PlainDateTime`, which no convenience type covers, prints as its explicit type.

**The Prisma 7 reader gives back `Date`.** Prisma 7's `DateTime` is a `timestamp(3)` column read as a `Date`. Mapping it to `DateTime(storage: timestamp)` keeps an upgraded app's code compiling. This reverses the choice made when inferred and Prisma 7 columns moved to string types, which rejected `Date` only because no `timestamp` `Date` codec existed.

**TypeScript helpers take one object.** `type.DateTime({ as: 'string', precision: 6 })`, with one overload per row of the table, so a call is typed as the explicit type it picks and an unlisted combination does not compile (settled 2026-10-23). Explicit constructors stay positional.

**PostgreSQL only.** A convenience name must mean the same on every target. SQLite's `DateTime` and MongoDB's `Date` already use the names for explicit types, and MongoDB's `Date` is a moment in time. Resolving them is TML-3714.

## Alternatives rejected

- Rename every scalar after its application meaning, with no explicit layer (reverses ADR 257; loses the precise form).
- One parameterized codec per concept (breaks the one-data-type-per-codec rule).
- Type aliases with arguments (aliases attach attributes, they don't choose types).
- Bring back `@db.*` for storage options (the decision to select storage only in type position stands).
- Names from the Temporal API (`Instant`, `PlainDate`): library vocabulary, not domain vocabulary.
- A Prisma-owned date and time value class, or a branded string (see above).
- Document the explicit types and add no convenience layer (no default; every user must understand every choice first).
- Keep `Timestamptz` and `Timestamp` unsuffixed and rename only `Date` and `Time` (two naming patterns in one layer).

## Open questions

None. Settled on 2026-10-22:

- The string codecs keep their ids when they switch to ISO; it is a bug fix, and Prisma 8 keeps no backward compatibility before RC.
- Prisma requires `DateStyle=ISO` on its connections ("we get to dictate our connection requirements"); the codecs convert any time zone offset themselves.
- Renamed explicit types get no deprecated aliases before RC.
- No startup check for a missing Temporal: Temporal is an opt-in, and the first-use error names the fix. Fields are typed from `temporal-spec`, a types-only package, never from the polyfill, which is too large to include.
- `prisma7Schema` must map Prisma 7's `@default(now())` to `@default(now()) @onCreate(now())`; omitting the client-side default was a bug.

## References

- ADR 279 and ADR 241, 254, 257, 275.
- Architecture overview: "Domain-first surfaces", "Explicit over implicit".
- The research report (private artifact, 2026-10-21).
