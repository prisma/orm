# Native Postgres enums — plan

**Spec:** [`spec.md`](spec.md) · **Designs:** [`specs/authoring-design.md`](specs/authoring-design.md), [`specs/querying-design.md`](specs/querying-design.md), [`specs/migration-design.md`](specs/migration-design.md)

## Status

Phase 1 (external enums) is **shipped** — [PR #906](https://github.com/prisma/prisma-next/pull/906). The forward work is Phase 2 (managed enums) and the TS authoring mirror, below. This plan is the work breakdown; the design is in [`spec.md`](spec.md).

## Shipped — Phase 1 (external enums, no DDL)

The complete external-enum vertical — represent → type → cast → runtime access → Supabase demonstration. Satisfies **R1–R5**. Design of record: [`spec.md`](spec.md); implementation is the commits below.

- **Representation, typing, cast, `db.nativeEnums`** (`cbb1f6e50` → `a105437f6`) — the `native_enum` pack entity + derived value-set; the `pg.enum(Ref)` column + `pg/enum@1` codec typed via the value-set → codec path; the per-column `$N::<type>` cast; the Postgres-only `db.nativeEnums` accessor. Satisfies R1–R4.
- **Supabase demonstration + schema-qualification fix** (`b8c4a69a7`, `1a3306cf4`) — the Supabase extension declares `auth.aal_level`; the example proves the whole path end-to-end against real Postgres. Running it for real exposed that a non-`public` schema needs a **schema-qualified** type reference (`auth.aal_level`) for both the cast and `db verify` — fixed by qualifying the column's `nativeType` by its namespace. Satisfies R5 and proves R1–R4 end-to-end.

## Shipped — infer adoption (R6, pulled forward from Phase 2)

- **`contract infer` adopts native enum types** instead of throwing — introspection reads ordered member values (`pg_enum.enumsortorder`), infer emits `native_enum` blocks + `pg.enum(<Name>)` columns wrapped in an explicit `namespace <schema> { … }` block (enum-free output stays byte-identical), pack-owned types subtract by type name, and a live PGlite round trip proves infer → emit → `db verify` against the source database for the `public` and `auth.aal_level` shapes. Slice spec: [`slices/infer-native-enum-adoption/spec.md`](slices/infer-native-enum-adoption/spec.md).
- **R6 status:** adoption shipped **ahead of Phase-2 Slices A/B** (sequencing inversion, unblocks Supabase Slice F). The managed lifecycle (`CREATE TYPE` / `DROP TYPE` / `ADD VALUE`, differ integration) is still forward work below — an inferred enum under `defaultControl: 'managed'` claims a lifecycle the planner does not yet enforce until Slices A/B land.

## In flight — native_enum serializes into contract.json

- **`entries.native_enum` becomes an ordinary enumerable entries kind** so it round-trips through `contract.json` and is captured by `storageHash` (hardens R1; prerequisite for the Phase-2 planner reading ordered members from storage, and for pack-owned subtraction on production-hydrated contracts). Closes the infer-adoption slice's "serialized pack contracts expose no enum type names" follow-up. Slice spec: [`slices/serialize-native-enum-entities/spec.md`](slices/serialize-native-enum-entities/spec.md).

## Forward work

### Generic namespace-`entries` serialization — shipped, [TML-2981]

- **Outcome:** the SQL contract serializer emits a namespace's entity kinds by iterating `entries` (symmetric with the already-generic hydrate path), so an extension-contributed kind round-trips with no serializer edit; byte-identical emitted output. Merged: PR #931.
- **The work:** lift generic entries serialization into `SqlContractSerializerBase`; rewire the Postgres + SQLite serializers to delegate; `native_enum` stays excluded via non-enumerability. Slice spec: [`slices/generic-namespace-entries-serialization/spec.md`](slices/generic-namespace-entries-serialization/spec.md).
- **Origin:** review point O1 on PR #906.

### TS authoring mirror — shipped, [TML-2965]

- **Outcome:** a `native_enum` is authorable in the TS DSL (`nativeEnum(…)` + `field.column(pg.enum(handle))`), producing a contract byte-identical to the PSL version. Merged: [PR #935](https://github.com/prisma/prisma-next/pull/935).
- **The work:** a generic **`ContractDefinition` pack-entity attachment** — route author-declared, namespace-scoped pack entities into `entries.<kind>` (+ derive their value-set) through the `defineContract` chain, following the `enums` wiring; a bespoke `nativeEnum(...)` handle + deferred `pg.enum(handle)` descriptor; and relocating type-name qualification out of the codec into a generic build-stage step (so a named schema like `auth` is authorable in TS). Slice spec: [`slices/native-enum-ts-authoring/spec.md`](slices/native-enum-ts-authoring/spec.md).
- **Follow-ups:** RLS `role`/`policy` TS wiring rides the same seam (unexercised here); the auto-composed generic `type.pg.enum` path repair is [TML-2983](https://linear.app/prisma-company/issue/TML-2983).
- **Proven by:** a PSL + TS byte-identical parity test.

### Parser `refKind` for entity-ref type-constructor arguments — deferred, [TML-2978]

- **Outcome:** the PSL parser / symbol table knows a type-constructor argument (e.g. `AalLevel` in `pg.enum(AalLevel)`) is a reference — enabling parse-time / LSP scope validation and editor navigation (go-to-definition / rename / autocomplete) on it.
- **Why deferred:** not a correctness dependency. The native-enum generic collapse ([`specs/native-enum-generic-collapse.md`](specs/native-enum-generic-collapse.md)) declares "argument is a ref" on the type-constructor descriptor and resolves it in the interpreter, so a bad reference is still rejected (at build time). This is the grammar/LSP layer on top — purely additive author ergonomics, and it lives in the PSL parser, a different area from the collapse. **Consider once the collapse and the Phase-1 critical path are complete.**

### Phase 2 — managed native enums

Prisma Next creates and drops the type and migrates **add-value** in place. Satisfies **R6–R10**. Design: [`spec.md`](spec.md) § Phase 2 and [`specs/migration-design.md`](specs/migration-design.md). Three vertical slices, in order, each proven against a live database:

- **Slice A — create / delete (R7, R10). SHIPPED.** Slice: [`slices/managed-native-enum-create-delete/spec.md`](slices/managed-native-enum-create-delete/spec.md). `PostgresNativeEnumSchemaNode` (schema-scoped identity, ordered-member equality, carries the expected-side `control` grade); both projections (contract `entries.native_enum` → expected nodes, introspected `nativeEnums` → actual nodes) feed the unified differ, which reports missing / extra / value-mismatch, graded by control policy (`managed` fails/plans, `external`/`observed` suppress — R5 Phase-1 enums untouched); `CREATE TYPE` / `DROP TYPE` ops ordered before/after the dependent column (via the existing dep/drop buckets); a `pg.enum` column's type renders as its schema-qualified, per-segment-quoted identifier in CREATE TABLE DDL (`"auth"."aal_level"`). Drop-safety resolves enum ownership by **physical type name** across all composition spaces (`compositionStorages`), so a pack's `@@map`-renamed enum in a shared schema is never wrongly dropped. Proven live (PGlite) for both `public` and named-schema shapes. **A value-mismatch is reported by verify but the planner emits a named unsupported diagnostic — `"…enum value changes are not auto-migrated yet. Author the change manually with \`migration new\`."` — which Slice B replaces.**
- **Slice B — add value (R8, R9). NEXT — shaped.** Slice: [`slices/managed-native-enum-add-value/spec.md`](slices/managed-native-enum-add-value/spec.md). The order-aware diff — a pure suffix-append → `ALTER TYPE … ADD VALUE`; a rename, removal, or reorder is refused with a diagnostic and never lowered to an op — plus the `ADD VALUE` op, with its non-transactional caveat surfaced to the runner. Replaces Slice A's value-mismatch diagnostic (wording above) with the real ADD VALUE lowering / refusal semantics. Not on the Supabase critical path (operator ruling). Slice A's enums-only-namespace limitation is **not** folded in here — it turned out to be an authoring-surface bug (the contract builder derives a namespace from its models), so it moves to its own generic contract-builder slice (below).
- **Slice C — adoption (R6). SHIPPED** ahead of Slices A/B via [PR #944](https://github.com/prisma/prisma-next/pull/944) (see "Shipped — infer adoption" above); `contract infer` emits `native_enum` blocks inheriting `defaultControl`. The managed-grade enforcement it claimed is now provided by Slice A.

**Known limitations carried by Slice A** (see its spec): an **enums-only namespace** (a contract namespace declaring enums but no tables) never reaches verify/plan. Root cause (found while shaping Slice B): `buildSqlContractFromDefinition` derives a namespace's existence from its **models** plus three hand-rolled additions (default, value-objects, domain enums); the generic pack-entity collection contributes no namespaces, so a model-less namespace holding only a `native_enum` (or any pack-contributed entity) is dropped before it can be diffed — and `contract infer` emits such a namespace as PSL that vanishes on the next build. This is a **generic contract-builder** bug, not native-enum-specific; it gets its own slice (derive the namespace set from all collected content + move Slice A's `pruneTableLessNamespaces` prune to match + an infer round-trip proof). The **drop-safety type-name ownership gap is CLOSED** (not a limitation) — resolved in Slice A via `compositionStorages`.

## Dependencies

- **Value-set → codec typing ([TML-2952]).** Merged and in this branch; native typing rides it unchanged (a native column carries a `valueSet` ref like a check-enum column).
- **Pack-entity + variadic-block mechanisms** (`postgresAuthoringEntityTypes`, `variadicParameters` block descriptors, `composeSqlEntityKinds`). Landed — RLS and the SQL `enum` block ship on them.
- **[TML-2960]** (no-emit per-instance column typing). Not a blocker: emit typing works today; no-emit column typing is out of scope until 2960 lands.
- **Phase 2 only:** the RLS SchemaIR differ + extension-contribution seam — the template Phase 2's SchemaIR node, projection, and diff integration follow.

## Tracker

Linear was intentionally skipped for the shipped Phase-1 slices (tracked in-repo). Cross-cutting follow-ups filed: **[TML-2960]** (no-emit per-instance column typing), **[TML-2965]** (TS authoring mirror + the generic `ContractDefinition` pack-entity attachment, shared with RLS), and **[TML-2978]** (parser `refKind` for entity-ref type-constructor arguments, deferred from the generic collapse — consider post-critical-path).
