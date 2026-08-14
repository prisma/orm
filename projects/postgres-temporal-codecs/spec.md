# PostgreSQL Temporal Codecs

## Purpose

Give PostgreSQL users semantically correct temporal values without the precision loss and timezone ambiguity of JavaScript `Date`, while preserving a string representation for applications that want PostgreSQL to own temporal parsing and formatting. Make the representation choice explicit in contracts so generated types, runtime behavior, and introspection agree.

## At a glance

PostgreSQL temporal columns gain two explicit application representations:

| PostgreSQL type | Canonical PSL type | Canonical application value | String PSL alternative | Codec IDs |
| --- | --- | --- | --- | --- |
| `date` | `Date` | `Temporal.PlainDate` | `DateString` | `pg/date-temporal@1`, `pg/date-string@1` |
| `timestamp(p)` | `Timestamp(p)` | `Temporal.PlainDateTime` | `TimestampString(p)` | `pg/timestamp-temporal@1`, `pg/timestamp-string@1` |
| `timestamptz(p)` | `Timestamptz(p)` | `Temporal.Instant` | `TimestamptzString(p)` | `pg/timestamptz-temporal@1`, `pg/timestamptz-string@1` |
| `time(p)` | `Time(p)` | `Temporal.PlainTime` | `TimeString(p)` | `pg/time-temporal@1`, `pg/time-string@1` |

Native PostgreSQL introspection chooses the Temporal-backed type. String alternatives are explicit author choices and do not claim native-type introspection mappings.

```prisma
model Event {
  occurredAt Timestamptz(6)
  sourceTime TimestampString(6)
}
```

The `pg` driver returns temporal wire values as text rather than constructing `Date` objects. A Temporal codec asks the application's global `Temporal` implementation to parse that text; a string codec passes the text through unchanged. On writes, Temporal values use their `toString()` representation and string values are sent unchanged, leaving PostgreSQL responsible for accepted spellings, native ranges, normalization, and precision rounding.

## Non-goals

- Bundling or selecting a Temporal polyfill for the application.
- Preserving JavaScript `Date` as a public field representation or maintaining compatibility aliases for the codecs being replaced.
- Adding Temporal or new string representations for PostgreSQL `timetz` or `interval`; their existing behavior remains unchanged.
- Defining a cross-database generic timestamp representation. The generic `sql/timestamp@1` codec is removed rather than evolved.
- Normalizing, validating, or canonicalizing application values handled by a `*String` codec before PostgreSQL receives them.
- Hiding PostgreSQL session-dependent textual output such as `DateStyle` or `TimeZone` from string users.
- Representing PostgreSQL infinity or finite values outside Temporal's range with Prisma-specific Temporal sentinels.
- Supporting non-ISO calendars on `Temporal.PlainDate` or `Temporal.PlainDateTime` writes.
- Translating Temporal astronomical or expanded-year notation into PostgreSQL year notation on writes; PostgreSQL remains authoritative and may reject those values.

## Place in the larger world

The PostgreSQL target owns the representation-specific codec descriptors, IDs, traits, native types, JSON projections, output-type rendering, and authoring contributions. The generic SQL runtime continues to resolve and invoke codecs by contract ID without knowing PostgreSQL OIDs or Temporal semantics.

The PostgreSQL driver is the lossless transport boundary. It uses per-query `pg` type-parser overrides for scalar and array temporal OIDs in both buffered and cursor execution, avoiding global parser mutation and preserving user-provided `Pool` and `Client` configuration. The parser returns server text unchanged so microseconds and PostgreSQL-specific values reach the selected codec without an intermediate `Date`.

Contract authoring and emission expose the representation choice in PSL, TypeScript helpers, `contract.json`, and `contract.d.ts`. Canonical introspection maps native PostgreSQL temporal columns to the Temporal-backed PSL types. String descriptors have no `targetTypes`, preventing them from competing for introspection ownership.

Temporal is an application-provided global capability. Applications may use native Temporal where available or install a global polyfill such as `import 'temporal-polyfill/global'`; Prisma does not import or bundle one. Missing Temporal is detected only when a Temporal codec is invoked, not while assembling descriptors, validating a contract, or creating a runtime.

The existing `timestampNow` mutation-default generator remains the clock for `temporal.updatedAt()` and its representation-specific siblings. Its query stability continues to provide exactly one generated timestamp across every row, field, and SQL statement in one ORM operation. Its private use of `Date` to obtain the current timestamp is allowed; `Date` does not appear in public field types or decoded values.

