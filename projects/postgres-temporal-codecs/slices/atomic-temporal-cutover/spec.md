# Slice: atomic-temporal-cutover

Parent project: `projects/postgres-temporal-codecs/`. This slice delivers the project's entire purpose: PostgreSQL temporal values reach the application as `Temporal.*` or as raw PostgreSQL text, chosen explicitly in the contract, with no JavaScript `Date` on any public surface.

## At a glance

The PostgreSQL driver stops letting `pg` construct `Date` objects for temporal OIDs and hands server text to the codec layer instead. Eight representation-explicit codecs replace the four Date-producing ones; `sql/timestamp@1` and `field.timestamp()` are deleted. PSL, TypeScript authoring, introspection, `contract.d.ts`, and every emitted fixture move to the new IDs in the same merged state.

## Chosen design

### Codec taxonomy

Eight descriptors in `packages/3-targets/3-targets/postgres/src/core/codecs.ts`, replacing `PgDateCodec`, `PgTimestampCodec`, `PgTimestamptzCodec`, and `PgTimeCodec`:

| PG native | Canonical PSL | Codec ID | App value | String PSL | Codec ID |
| --- | --- | --- | --- | --- | --- |
| `date` | `Date` | `pg/date-temporal@1` | `Temporal.PlainDate` | `DateString` | `pg/date-string@1` |
| `timestamp(p)` | `Timestamp(p)` | `pg/timestamp-temporal@1` | `Temporal.PlainDateTime` | `TimestampString(p)` | `pg/timestamp-string@1` |
| `timestamptz(p)` | `Timestamptz(p)` | `pg/timestamptz-temporal@1` | `Temporal.Instant` | `TimestamptzString(p)` | `pg/timestamptz-string@1` |
| `time(p)` | `Time(p)` | `pg/time-temporal@1` | `Temporal.PlainTime` | `TimeString(p)` | `pg/time-string@1` |

All eight keep `traits = ['equality', 'order']`, matching the descriptors they replace. Temporal descriptors keep the `targetTypes` their predecessors carried (`['date']`, `['timestamp']`, `['timestamptz']`, `['time']`); string descriptors declare `targetTypes = []` so they never compete for introspection ownership — the same shape `PgUnboundedIntDescriptor` and `PgInt8NumberDescriptor` already use at `codecs.ts:766` and `codecs.ts:1028`.

Precision-bearing descriptors keep `precisionParamsSchema` and `renderPrecision(...)`; the string variants render `TimestampString<P>`, `TimestamptzString<P>`, `TimeString<P>`.

### Driver: text in, text out

`packages/3-targets/7-drivers/postgres/src/postgres-driver.ts` gains a per-query `types` override on both row-producing paths. No global `pg.types.setTypeParser` call, no mutation of a user-supplied `Pool`/`Client` config:

- **Buffered** — `executeBuffered` builds a `QueryConfig`; add `types` to that object.
- **Cursor** — `executeWithCursor` constructs `new Cursor(sql, values)` / `new NamedCursor({...})`. `Cursor`'s third constructor argument is its config, and `NamedCursorOptions.config` already threads it (`named-cursor.ts:11`); `NamedCursor` already forwards `self._conf.types` onto `_result._getTypeParser` (`named-cursor.ts:75`). The cursor path therefore needs the config passed, not a new mechanism.

Scalar temporal OIDs (`date` 1082, `time` 1083, `timestamp` 1114, `timestamptz` 1184) resolve to an identity parser returning server text. Array OIDs (1182, 1183, 1115, 1185) must still yield a JS array whose *elements* are untouched text.

`runExecute` returns only `affectedRows` and needs no override. `explain` runs `EXPLAIN (FORMAT JSON)` and returns no temporal columns; left alone.

### JSON projections

`PostgresCodecDescriptor.jsonProjection` (`codec-descriptor.ts:49`) is the existing per-descriptor hook. All eight temporal descriptors project through a `text` cast so a nested/JSON-built read returns the same server text a flat read returns. `CastExpr` already exists at `relational-core/src/ast/types.ts:950`.

This **replaces** `utcIsoJsonProjection` for `timestamptz`, which today pins UTC and formats via `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"')`. Two consequences, both intended:

- That format's `.MS` is **milliseconds** — the current nested-read path already truncates microseconds. The cast fixes a live precision bug.
- Nested `timestamptz` reads become session-`TimeZone`-dependent, reversing the deliberate UTC-pinning decision documented in that helper's comment. The project spec makes this explicit: hiding session-dependent output is a non-goal, and flat/nested agreement is a requirement. `Temporal.Instant.from()` accepts any offset, so the Temporal codec is unaffected by which offset the session renders.

### Temporal capability check

`RUNTIME.TEMPORAL_UNAVAILABLE` joins `PostgresTargetErrorCode` in `core/errors.ts`; `errorTemporalUnavailable(codecId, operation)` is the internal factory; `requireTemporal()` in `core/codec-helpers.ts` performs the lazy check at codec-invocation time.

**No generic-runtime change is required.** `packages/2-sql/5-runtime/src/codecs/encoding.ts` and `decoding.ts` already pass through anything satisfying `isStructuredError` without re-wrapping (`decoding.ts:243`, `encoding.ts:72`). A structured `RUNTIME.TEMPORAL_UNAVAILABLE` reaches the caller with its code intact, and the generic SQL runtime stays Temporal-unaware for free.

### Authoring

`temporal.timestamp(...)`, `temporal.timestamptz(...)`, `temporal.createdAt()`, `temporal.updatedAt()` keep their names and repoint at the Temporal codecs. Four siblings are added: `temporal.timestampString(...)`, `temporal.timestamptzString(...)`, `temporal.createdAtString()`, `temporal.updatedAtString()`.

These presets come from `temporalAuthoringPresets` / `temporalCodecPresetWithPrecision` in `@internal/family-sql/control` (`postgres/src/core/authoring.ts:2-3, 727-739`) — **shared with the SQLite target**, which calls the same factories with `sqlite/datetime@1` (`sqlite/src/core/authoring.ts:19`). The additions are additive new factories; existing factory signatures and SQLite's behaviour are untouched.

`timestampNow` keeps producing a `Date` internally for mutation defaults and keeps its one-value-per-ORM-operation semantics (`sql-orm-client/src/collection.ts:140`). That `Date` is wire-level only and never reaches a generated type.

### What `prisma init` scaffolds

**Amended at D5** (operator decision). The init template scaffolds the **string** variants:

```prisma
createdAt TimestamptzString @default(now())
updatedAt temporal.updatedAtString()
```

with `field.temporal.createdAtString()` / `updatedAtString()` on the TypeScript side. Four touchpoints across two models in `packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts`.

The forcing function was that the scaffolded app threw `RUNTIME.TEMPORAL_UNAVAILABLE` on stock Node, which has no global `Temporal`. The decision is not merely a workaround for that:

- **Out-of-box works with zero setup.** A user who never opts into Temporal never needs a polyfill, which is the property the string representation exists to provide.
- **The pedagogy survives.** `@default(now())`, the `updatedAt` convention, and both models stay. Deleting the temporal fields entirely — the other candidate — would have removed the only demonstration of storage defaults from the scaffold.
- **The scaffold demonstrates the representation choice** the project is built around, rather than hiding it. A user who wants `Temporal.Instant` changes one word, and if they lack a polyfill the capability error tells them so by name.

`DateTime` is consequently free to select `pg/timestamptz-temporal@1`, consistent with the taxonomy, because the out-of-box path no longer exercises it. Note `DateTime` is a **fifth** authoring spelling, not one of the four bare names in the taxonomy table — the spec's rule about bare `Date` / `Timestamp` / `Timestamptz` / `Time` never constrained it, so this costs nothing against that rule.

### Introspection

`PRESERVED_NATIVE_TYPES` and `PARAMETERIZED_NATIVE_TYPES` in `psl-infer/postgres-type-map.ts` already map `timestamp`/`timestamptz`/`date`/`time` to `Timestamp`/`Timestamptz`/`Date`/`Time`. Those mappings are correct as-is and stay — they now resolve to Temporal-backed codecs. The `*String` PSL names are added as authoring-only spellings with no entry in either introspection map.

## Contract impact

Contract entities affected: **columns** carrying a temporal codec, and the `codecs` block of every emitted `contract.json` / `contract.d.ts`.

