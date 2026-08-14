# PostgreSQL Temporal Codecs — Plan

**Spec:** `projects/postgres-temporal-codecs/spec.md`  
**Linear Project:** N/A — explicitly waived by the operator for this project.

## At a glance

This project delivers one atomic slice. Raw PostgreSQL temporal parsing, all eight representation-explicit codecs, canonical authoring and introspection, and removal of every public JavaScript Date codec merge in one PR. The work is sequenced as reviewed dispatches inside that slice; no dispatch introduces a compatibility path or represents an independently mergeable transition.

## Composition

### Slice `atomic-temporal-cutover` — Linear: N/A

- **Outcome:** PostgreSQL temporal values cross the driver boundary as lossless server text and decode through explicitly selected Temporal or string codecs; canonical PSL, TypeScript authoring, generated declarations, and introspection select those codecs; old PostgreSQL Date codec IDs, `sql/timestamp@1`, and generic `field.timestamp()` are absent in the same merged state.
- **Builds on:** The current `origin/main` codec descriptor model, structured-error passthrough, JSON projection hooks, contract emission, introspection ownership, and `pg`/`pg-cursor` per-query parser APIs.
- **Hands to:** The complete project Definition of Done with no transitional compatibility surface: Date-free public temporal values, explicit string alternatives, target-owned Temporal capability errors, lossless scalar/array/JSON transport, canonical authoring, migrated artifacts, and documented behavior.
- **Focus:** Deliver the final cutover as one reviewable hard migration. Dispatches may establish transport, codec, authoring, migration, fixture, integration, and documentation layers sequentially, but the slice cannot merge until all layers are coherent and all old Date paths are gone.
- **Spec:** `projects/postgres-temporal-codecs/slices/atomic-temporal-cutover/spec.md`
- **Plan:** `projects/postgres-temporal-codecs/slices/atomic-temporal-cutover/plan.md`

## Dependencies

- [x] `pg` supports per-query result parsers for buffered and cursor paths without mutating global or user-owned parser registries.
- [x] Applications provide native or globally polyfilled Temporal; Prisma imports no production polyfill.
- [x] A test-only Temporal implementation may exercise the real API without entering production dependencies.

## Sequencing rationale

Changing PostgreSQL temporal OIDs from Date-producing parsers to raw text affects every codec using those OIDs. The old codec surface cannot remain executable without adding the compatibility behavior the project explicitly forbids. Therefore transport cutover, new runtime codecs, canonical contract ownership, consumer migration, and old-surface deletion share one merge boundary. Dispatches preserve review focus inside that boundary; they are not release stages.