Removing `sql/timestamp@1` retires the generic `field.timestamp()` path and its registrations, metadata, aggregate mappings, tests, and documentation. PostgreSQL authoring uses the representation-explicit native codecs instead.

## Cross-cutting requirements

- The eight codec IDs are representation-explicit and stable. Temporal and string variants for the same PostgreSQL native type retain the same equality and ordering capabilities.
- Bare PSL `Date`, `Timestamp`, `Timestamptz`, and `Time` map to Temporal-backed codecs. `DateString`, `TimestampString`, `TimestamptzString`, and `TimeString` select string codecs explicitly. Precision-bearing variants preserve precision in contract type parameters and native type rendering.
- TypeScript authoring keeps `temporal.timestamp(...)`, `temporal.timestamptz(...)`, `temporal.createdAt()`, and `temporal.updatedAt()` as the canonical Temporal helpers. It adds `temporal.timestampString(...)`, `temporal.timestamptzString(...)`, `temporal.createdAtString()`, and `temporal.updatedAtString()` with equivalent precision and default behavior.
- Generated declarations use the global `Temporal.PlainDate`, `Temporal.PlainDateTime`, `Temporal.Instant`, and `Temporal.PlainTime` types. They do not import polyfill-specific types or runtime code.
- String codecs are identity boundaries for scalar values: application strings are bound unchanged, and PostgreSQL wire text is returned unchanged. PostgreSQL alone decides which inputs are valid and how accepted values are normalized.
- PostgreSQL temporal values are decoded from text in buffered queries, cursor queries, arrays, and JSON-built relation results. Temporal expressions are cast to `text` before PostgreSQL JSON construction so flat and nested results expose the same server textual representation.
- Temporal codecs use the corresponding `Temporal.*.from()` operation as the authoritative parser and range validator. Prisma does not maintain an ISO grammar regex. Read-side handling is limited to PostgreSQL-specific infinity detection and the narrow BC or expanded-year adaptation required before Temporal parsing.
- Temporal codecs reject `infinity`, `-infinity`, finite values outside Temporal's supported range, and other PostgreSQL values Temporal cannot represent. Errors identify the codec and value boundary and recommend the corresponding `*String` type where lossless access is required.
- Temporal date and timestamp writes accept only the `iso8601` calendar. Database reads construct ISO-calendar Temporal values; Prisma never silently discards a non-ISO authored calendar.
- Temporal writes serialize all available fractional precision. PostgreSQL rounds to the column's declared precision, including carries into the next second; Prisma neither rejects nor truncates sub-microsecond input.
- Temporal values are sent using their `toString()` spelling without reverse conversion of Temporal year numbering. PostgreSQL range and input validation errors remain database errors.
- A missing global Temporal implementation produces `RUNTIME.TEMPORAL_UNAVAILABLE` lazily when a Temporal codec is invoked, with actionable global-polyfill guidance. The PostgreSQL target owns this error: `PostgresTargetErrorCode` and an internal `errorTemporalUnavailable(codecId, operation)` factory live in `packages/3-targets/3-targets/postgres/src/core/errors.ts`, while a `requireTemporal()` helper in `codec-helpers.ts` performs the capability check. The factory records the codec ID and operation and explains how to install a global implementation. It returns a structured error so generic encode and decode machinery passes the stable code through unchanged instead of wrapping it as `RUNTIME.ENCODE_FAILED` or `RUNTIME.DECODE_FAILED`. The generic SQL runtime and framework error modules remain unaware of Temporal. String codecs and runtime construction never require Temporal.
- The generic codec runtime, execution-context assembly, and descriptor factory lifecycle gain no PostgreSQL- or Temporal-specific hooks. PostgreSQL-specific behavior stays in the target codecs and driver.
- The private `Date` produced by `timestampNow` remains operation-scoped and wire-compatible for mutation defaults. It does not widen generated contract types or reintroduce a user-selectable Date codec.
- Documentation explains representation semantics, raw PostgreSQL string behavior, Temporal installation expectations, unsupported values, precision behavior, and migration away from `sql/timestamp@1` and the old PostgreSQL temporal codec IDs.

## Transitional-shape constraints