- **Retired IDs:** `sql/timestamp@1`, `pg/date@1`, `pg/timestamp@1`, `pg/timestamptz@1`, `pg/time@1`.
- **New IDs:** the eight in the taxonomy table.
- **Changed output types:** temporal fields render `Temporal.PlainDate` / `Temporal.PlainDateTime` / `Temporal.Instant` / `Temporal.PlainTime` or a `string`, never `Date`. Generated declarations reference the *global* `Temporal` namespace and import no polyfill types.
- **Downstream migration:** every checked-in contract artifact is regenerated in this PR. A contract emitted before this change references a codec ID the registry no longer resolves, and fails contract validation rather than silently degrading — the intended hard-cut behaviour. The user-facing migration is the PSL rename (`Timestamp` → `TimestampString` etc.) for anyone who wants the pre-change string or Date-ish behaviour.

## Adapter impact

- **postgres** (`3-targets/postgres`, `6-adapters/postgres`, `7-drivers/postgres`) — the whole of this slice.
- **sqlite** — must be *unaffected*. It shares `temporalAuthoringPresets` / `temporalCodecPreset` from `@internal/family-sql/control`; the `*String` preset factories are additive and SQLite's `sqlite/datetime@1` wiring is untouched. SQLite's package tests are a gate on that claim, not an assumption.
- **mongo** — untouched; no shared temporal surface.

## Coherence rationale

One reviewer holds one question: *does a PostgreSQL temporal value cross every boundary as server text and land as the representation the contract selected?* Every change answers it. The driver change makes the old codecs unrunnable — a `PgTimestampCodec` typed `Date → Date` receives a string the moment the parser override lands — so transport, codecs, authoring, introspection, fixtures, and the deletion of `sql/timestamp@1` cannot be split across PRs without inventing the compatibility layer the project spec forbids. This is the repo's recognised **hard-cut migration of one substrate concept** shape (`drive/calibration/sizing.md`), and matches the TML-2502 precedent: layers of one reviewable change are dispatches, not slices.

## Scope

**In:**

- `packages/3-targets/7-drivers/postgres/` — per-query type-parser overrides on buffered + cursor paths; `named-cursor.ts` config threading.
- `packages/3-targets/3-targets/postgres/src/core/` — `codec-ids.ts`, `codecs.ts`, `codec-helpers.ts`, `codec-type-map.ts`, `errors.ts`, `authoring.ts`, `aggregates.ts`, `psl-infer/postgres-type-map.ts`.
- `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts` — `controlPlaneHooks`, `storage` entries, `typeImports`.
- `packages/2-sql/4-lanes/relational-core/src/ast/` — remove the `sql/timestamp@1` descriptor, codec, helpers, and ID from `sql-codecs.ts` + `sql-codec-helpers.ts`.
- `@internal/family-sql/control` — additive `*String` authoring preset factories.
- `packages/3-targets/6-adapters/postgres-codec-testkit/` — conformance cases + aggregate matrix.
- `packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts` — the scaffold's four temporal touchpoints move to the `*String` variants (added at D5; see § What `prisma init` scaffolds).
- `temporal-polyfill` as a **devDependency** of the test packages that exercise Temporal codecs; global install in test setup only.
- Fixture regeneration: `test/integration/**`, `packages/3-extensions/**` (paradedb, pgvector, supabase, postgis, sql-orm-client), `packages/2-sql/4-lanes/sql-builder/test/fixtures/**`.
- User + architecture documentation for the representation model, Temporal requirement, raw-string contract, and unsupported values.

**Out:**

- `timetz` and `interval` — behaviour unchanged, no Temporal or string variants.
- SQLite and MongoDB temporal representations.
- Any production dependency on a Temporal polyfill.
- An ADR. Operator decision: this lands within the existing ADR 030 / ADR 202 boundaries; the documentation DoD item is satisfied by user-facing docs.

## Pre-investigated edge cases

Outside-codebase knowledge only — PostgreSQL text-output behaviour a dispatch-time grep cannot surface.

