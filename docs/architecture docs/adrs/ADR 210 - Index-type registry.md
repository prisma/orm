# ADR 210 — Index-type registry

> **Decision (in one sentence):** Index types live in a per-contract registry assembled from the contract's extension packs; each entry pairs a `type` literal with an `arktype` validator for its `options`, and that pair is what the authoring DSL narrows against, what the lowering validates against, and what the framework-owned Postgres renderer reads from when emitting `CREATE INDEX … USING <method> WITH (…)`.

## A grounding example

Postgres has more than one kind of index. The default is a B-tree, but there's also `gin` (good for full-text search and array containment), `gist` (geometric and range types), `hash`, `brin`, `spgist`. Extensions add more — for example, the `paradedb` extension contributes a `bm25` index built on top of Tantivy for ranked text search.

Each index method takes its own set of *storage parameters* — passed as `WITH (key = value, …)` in DDL. `gin` accepts `fastupdate` (a boolean). `bm25` accepts `key_field` (a column name) and a few other knobs. Treating "what storage parameters does this method accept?" as a property of the method itself — and asking each method to describe that shape once — is what this ADR is about.

A pack contributes an index type by declaring it once, alongside an `arktype` validator describing its `options`:

```ts
// packages/3-extensions/paradedb/src/types/index-types.ts
import { defineIndexTypes } from '@internal/sql-contract/index-types';
import { type } from 'arktype';

export const paradedbIndexTypes = defineIndexTypes().add('bm25', {
  options: type({
    '+': 'reject',         // reject any extra option keys (registrant opt-in)
    key_field: 'string',
  }),
});
```

A pack publishes that registration on its descriptor under `indexTypes:`. A contract that attaches the pack can then author indexes against `bm25` and the authoring surface narrows on it:

```ts
// In a contract that has paradedbPack attached as an extension pack:
const Item = model('Item', {
  fields: { id: field.column(int4Column).id(), body: field.column(textColumn) },
}).sql(({ cols, constraints }) => ({
  table: 'item',
  indexes: [
    constraints.index([cols.body], {
      type: 'bm25',
      options: { key_field: 'id' },     // arktype-validated against bm25's shape
    }),
  ],
}));
```

The same authoring surface in PSL:

```prisma
model Item {
  id   Int    @id
  body String
  @@index([body], type: "bm25", options: { key_field: "id" })
}
```

Three classes of mistake are caught at the boundary closest to the author:

```ts
// Compile error: 'made-up' is not a key in the merged registry
constraints.index([cols.body], { type: 'made-up', options: {} });

// Compile error (from arktype's TS narrowing): 'tokenizer' isn't in bm25's shape;
// at runtime, validation also fails because the registrant opted into '+': 'reject'
constraints.index([cols.body], { type: 'bm25', options: { tokenizer: 'std' } });

// Runtime error at lowering: missing required key_field
constraints.index([cols.body], { type: 'bm25', options: {} });
```

The rest of this document is the vocabulary, the lifecycle, and the layering rules behind that example.

## What this is solving

Without a central concept of *what index types exist and what their options look like*, three things happen:

- **Authors put any string in the type slot and any object in the options slot** with no feedback until DDL apply time, where Postgres returns an opaque error or — worse — silently accepts an unknown storage parameter that does nothing.
- **Extension authors duplicate type-and-validation work per index type**, and have no shared discipline about how strictness, dialect-neutral naming, and renderer safety interact.
- **There is no extension point for end users** to add their own index types without forking the schema validator.

The registry resolves all three by giving the system one place that knows which `type` values are legal in a contract, what each type's `options` shape is, and how to render the result safely. Once that single source of truth exists, the authoring DSL, the lowering, the migration planner, the schema verifier, and the DDL renderer all consult it instead of each carrying their own lookup.

## The registry primitive

An entry is a pair: a `type` literal and a validator describing the entry's `options`.

```ts
type IndexTypeEntry<TOptions> = {
  readonly type: string;
  readonly options: arktype.Type<TOptions>;
};
```

Entries are produced by a small fluent builder. The builder is the only way an entry comes into existence; there is no other constructor:

