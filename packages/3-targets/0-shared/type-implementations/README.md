# @internal/type-implementations

> **Internal package.** This package is an implementation detail of Prisma 8 and is published only to support its runtime. Its API is unstable and may change without notice. Do not depend on this package directly; install `@prisma/cli` and a database facade (e.g. `@prisma/orm-postgres`) instead.

Value logic that more than one target's codecs, data types and `now()` generators use, and that depends on no database and no family.

## Package Classification

- **Domain**: targets
- **Layer**: shared
- **Plane**: shared

The target packs (domain `extensions`) and the adapters (domain `targets`) can both import it. Its only dependency is `temporal-spec`, for types.

## What belongs here

Code goes here when more than one target uses it and it depends on no database and no family. Nothing that builds SQL or BSON, no codec classes, no error envelopes and no generator descriptors: those stay in each target. A function that finds a failure returns it as data, and the target raises its own error.

## Responsibilities

- **Finding `Temporal`** (`./temporal`): `findTemporal()` returns the runtime's global `Temporal`, else the fallback `setFallbackTemporal` set once per process, else `undefined`. A target's control entry sets the fallback; the target raises its own error when there is no `Temporal`.
- **`now()` values** (`./now`): the generator ids contracts store, each named for the value and not for a database type, and the value each produces in UTC through `Date.now()`: `instantNow`, `plainDateTimeNow`, `plainDateNow`, `plainTimeNow`, and the ISO 8601 text forms `instantStringNow`, `dateTimeStringNow`, `dateStringNow` and `timeStringNow`. The Temporal values take the implementation to construct with. Each value with a time rounds down to the fraction digits it is given, and a text value writes its fraction trimmed of trailing zeros or with every digit, as the target stores it; `fractionDigitsOf(params, max)` reads the digits from a generator's `precision` param, with the target's maximum as the default. A target keeps an id named after one of its own types, such as PostgreSQL's `timestamptzStringNow`.
- **Temporal values and ISO text** (`./temporal-text`): `temporalFromText` reads text with a parser and returns the value or why it was refused. `temporalToText` writes a value of the expected kind, checked by `Symbol.toStringTag` so any implementation's values are accepted, and refuses a value of another kind or a calendar other than ISO 8601. `withoutUtcDesignator` drops a trailing `Z`.
- **`Date` checks** (`./date`): `isValidDate`, `hasDigitsBelowAMillisecond` for ISO text a `Date` cannot hold exactly, and `utcIsoTextOf`, the `Date.toISOString` text of a `Date` on or after a target's earliest instant.
- **ISO 8601 durations** (`./duration`): `ISO_DURATION`, a duration with a sign on each component and no weeks, and `ISO_DURATION_AS_WRITTEN`, which also matches what `Temporal.Duration#toString()` writes: one sign before `P`, and weeks.
