# ADR 251 — Target-owned Postgres list framing

**Status:** Accepted

**Related:** [ADR 030 — Result decoding & codecs registry](ADR%20030%20-%20Result%20decoding%20&%20codecs%20registry.md) makes contract-declared codecs the source of row-value decoding. [ADR 155 — Driver/Codec boundary and lowering responsibilities](ADR%20155%20-%20Driver%20Codec%20Boundary%20and%20Lowering%20Responsibilities.md) separates driver transport from codec semantics. This ADR applies those boundaries to Postgres list framing.

---

## Concrete example

Two Postgres list columns can have the same contract shape but different driver-parser visibility:

| Contract column | Database type | Driver-visible wire before this decision | Target-owned decode after this decision | Application value |
| - | - | - | - | - |
| `tags String[]` | `text[]` | `['api', 'orm']` from `pg`'s registered `text[]` parser | `'{api,orm}'` parsed by the Postgres target, then `pg/text@1` per element | `['api', 'orm']` |
| `moods pg.enum(Mood)[]` | `"Mood"[]` | `'{HAPPY,SAD}'` because the enum array OID is database-local | `'{HAPPY,SAD}'` parsed by the Postgres target, then `pg/enum@1` per element | `['HAPPY', 'SAD']` |

The important property is not the element type. It is that every contract-declared Postgres list reaches one target-owned frame parser and then the same element-codec machinery.

## Context

Postgres list columns cross two boundaries that do not have the same knowledge. The contract knows when a column is a list and which element codec applies. The `pg` parser table knows only the array OIDs statically registered by the library. Builtin arrays such as `text[]` are registered and historically arrived as native JavaScript arrays, while user-defined enum arrays allocate database-local OIDs and arrive as raw Postgres array text.

That split makes two matching columns behave differently. A builtin list and an enum list can both be declared by the contract and physically present in the database, yet one can be decoded by the driver before Prisma Next sees it while the other reaches the element codec as a raw string. The mismatch is not schema drift; it is an ownership problem at the driver/target boundary.

ADR 155 standardizes the driver/codec boundary so codecs do not depend on arbitrary JavaScript library return shapes. ADR 030 says contract-declared codecs drive result decoding. This decision applies those principles to list framing: the target, not the driver parser table, owns the conversion from a Postgres array literal into element values.

## Decision

Inbound Postgres list framing is target-owned. A list-valued column reaches the SQL runtime as raw Postgres array text, and the Postgres target parses that text before mapping the context-bound element decoder over each non-null element.

The SQL runtime selects a concrete `ListDecoder` strategy before row decoding. A target may optionally contribute that strategy; otherwise the SQL family selects its explicit native-array default for non-Postgres paths. The selected decoder receives the wire value and an element decoder that already carries the resolved codec and per-column context. The runtime keeps null short-circuiting, column-aware error wrapping, abort handling, and scalar decoding; the target owns only the list frame and traversal.

The Postgres target implements list framing with `postgres-array`. `parsePostgresListText` accepts raw text only, and `decodePostgresListText` maps the supplied element decoder over parsed elements while preserving SQL null elements as `null`. Parsed non-null elements are strings, so builtin numeric and boolean codecs accept those raw spellings as well as their existing native scalar wire values. Framing alone does not convert `'{1,2}'` to application numbers.

Runtime and control-plane parser policies are related but not identical. Runtime query execution uses `temporalTextTypes`, which returns raw text for temporal scalars and registered array OIDs; temporal scalars then continue through their existing scalar codecs, not through the list decoder. Control-plane queries use `controlTextTypes`, which forces registered array OIDs to raw text so array-valued control fields can be parsed before shared validation.

The Postgres driver configures `pg` to return raw server text for every array OID registered by `pg-types`. Unknown array OIDs already arrive as raw text. Builtin arrays and enum arrays therefore enter the same target path during runtime decoding: raw array text, parsed by the target, decoded by the element codec. Lower-level direct-query consumers of the Postgres driver also see registered array result columns as raw Postgres array text rather than native JavaScript arrays.

The driver's array-OID set is static and guarded. `PG_TYPES_ARRAY_OIDS` must match the array OIDs currently registered by `pg-types`; a divergence test fails when the hand-copied set falls behind. The guard is necessary because a missing registered array OID would silently reintroduce driver framing for that builtin type.

Outbound encoding is intentionally asymmetric. `pg` can serialize a JavaScript array parameter to the Postgres array wire form without knowing the user-defined element OID, while inbound decoding depends on knowing whether the returned value is a list and which element codec to apply. The contract and target have that knowledge; the driver parser table does not.

Postgres control-plane reads that bypass SQL runtime row decoding still normalize target-owned arrays before strict shared validation. Marker `invariants` is parsed from raw Postgres array text by the Postgres adapter before the SQL-family marker validator checks that the semantic row contains `string[]`. Other raw control-plane array fields, such as policy roles and index reloptions, use the same raw-text parser boundary before target-agnostic validation or IR construction.

