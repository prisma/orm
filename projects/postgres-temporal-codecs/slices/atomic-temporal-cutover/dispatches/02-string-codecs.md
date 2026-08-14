# Brief: D2 — Four `*String` codecs

## Task

Add four identity codecs to the PostgreSQL target that carry PostgreSQL's temporal text to and from the application unchanged: `pg/date-string@1`, `pg/timestamp-string@1`, `pg/timestamptz-string@1`, `pg/time-string@1`. Each is an identity boundary in both directions — an application string is bound exactly as given, and the server's text is returned exactly as sent. PostgreSQL alone decides which inputs are valid and how accepted values are normalised; this dispatch adds no validation, no normalisation, and no canonicalisation. The three precision-bearing variants take `precisionParamsSchema` and render `TimestampString<P>` / `TimestamptzString<P>` / `TimeString<P>`; `pg/date-string@1` takes no params and renders `DateString`. All four declare `targetTypes = []` so they never compete for introspection ownership, and all four carry `traits = ['equality', 'order']`, matching the codecs they will eventually stand beside.

## Reconnaissance deliverable (do this first, report it explicitly)

There are two independent type-rendering paths and the slice needs both pinned before D3 builds on them. Establish empirically — by reading the code and, where cheap, by emitting a fixture — and report:

1. **How does a temporal field's application type reach the generated `contract.d.ts`?** The orchestrator's working understanding is that it comes from `CodecTypes` = `Resolve<ExtractCodecTypes<CodecDescriptorMap>>`, derived from each codec class's `Decoded` type parameter — so `CodecImpl<..., Date, Date>` is what puts `Date` in the emitted declaration. Confirm or correct this.
2. **What does `renderOutputType` actually control**, and how does it relate to the `codecTypeImport(...)` entries in `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts` § `typeImports`? Note that `Timestamp<P>` / `Timestamptz<P>` / `Time<P>` in `packages/3-targets/3-targets/postgres/src/exports/codec-types.ts` are **branded strings**, not `Date`.
3. **The question D3 depends on:** can a descriptor render an output type that has **no** corresponding `typeImports` entry? D3 must emit `Temporal.PlainDateTime` and friends as *ambient globals* with no import, because the project forbids importing polyfill types. If the emit machinery cannot express "rendered type, no import", say so now — that is a design fork, and you halt rather than invent a workaround.

Answering (3) is worth more to this slice than any other single thing in this dispatch. It is cheap here and expensive to discover inside D3.

## Scope

**In:**

- `packages/3-targets/3-targets/postgres/src/core/codec-ids.ts` — four new ID constants.
- `packages/3-targets/3-targets/postgres/src/core/codecs.ts` — four codec classes, four descriptors, four `column()` helpers, following the shape of the existing `PgTimeCodec` / `PgTimeDescriptor` pair, which is already string-typed and is your closest model.
- `packages/3-targets/3-targets/postgres/src/exports/codec-types.ts` — the `DateString` / `TimestampString<P>` / `TimestamptzString<P>` / `TimeString<P>` branded types, if the reconnaissance shows that is where they belong.
- `packages/3-targets/3-targets/postgres/src/core/codec-type-map.ts` — register all four in `codecDescriptorMap`.
- `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts` — `controlPlaneHooks` (`precisionHooks` for the three precision-bearing ones), `storage` entries, `typeImports`.
- Tests for the four codecs.

**Out — do not touch:**

- The existing `PgDateCodec`, `PgTimestampCodec`, `PgTimestamptzCodec`, `PgTimeCodec` and their descriptors. They stay exactly as they are until D6 deletes them. **They are broken by D1 and remain broken.**
- Anything Temporal. No `Temporal` reference, no `requireTemporal`, no `RUNTIME.TEMPORAL_UNAVAILABLE` — all of that is D3's. This dispatch must work with no `Temporal` global present anywhere.
- `jsonProjection` bodies. D4 owns the `text`-cast change for all eight descriptors. Give the new descriptors the same identity `jsonProjection` the existing string-typed `PgTimeDescriptor` has, and let D4 change all eight together.
- Authoring helpers and PSL spellings — D5.
- `timetz`, `interval`.

## Completed when

- [ ] The reconnaissance deliverable above is answered in your report, with citations.
- [ ] All four codecs exist, are registered in `codecDescriptorMap` and in the adapter's `descriptor-meta.ts`, and declare `targetTypes = []`.
- [ ] Tests prove text is forwarded unchanged in both directions, including the values that have no Temporal representation: `infinity`, `-infinity`, a BC date, an extended-year date, and a microsecond-precision `timestamptz`. These are the cases that justify the string representation existing at all — a test suite that only covers ordinary values does not prove the escape hatch works.
- [ ] A test proves session-dependent output is **observable, not hidden**: with `DateStyle` or `TimeZone` set to a non-default value, the codec returns what the server rendered. Do not pin the session to UTC and call that coverage.
- [ ] A test proves the four codecs work with **no global `Temporal` present**. This is the load-bearing property of the string representation.
- [ ] `pnpm --filter @internal/target-postgres typecheck && test && lint` and `pnpm --filter @internal/adapter-postgres typecheck && test && lint` pass.
- [ ] The known-red set has not grown. Baseline is the 9 files / 15 tests in the slice plan § Known-red baseline. If a new file goes red, halt and surface rather than fixing it.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## Halt conditions

- The emit machinery cannot express "rendered output type with no `typeImports` entry" (reconnaissance item 3). Surface with evidence; do not invent a workaround, and do not import a polyfill type to make it work.
- Registering a new codec ID requires touching `packages/1-framework/**` or the generic SQL runtime. The project forbids it; that would mean the registration mechanism is not what the spec assumed.
- You find yourself adding validation, normalisation, or canonicalisation to a `*String` codec. Identity means identity — surface instead.
- Diff exceeds ~12 files.

## References

- Slice spec § Chosen design › Codec taxonomy; § Pre-investigated edge cases (the `DateStyle`, infinity, and BC rows are what your tests must cover).
- Slice plan § D2.
- `projects/postgres-temporal-codecs/learnings.md` — read the entry "Two independent type-rendering paths"; your reconnaissance either confirms or corrects it.
- Closest existing model: `PgTimeCodec` / `PgTimeDescriptor` in `codecs.ts` (~line 1202) — already string-typed.
- `targetTypes = []` precedent: `PgUnboundedIntDescriptor` (`codecs.ts:766`), `PgInt8NumberDescriptor` (`codecs.ts:1028`).

## Operational metadata

- **Model tier:** mid (Sonnet) — the pattern is established by four sibling descriptors; the judgment is concentrated in the reconnaissance, which is read-and-report rather than design-and-decide.
- **Time-box:** 90 minutes.
- **Validation gate:** `pnpm --filter @internal/target-postgres typecheck`, `test`, `lint`; then the same three for `@internal/adapter-postgres`. Per F14, `lint` is a separate CI job and is non-negotiable.