```ts
defineIndexTypes()
  .add('bm25',  { options: type({ '+': 'reject', key_field: 'string' }) })
  .add('vector', { options: type({ '+': 'reject', m: 'number', ef_construction: 'number' }) });
```

`defineIndexTypes()` returns a value carrying both the runtime entry list and a TypeScript-only phantom map of `type` literal → `options` shape. The same value is what a pack stores on its descriptor; both halves stay in lockstep automatically because both come from the same builder call. Drift between the runtime shape and the TS shape becomes a TypeScript error at the `.add(…)` call site, not a runtime surprise downstream.

Calling `.add(name, …)` twice with the same `name` is a builder-time error naming the duplicate. The builder is immutable — every `.add(…)` returns a new builder — so the resulting registration is safe to share across contracts that attach the same pack.

## How packs and contracts compose

Index-type composition is **per-contract**, not workspace-global. Two contracts in the same workspace that attach different packs see different valid `type` sets. This is intentional: a contract's vocabulary is a function of its own pack list and nothing else.

A pack publishes its registration on its descriptor under a single field (`indexTypes`). The pack stores the value verbatim — there is no copy, no transformation. The contract-definition pipeline reads each pack's `indexTypes`, intersects the per-pack maps at the type level, and builds a fresh per-contract registry at the runtime level:

| Layer    | What composes                                                                                                                                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type** | The contract's authoring DSL accepts `IndexTypes = TargetIndexTypes & PackAIndexTypes & PackBIndexTypes & …`. `constraints.index(cols, { type, options })` discriminates on `type`; `options` narrows to the entry's shape; an unknown `type` is a compile error. |
| **Runtime** | `assertStorageSemantics` (called from the contract lowering) instantiates `createIndexTypeRegistry()` and walks the same pack list, registering every entry. Two packs registering the same `type` literal surface as a registration-time error naming the conflict. |

No `declare module` augmentation is used. A global module augmentation would mean every contract in the workspace saw every loaded pack's index types — wrong by composition: a contract that didn't attach `paradedb` shouldn't see `bm25`. The per-pack registration value avoids this entirely.

## Where validation runs

The validation seam is the lowering function that turns a `ContractDefinition` (the in-memory IR produced by either authoring chain) into a final `Contract<SqlStorage>`. Both authoring surfaces converge on this seam:

- **TS chain**: `defineContract({…})` → `buildContractFromDsl` → `buildSqlContractFromDefinition`.
- **PSL chain**: `interpretPslDocumentToSqlContract` constructs a `ContractDefinition` from the PSL AST and calls the same lowering.

At the seam, the lowering builds the per-contract registry from the definition's pack list, walks every index in the storage IR, and rejects:

- Unregistered `type` literals.
- `options` that fail the registered validator (missing required keys, wrong types, extra keys *if* the registrant opted into `'+': 'reject'`).
- `options` set without `type`.

Errors fire at authoring time — at the line that wrote the offending model — not when a downstream consumer loads the emitted `contract.json`.

### Index-type validation is authoring-time, not JSON-loading-time

`validateContract` (called by runtime drivers when loading `contract.json`) does **structural and referential** validation only: it checks shape, internal references between named objects, codec default decoding — things that depend only on the loaded JSON. It deliberately does **not** consult an index-type registry, because the registry isn't part of the JSON. The registry is a function of the *packs attached to the contract definition*, which exist at design time and are gone by the time the JSON is loaded.

This split is load-bearing:

- The runtime path stays simple — `validateContract` doesn't need a registry, and a driver loading a contract doesn't need to know about packs.
- A contract that reaches a driver has, by construction, already been validated against its pack-derived registry at the lowering seam.
- A contract authored by a tool that bypasses the lowering will not be checked against any registry — that is the explicit trade-off the layering makes. The expected fix for such a tool is to *use* the lowering, not to teach `validateContract` about packs.

The validator that runs at the lowering seam lives in `packages/2-sql/1-core/contract/src/index-type-validation.ts`, separate from the JSON-internal-consistency validators in `validators.ts`. The file boundary signals the layering.