| Edge case | Disposition | Notes |
| --- | --- | --- |
| `DateStyle` set to `German` / `SQL` / `Postgres` | Temporal codec throws; error names the codec and recommends the `*String` type | Non-ISO output is unparseable by `Temporal.*.from()`. String codecs return it unchanged — that is the documented escape hatch. |
| `timestamptz::text` spelling | Verify, do not assume | PostgreSQL renders `2026-01-02 03:04:05.678901+00` — space separator, two-digit offset. Temporal's grammar is expected to accept both, but the dispatch must prove it with a test rather than reason about it. |
| BC dates (`0044-03-15 BC`) | Narrow adaptation before `Temporal.*.from()` | Temporal expects `-000043-03-15` (proleptic, off-by-one year). This is the "narrow BC adaptation" the project spec permits; it is not a general ISO grammar. |
| `infinity` / `-infinity` | Temporal codecs reject with the boundary error; string codecs pass through | PostgreSQL-specific sentinels with no Temporal representation. |
| Expanded years beyond ±271821 | Temporal codecs reject with the boundary error | Outside Temporal's supported range. |
| Sub-microsecond writes (`Temporal` nanoseconds) | Send full precision; let PostgreSQL round | Rounding can carry into the next second. Prisma neither truncates nor rejects. |
| `Temporal.PlainDate` / `PlainDateTime` with a non-ISO calendar | Reject on write | Never silently discard an authored calendar. |

## Slice-specific done conditions

- [ ] `rg 'sql/timestamp@1|SQL_TIMESTAMP_CODEC_ID'` returns zero hits in `packages/**/src/**` and zero in regenerated fixtures.
- [ ] `rg "pg/date@1|pg/timestamp@1|pg/timestamptz@1|pg/time@1"` returns zero hits outside `timetz`/`interval` contexts.
- [ ] No generated `contract.d.ts` types a temporal field as `Date`.
- [ ] `pnpm fixtures:check` passes and regenerated fixtures are committed.
- [ ] A client whose contract uses only `*String` codecs constructs and executes with no global `Temporal` present.
- [ ] `pnpm lint:deps` passes — no Temporal or PostgreSQL vocabulary entered `packages/1-framework/**` or the generic SQL runtime.

## Open Questions

1. **Temporal array-OID decoding.** Working position: delegate temporal array OIDs to `pg`'s own `text[]` parser (OID 1009) so the array structure is parsed while elements stay untouched text. Avoids vendoring array-literal parsing. The dispatch confirms `pg-types` exposes this by OID lookup; if not, `postgres-array` with an identity element parser is the fallback.
2. **`Temporal.Instant.from()` on PostgreSQL's `+00` offset and space separator.** Working position: it parses. This is load-bearing for every `timestamptz` read, so the first Temporal-codec dispatch proves it with a test before the rest of the codecs are built on the assumption.
3. **Nested `timestamptz` becomes session-`TimeZone`-dependent.** Working position: accept and document. Flat/nested agreement plus microsecond fidelity are explicit project requirements; UTC-pinning cannot deliver either. Any test asserting a `+00:00` suffix on a nested read needs rewriting, not preserving.
4. **`Time` changes representation for existing users.** Working position: proceed. `PgTimeCodec` is *already* string-typed (`codecs.ts:1202-1220`), so bare `Time` moves `string → Temporal.PlainTime` — a breaking change for anyone using it today. `TimeString(p)` is the one-word migration and belongs in the docs deliverable.

## References

- Parent project: [`projects/postgres-temporal-codecs/spec.md`](../../spec.md)
- Linear issue: N/A — waived by the operator for this project.
- [PostgreSQL codecs](../../../../packages/3-targets/3-targets/postgres/src/core/codecs.ts) · [codec descriptor base](../../../../packages/3-targets/3-targets/postgres/src/core/codec-descriptor.ts) · [target errors](../../../../packages/3-targets/3-targets/postgres/src/core/errors.ts)
- [PostgreSQL driver](../../../../packages/3-targets/7-drivers/postgres/src/postgres-driver.ts) · [named cursor](../../../../packages/3-targets/7-drivers/postgres/src/named-cursor.ts)
- [Generic decode path](../../../../packages/2-sql/5-runtime/src/codecs/decoding.ts) · [generic encode path](../../../../packages/2-sql/5-runtime/src/codecs/encoding.ts) — structured-error passthrough
- [ADR 030 — Result decoding and codecs registry](../../../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md) · [ADR 202 — Codec trait system](../../../../docs/architecture%20docs/adrs/ADR%20202%20-%20Codec%20trait%20system.md)
- [`drive/calibration/sizing.md`](../../../../drive/calibration/sizing.md) — hard-cut migration slice shape; TML-2502 precedent