- No compatibility codec aliases or hidden Date fallbacks are introduced. Call sites and emitted contracts move to the new IDs rather than preserving the old representation surface.
- The raw driver cutover, canonical authoring and introspection transfer, old PostgreSQL codec removal, and `sql/timestamp@1` retirement merge atomically. No merged state emits an unresolved new ID or retains an active Date codec that requires driver-created temporal values.
- Dispatches inside the atomic cutover may establish implementation substrates in sequence, but none is an independently mergeable compatibility stage.
- The `sql/timestamp@1` descriptor, helper, registrations, and consumers are removed in that same coherent cutover so no merged state retains dangling references.
- String codecs remain usable without Temporal throughout the transition.
- Generic runtime layers remain target-agnostic throughout the project; transitional convenience branches on the PostgreSQL target are not permitted.

## Project Definition of Done

- [ ] Repository delivery requirements in [`AGENTS.md`](../../AGENTS.md) and the [Testing Guide](../../docs/Testing%20Guide.md) are satisfied for every affected package and end-to-end path.
- [ ] Contracts can select all eight representation-specific codecs, and generated TypeScript surfaces expose the intended Temporal or string application types without public `Date` alternatives.
- [ ] PostgreSQL introspection emits the canonical Temporal-backed PSL types with native precision, while explicitly authored string alternatives round-trip through contract emission without claiming introspection ownership.
- [ ] Buffered, cursor, array, flat, and nested JSON reads preserve PostgreSQL temporal text through the driver and decode correctly for both representations without microsecond loss.
- [ ] Temporal round-trip coverage includes ordinary values, nanosecond writes rounded by PostgreSQL, offsets for `timestamptz`, ISO-calendar enforcement, BC and expanded-year reads, infinity, out-of-Temporal-range values, and incompatible PostgreSQL textual output.
- [ ] String coverage proves that PostgreSQL-accepted input is forwarded unchanged and that infinity, extended ranges, session timezone, and session date-style output remain observable as PostgreSQL text.
- [ ] Missing Temporal fails lazily with `RUNTIME.TEMPORAL_UNAVAILABLE`, while string-only clients construct and execute without a Temporal global.
- [ ] `temporal.createdAt()` and `temporal.updatedAt()` retain their storage-default and one-value-per-ORM-operation semantics, and their `*String` counterparts provide equivalent behavior.
- [ ] `sql/timestamp@1`, the generic `field.timestamp()` helper, old PostgreSQL temporal codec IDs, and all production references to their public Date representation are removed without compatibility shims.
- [ ] PostgreSQL `timetz` and `interval` behavior is unchanged, and no Temporal-specific knowledge is added to the generic SQL runtime.
- [ ] Canonical user and architecture documentation describes the final representation model, runtime requirement, raw string contract, driver boundary, and unsupported-value behavior.

## Open Questions

None. The representation taxonomy, runtime ownership, driver boundary, precision policy, unsupported-value behavior, default semantics, helper names, and compatibility policy were settled during design discussion.

## References

- [PostgreSQL codec IDs](../../packages/3-targets/3-targets/postgres/src/core/codec-ids.ts)
- [PostgreSQL codecs](../../packages/3-targets/3-targets/postgres/src/core/codecs.ts)
- [PostgreSQL target errors](../../packages/3-targets/3-targets/postgres/src/core/errors.ts)
- [PostgreSQL driver](../../packages/3-targets/7-drivers/postgres/src/postgres-driver.ts)
- [SQL codec runtime](../../packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts)
- [SQL runtime context](../../packages/2-sql/5-runtime/src/sql-context.ts)
- [PostgreSQL authoring contributions](../../packages/3-targets/3-targets/postgres/src/core/authoring.ts)
- [ADR 030 — Result decoding and codecs registry](../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md)
- [ADR 169 — Declared applicability for mutation default generators](../../docs/architecture%20docs/adrs/ADR%20169%20-%20Declared%20applicability%20for%20mutation%20default%20generators.md)
- [ADR 181 — Contract authoring DSL for SQL TS authoring](../../docs/architecture%20docs/adrs/ADR%20181%20-%20Contract%20authoring%20DSL%20for%20SQL%20TS%20authoring.md)
- [ADR 202 — Codec trait system](../../docs/architecture%20docs/adrs/ADR%20202%20-%20Codec%20trait%20system.md)
- [Temporal proposal documentation](https://tc39.es/proposal-temporal/docs/)
- [PostgreSQL date/time types](https://www.postgresql.org/docs/current/datatype-datetime.html)
- [`node-postgres` type parsing](https://node-postgres.com/features/types)
