# Pattern: Authoring warning sink

**Status:** Emerging
**Maintainer:** architect

## Intent

When PSL lowers a policy block whose `@@map` adopts an exact physical name, the Postgres pack wants to warn the user that byte-comparison of a hand-authored SQL body is unreliable. But the pack's entity factory runs deep inside the interpreter, long before the build assembles the contract — and if it emitted `process.emitWarning` on the spot, a contract adopting fifty objects would print fifty walls of text, and the framework could never batch or dedupe them.

The pattern: the emitting layer pushes a fully-formed, generic warning into a write-only sink handed down through the authoring context; the accumulating layer owns the array; exactly one flush per build renders the batch. The emitter never learns the presentation policy, and the transport never learns the emitter's vocabulary.

## When to use

- A lower layer (a target pack's entity factory, a shared lowering helper) mints a non-fatal advisory that must surface to the user once, at a boundary the emitter cannot see.
- The advisories need batching, thresholds, or dedupe across one build — per-push emission would wall-of-text.

## When NOT to use

- **Fatal conditions.** Throw. A warning sink is for advice the build survives.
- **Span-anchored authoring errors.** Use the sibling `AuthoringDiagnosticSink` (one field away on `AuthoringEntityContext`): diagnostics carry `sourceId`/`span`, fail the load, and point at source text. The boundary is severity and anchoring — a diagnostic names a place in the schema and blocks; a warning names an object and advises.

## Structure

The framework owns one generic entry type and the sink ([`framework-authoring.ts`](../../../packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts)):

```ts
export interface AuthoringWarning {
  readonly code: string; // stable machine code; user-greppable, stamped on emitWarning
  readonly message: string; // full text when itemized
  readonly item: string; // short label under a batched summary (`policy "…"`)
  readonly summary: string; // what a batched group asserts about EVERY member: "<count> <summary>"
}

export interface AuthoringWarningSink {
  push(w: AuthoringWarning): void;
}
```

- **Push sites mint fully-formed warnings.** The concrete vocabulary (`exactNameBodyWarning(subject, exactName)` in [`index-naming.ts`](../../../packages/2-sql/1-core/contract/src/index-naming.ts)) lives beside the emitter and never travels as a type — only `AuthoringWarning` crosses layers.
- **The accumulating layer owns a plain array** (an `AuthoringWarning[]` satisfies the sink structurally) and threads it through `AuthoringEntityContext.warnings`. A producer that runs before the build (the PSL interpreter) hands its batch to the build on the producer→builder IR (`ContractDefinition.warnings`).
- **Exactly one flush per build** — which may emit more than one warning. `flushAuthoringWarnings` groups on `code` AND `summary` and applies the batch threshold per group: at or below it, every `message` is emitted; above it, one batched warning — `"<count> <summary>"` over the `item` lines. Warnings batch together iff both keys match, so a mixed batch renders one summary per distinct summary text.

## Why the payload must be generic

The framework must not learn family or target vocabulary (`no-family-vocabulary-in-framework`). Naming a concrete warning type on the transport forces a widen-then-narrow round trip; the first implementation of this seam did exactly that and is the recorded counter-example: the entry type `ExactNameBodyWarningEntry` was widened into a `{ code, message }` sink, narrowed back by a runtime predicate that **silently dropped** every non-matching entry, and its transported `message` was computed at the push site, discarded by the narrowing, and re-formatted at the flush — two formatting paths for one user-visible string, with no test able to see them diverge. A generic entry deletes the predicate, the second format path, and the silent-drop hole in one move: whatever is pushed is flushed.

## Reference implementations

| Implementation | Path | Demonstrates |
|---|---|---|
| Exact-name body-comparison warning | [`packages/2-sql/1-core/contract/src/index-naming.ts`](../../../packages/2-sql/1-core/contract/src/index-naming.ts) | Minting beside the emitter; shared by index lowering and the Postgres policy factory |
| Duplicate-index warnings | [`packages/2-sql/1-core/contract/src/index-deduplication.ts`](../../../packages/2-sql/1-core/contract/src/index-deduplication.ts) | A contract-build pass pushing `PN_INDEX_DUPLICATE` and `PN_INDEX_REDUNDANT` into the build's sink |
| Required unmapped column warning | [`packages/2-sql/2-authoring/contract-ts/src/unmapped-column-warnings.ts`](../../../packages/2-sql/2-authoring/contract-ts/src/unmapped-column-warnings.ts) | A contract-build pass pushing `PN_COLUMN_REQUIRED_UNMAPPED` for a required column with no default that a table node adds to a table some model maps |
| PSL interpreter accumulation | [`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`](../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts) | The array-as-sink, seeded into the build via `ContractDefinition.warnings` |
| Per-build flush | [`packages/2-sql/2-authoring/contract-ts/src/build-contract.ts`](../../../packages/2-sql/2-authoring/contract-ts/src/build-contract.ts) | One flush at the end of `buildSqlContractFromDefinition` covering indexes and policies |

## Related patterns

- [`adapter-spi.md`](./adapter-spi.md) — the same inversion (lower layer calls up through a framework-owned seam) for behaviour rather than advisories.

## Cautions / common mistakes

- **A group's summary must be true of every member.** The batched rendering asserts `summary` of the whole group, so the grouping key covers `code` + `summary` — never group on `code` alone when summaries can differ (the first shipped adopter did, and a mixed index+policy batch told indexes to drop an `@@map` they do not have).
- **The threshold is per group.** Splitting groups by summary weakens the original global wall-of-text guard: N groups of threshold-size hits each itemize N×threshold warnings. Deliberate trade — a summary that lies about its members is worse than a longer listing; revisit only if a build legitimately produces many distinct summaries.
- **Push sites must not format for presentation.** Batching and thresholds are the flush's job; a push site that pre-joins messages defeats the summary.
- **Keep the sink optional and ignorable.** A producer that does not collect warnings must still work; `lowerAuthoredIndex` falls back to an immediate single-entry flush when no sink is passed.
- **One flush per build is a testable invariant** — the test pinning it belongs with the flush, not the push (`psl-policy-map-authoring.test.ts` pins one `process.emitWarning` call across indexes and policies).
- **Do not type the transport with a concrete warning kind.** That is the recorded counter-example above; a second warning kind then needs a second field, predicate, and flush.