The system does not accept a dual native-array/raw-text representation at the target list-parser boundary. Accepting both would preserve the hidden split between registered builtin arrays and unregistered enum arrays, and would let one class of values bypass the target framing rule. Native arrays at that boundary are errors.

List framing adds no catalog lookup, per-connection OID cache, projection cast, or separate raw/native catalog path. Existing introspection code may query Postgres catalogs for schema discovery; this decision does not add catalog discovery to result decoding. The contract already identifies the column as a list and names the element codec.

## Consequences

Builtin and enum list columns decode through one raw-text target path. A `text[]` column and a `pg.enum(...)[]` column differ only in their element codec, not in which component framed the array.

The Postgres driver becomes less semantically ambitious. It still owns transport, connection lifecycle, and the underlying library configuration, but it no longer decides which inbound list values become JavaScript arrays. Its registered-array branch returns server text; temporal scalar raw-text behavior remains unchanged.

The SQL runtime remains family-local. It defines the structural hook at the decode call site and always calls a selected list-decoder strategy, while the target contribution remains optional. Postgres supplies a target-owned strategy through its target-aware runtime rather than importing SQL runtime types into the target package.

The Postgres adapter has a narrow control-plane responsibility for marker reads and other raw control fields that do not flow through SQL runtime decoding. It invokes target parsing before shared validation and keeps the validators target-agnostic.

Numeric list values now preserve database text through the numeric scalar codec rather than undergoing the driver's numeric-array float conversion. Fixed-scale `numeric(30,10)[]` therefore returns `"1.5000000000"` where the previous path could return `"1.5"`. This is an observable string-representation change; it aligns list elements with scalar numeric decoding and avoids the driver's intermediate floating-point conversion. Consumers must not rely on the previous spelling or on preservation of the input's original decimal spelling.

Scalar and list decoding now share the same element-codec policy. Builtin element codecs that can receive both raw text and native scalar values accept both shapes; extension codecs used in Postgres list columns should do the same for the scalar values their storage type can return. This is scalar parity at the element boundary, not a promise that every application-visible spelling is unchanged.

The design trades a hand-maintained driver OID set for no new list-framing catalog round trips and one deterministic decode path. The maintenance cost is explicit in the divergence guard; it is not hidden behind runtime fallback behavior.

The design does not add multidimensional array semantics. Postgres does not encode dimensionality in the array type OID, and the contract does not currently express nested lists.

## Implementation anchors

- `CodecRef.many` is the family-agnostic contract bit that marks scalar-array columns: [`codec-types.ts`](../../../packages/1-framework/1-core/framework-components/src/shared/codec-types.ts).
- SQL row decoding records `many` aliases and invokes the selected list decoder; `SqlRuntimeBase` selects the native-array default and Postgres overrides it with the target-owned text decoder: [`decoding.ts`](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts) and [`sql-runtime.ts`](../../../packages/2-sql/5-runtime/src/sql-runtime.ts).
- The Postgres runtime supplies `decodePostgresListText` as its list decoder: [`postgres-runtime.ts`](../../../packages/3-extensions/postgres/src/runtime/postgres-runtime.ts) and [`list-decoder.ts`](../../../packages/3-targets/3-targets/postgres/src/core/list-decoder.ts).
- The Postgres driver parser policy is `PG_TYPES_ARRAY_OIDS`, `controlTextTypes`, and `temporalTextTypes`: [`temporal-text-parsers.ts`](../../../packages/3-targets/7-drivers/postgres/src/temporal-text-parsers.ts).
- Control-plane marker rows are normalized through `parsePostgresListText` before shared marker validation: [`control-adapter.ts`](../../../packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts).

## Alternatives considered

### Accept both native arrays and raw array text

Rejected. A dual representation would keep the hidden split this decision removes: builtin arrays would continue to work because a registered parser happened to know their OID, while enum arrays and other target-owned list types would follow a separate path. That behavior would be hard to test exhaustively and would make future codec authors reason about two list-frame contracts instead of one.

### Resolve array OIDs dynamically from the catalog

Rejected. The contract already says which projected fields are lists. Adding catalog reads or per-connection OID caches would make ordinary result decoding stateful and would introduce invalidation questions for no semantic gain. The static `pg-types` array-OID set is sufficient for registered builtins, and unknown OIDs already arrive as raw text.

### Force projection casts such as `::text[]`

Rejected. Projection casts make the query shape depend on a decode policy and can change database planning or result types. The result decoder should not require query authors or renderers to wrap every list projection just to avoid a driver parser branch.

### Move outbound framing into the target too

Rejected for now. Inbound and outbound have different information requirements. Outbound binding can rely on `pg` serializing JavaScript arrays to Postgres array wire form under the SQL type context the adapter emits. Inbound decoding needs the contract's list bit and element codec to interpret result columns consistently.