## Strictness is a registrant choice

`arktype` is loose-by-default: an `options` object with extra keys passes validation unless the validator explicitly rejects them. The framework does not impose a strictness policy on top.

A registrant opts into strict-key rejection by including `'+': 'reject'` in their option shape (as `bm25` does in the grounding example). The recommendation is to do so: an entry's option shape is a contract between the registrant and the renderer, and an unrecognised key is far more likely to be a typo than a genuine extension point. Silently dropping it at validate time would mask it from authors and produce surprising DDL.

The choice belongs to the registrant because the registrant is the one who knows whether their option set is closed (everything that's accepted is enumerated) or genuinely open (e.g. forward-compat with new method-specific knobs).

## Rendering: framework-owned, single path

The Postgres adapter's `createIndex` reads `type` and `options` directly from the validated IR and renders:

```sql
CREATE INDEX <name> ON <table> USING <type> (<columns>) WITH (<key> = <literal>, …)
```

There is **no per-entry rendering hook**. A single universal renderer formats `options` as `key = literal, …`, using the adapter's existing scalar quoting and escaping helpers for strings, numbers, and booleans. `null` and `NaN` are rejected at the renderer.

Two consequences are worth naming:

- **The universal renderer is sufficient because validators constrain leaves to scalars.** There is no entry whose options need bespoke rendering, because no entry can declare an options shape with non-scalar leaves.
- **SQL-injection risk is bounded to framework-owned helpers.** An extension author cannot accidentally introduce an unsafe rendering path; the only path that produces SQL string fragments from extension data is the one the framework controls and tests.

## Index identity and migration semantics

The schema differ pairs indexes by their full physical name (name-identified — see the index extension noted in [ADR 234](ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md); at this ADR's writing the pairing key was the column tuple). A paired index's `unique`, `columns`, `type`, and `options` are then compared as attributes: a contract index whose `type` differs from the live database's index — or whose `options` differ — is a real mismatch and is reported as one. Option comparison is *loose* (string-coerced both sides) to absorb the fact that `pg_class.reloptions` stores values as text regardless of the original literal type, so a contract `fillfactor: 70` matches a Postgres `'70'`.

Any change to `columns`, `type`, or `options` is rendered by the migration planner as `DROP INDEX` followed by `CREATE INDEX`. Postgres has no `ALTER INDEX … SET METHOD` for changing the index method, and option changes are inconsistent across `WITH` keys, so `ALTER` is the wrong primitive for these fields uniformly. The DROP+CREATE shape is a property of how Postgres handles index method and storage-parameter changes, not a choice this design imposes.

Postgres introspection populates `SqlIndexIR.type` from `pg_am.amname` and `SqlIndexIR.options` from `pg_class.reloptions`, with one asymmetry: when `pg_am.amname` is `'btree'` (the Postgres default), the introspected `type` is dropped to `undefined`. Without that, a contract index without an explicit `type` would never match a default-method index in the live database, and every plan against an unchanged DB would force DROP+CREATE.

## Authoring surfaces: TS and PSL

Both surfaces reach the same lowering and therefore the same registry. They differ in what they accept syntactically:

- **TS authoring** is unconstrained by the validator's expressiveness. `arktype` validators can describe any leaf type, so TS callers can write `options: { fastupdate: false }` against a hypothetical `gin` registration that accepts boolean leaves.
- **PSL grammar** carries `options` as an object literal whose values are string leaves. PSL authors can write `options: { key_field: "id" }`, but `options: { fastupdate: false }` does not parse — the diagnostic explicitly says so and points at the TS surface for non-string options. This is a property of the PSL grammar, not the registry.

A contract authored half-and-half (some models in PSL, some in TS, against the same pack list) is consistent because both surfaces flow through the same `assertStorageSemantics` call.

## Consequences

### Positive

- **Adding an index type is a single declaration.** A pack writes one `defineIndexTypes()….add(…)` call and stores the value on its descriptor. Authoring narrowing, runtime validation, and DDL rendering all light up without touching framework code.
- **Errors fire at the call site.** Unknown types and bad option shapes are compile errors at the line that wrote them, or runtime errors at the lowering with the model name attached. Neither manifests as surprise DDL.
- **The IR vocabulary is dialect-neutral.** `type` and `options` are free of Postgres-specific keywords (`USING`, `WITH`). A contract is portable across SQL adapters even though only the Postgres renderer exists.
- **Composition is per-contract.** Two contracts that attach different packs see different valid `type` sets. The vocabulary follows the pack list; nothing leaks across contracts.

### Negative

- **The renderer is Postgres-shaped.** Other SQL adapters that want to read `type`/`options` need their own rendering path. The IR vocabulary is neutral; the rendering is per-adapter by design, but the cost of a new adapter going through these fields is real.
- **PSL accepts only string-leaf options.** Until the PSL grammar is extended for non-string leaves, registrants whose options shape needs booleans or numbers must document that PSL authoring is not supported and direct authors at the TS surface.
- **Tools that bypass the lowering bypass the registry check.** A tool that produces `contract.json` directly — without going through `defineContract` or PSL interpretation — does not get index-type validation. This is consistent with the layering (the registry isn't part of the JSON), but it is a real limit on JSON-as-an-API-surface.

## Non-goals

- **`ALTER INDEX` rendering paths for `type`/`options` changes.** Always `DROP` + `CREATE`. Postgres has no clean `ALTER` primitive for index method or for the heterogeneous space of `WITH` keys.
- **Per-column index options.** `options` is a single record on the index node, not per-column. Per-column operator classes (e.g. for `gist` and `gin`) live in their own design space and would attach to the column reference, not the index.
- **Capability gating per index type.** Capabilities describe the runtime environment (is this server version, this connection, this extension installed). The registry is the *design-time* vocabulary — it answers "can this contract name `bm25`?", not "does the database have ParadeDB installed?". The latter surfaces as a Postgres DDL error at apply time, which is the correct boundary.
- **Built-in registry entries seeded by the framework.** The registry is open by design; there is no fixed list of "official" types. Default-method (B-tree) indexes are expressed by *omitting* `type` entirely, which is consistent with the introspection rule that drops `'btree'` to `undefined`.

## Alternatives considered

### Per-entry rendering hooks

Let each registered entry carry a function that turns its `options` into a SQL fragment. Rejected on uniformity and security grounds. The framework already exposes safe scalar quoting helpers; an extension authoring its own renderer would either duplicate them or, worse, build SQL by string concatenation. The universal renderer is sufficient because validators constrain leaves to scalars.

### `declare module` augmentation for index types

A common TypeScript pattern: each pack augments a global type to add its entries. Rejected because it does not compose with per-contract pack lists — every contract in the workspace would see the union of all packs ever loaded, not just its own. Storing the registration on the pack value keeps the merged set scoped to each contract's `defineContract` call.

### Capability gating per index type

The capability system ([ADR 117](ADR%20117%20-%20Extension%20capability%20keys.md)) negotiates runtime environment features (server version, installed extensions). It is not the right vocabulary for a *design-time* decision about whether a contract can name a given `type` value. A registered entry asserts a vocabulary, not a runtime property. If the database lacks the underlying server-side extension, Postgres surfaces that as a DDL error at apply time — the correct layer for a runtime failure.

### Closed-set identifier syntax in PSL (`type: BTree`)

Prisma's stable PSL uses identifier values for `@@index(type:)`. Rejected because the registry is open-ended by design: extension packs contribute new types, and a closed-set grammar would either need to be regenerated per workspace or fall through to a string-typed argument anyway. PSL accepts a string-quoted `type` value, validated downstream against the merged registry exactly the same way the TS surface is.

## References

- [ADR 117 — Extension capability keys](ADR%20117%20-%20Extension%20capability%20keys.md). The orthogonal mechanism that index types are *not*: capabilities describe the runtime environment, the registry describes the design-time vocabulary.
- [ADR 161 — Explicit foreign key constraint and index configuration](ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md). Neighbouring decision in the index/constraint area; same model of explicit, contract-visible configuration with per-node fields.
