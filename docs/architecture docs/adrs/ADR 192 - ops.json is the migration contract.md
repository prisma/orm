# ADR 192 — ops.json is the migration contract

## At a glance

A MongoDB migration directory on disk looks like this:

```
migrations/
  2025-06-12T0930_backfill-status/
    migration.json          # manifest: from/to hashes, migrationId
    ops.json                # the operations — precheck, execute, postcheck as JSON
    migration.ts            # authoring surface — TypeScript the developer edits
    contract.json           # destination contract snapshot
    contract.d.ts
```

When a developer runs `migrate`, the runner reads `migration.json` and `ops.json`. It never loads `migration.ts`. The TypeScript file is a development tool — a convenient way to author operations using typed builders and query APIs. It produces `ops.json` when evaluated (either by running the file directly or via `migration emit` / inline from `migration plan`). Once emitted, the JSON is the artifact that gets attested, hash-verified, and replayed.

## Decision

`ops.json` + `migration.json` are the migration contract. `migration.ts` is authoring sugar that emits `ops.json`; it is never loaded at apply time.

The `migrationId` in `migration.json` is a content-addressed hash computed over the *stripped* manifest metadata plus `ops.json` — `fromContract`, `toContract`, and `hints` are excluded so the identity reflects what the migration does to storage, not the shape of the contract objects at planning time (see [ADR 199 — Storage-only migration identity](ADR%20199%20-%20Storage-only%20migration%20identity.md); manifest layout in [ADR 028](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md), [ADR 169](ADR%20169%20-%20On-disk%20migration%20persistence.md)). Editing `ops.json` changes the `migrationId`. Editing `migration.ts` in a way that doesn't change the emitted ops — reformatting, adding comments, renaming local variables — does not.

### No compilation at apply time

A strictly-equivalent way to state the "no TypeScript at apply time" decision: `ops.json` carries the **post-lowering execution form**. The runner does not invoke the lowerer, the codec system, the contract validator, or any other build-time compilation step. Whatever computation has to happen between user authoring and database execution happens during `migration plan` / `migration emit`, lands in `ops.json`, and is attested via `migrationId`.

This invariant is target-agnostic. The wire-protocol leaf grammar differs by target — and that is the only thing that differs:

- **MongoDB.** The driver consumes structured JSON commands. Post-lowering = a `kind`-discriminated AST of commands. `ops.json` carries that AST verbatim, and the runner rehydrates each command via arktype-validated class deserialization (`CreateIndexCommand`, `UpdateManyCommand`, `AggregateCommand`; see [ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)) before dispatch.
- **SQL.** The driver consumes `(sql_template, params[])`. Post-lowering = exactly that pair. `ops.json` carries the rendered SQL template and the wire-format parameter array, and the runner forwards both to `driver.query`.

In both cases, codec resolution, expression lowering, identifier quoting, parameter encoding, and any other contract-driven compilation belong on the **emit** side of the boundary. Their results land in `ops.json` as inert data. The apply-time runner is a dispatcher, not a compiler.

A practical corollary specific to SQL: every parameter reaches `params[]` as a JSON-safe wire value (string, number, boolean, null, array, record). Codec metadata (`CodecRef`, `codecId`, `typeParams`) is a build-time concept used during lowering and **must not appear anywhere in `ops.json`**. Parametrised queries (template plus separate value array) provide the standard SQL-injection defence: wire values never get inlined into the SQL template.

Today's symmetric realization of this invariant lives on the Mongo side (`packages/3-targets/mongo/1-target/src/core/mongo-ops-serializer.ts`). The SQL side currently relies on the simpler primitive shape `{ description, sql, params? }` and skips the explicit class/parser layer; the *invariant* (post-lowering, no apply-time compilation) holds either way, but a follow-up will bring SQL into structural symmetry with Mongo (typed driver-AST + parser-driven dispatch). See [ADR 212](ADR%20212%20-%20AST-bound%20codec%20resolution.md) for the current SQL boundary and the linked follow-up Linear ticket for the symmetric-driver-AST design.

## Why

**No TypeScript at apply time.** This is the core constraint. Four properties follow from it:

1. **Determinism.** The same `ops.json` produces the same database mutations regardless of when or where it's applied. There's no evaluation-order sensitivity, no ambient state from `node_modules`, no runtime behavior differences between Node versions.

2. **Auditability.** A reviewer reads the JSON to understand exactly what a migration does. The operations are data — inspectable, diffable, greppable. Reviewing `migration.ts` tells you what the author *intended*; reviewing `ops.json` tells you what will *happen*.

3. **Security.** `migrate` executes structured database commands, not arbitrary code. There is no `eval`, no dynamic `import`, no user-authored function bodies running at deploy time. A compromised `migration.ts` can only affect what gets emitted to `ops.json` — and `ops.json` is reviewed and hash-attested before apply.

4. **Portability.** Any environment that can read JSON and talk to the database can apply migrations — CI runners, edge workers, hosted services. There's no requirement for a TypeScript toolchain, a bundler, or even Node.js at apply time.

## Consequences

### Apply-time verification is two-step

`migrate` must trust two things before executing operations:

1. **The on-disk artifacts are internally consistent.** Recompute `migrationId` from the on-disk manifest + `ops.json` (`verifyMigrationBundle`) and compare against the stored `migrationId`. If they diverge, the artifacts have been tampered with or corrupted; refuse to apply. This check needs nothing beyond the JSON and reuses the same `computeMigrationId` invoked at emit time ([ADR 199](ADR%20199%20-%20Storage-only%20migration%20identity.md)).

2. **The on-disk artifacts are not stale relative to `migration.ts`.** If `migration.ts` is present in the migration directory, dynamic-import it — the `Migration.run` guard does not fire because the module is not the main module ([ADR 196](ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md)) — instantiate the default-exported `Migration` subclass, read `instance.operations`, and serialize them to compute a candidate `ops.json` and `migrationId`. Compare the candidate `migrationId` against the on-disk `migrationId`. If they diverge, the developer edited `migration.ts` after the last emit and forgot to re-emit; refuse to apply with a clear "ops.json is out of date — re-run `migration plan` or `./migration.ts`" error.

This split is what makes `ops.json` trustworthy as the contract while keeping `migration.ts` as a self-emitting authoring surface. Step (1) defends against post-emit tampering or transport corruption. Step (2) defends against emit drift — a developer who tweaked the TypeScript without regenerating the JSON. Both checks are framework-owned (target-agnostic) because they operate on `MigrationManifest` and `MigrationOps` shapes that are themselves family-agnostic.

Step (2) relies on the emit pipeline being deterministic: instantiating the class and serializing `instance.operations` must produce byte-identical artifacts whether driven directly by the developer's shebang, by `migration plan`'s inline emit, or by the verifier's import path ([ADR 196](ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md)). If the pipeline left any field unset (e.g. failed to compute and persist `migrationId`), the freshly computed hash would never match the on-disk hash and the staleness check would always trigger.

### migration.ts is development-only

The developer's workflow is: scaffold the package with `migration plan` (which writes `migration.json`, `ops.json`, `migration.ts`, and the contract snapshot), then iterate by editing `migration.ts` and re-running it directly — `Migration.run(...)` re-emits both `ops.json` and an attested `migration.json` on every invocation ([ADR 196](ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md)). The committed artifacts are `migration.json`, `ops.json`, and `migration.ts` — but only the first two are load-bearing at apply time.

`migrate` never imports or evaluates `migration.ts`. If the file is missing from the migration directory, apply still succeeds — it needs only the JSON.

### Identity tracks output, not source

Because `migrationId` is computed from the manifest and `ops.json`, two `migration.ts` files with different source code that emit identical ops produce the same `migrationId`. Refactoring the authoring file — extracting helpers, changing variable names, upgrading builder APIs — doesn't invalidate an already-attested migration as long as the emitted ops are unchanged.

### Op schema includes routing-layer fields

`MigrationOpSchema` (Arktype) admits an optional `invariantId: string` on data-transform ops so the field round-trips through `ops.json` validation. The schema stays shallow on operation-specific payload — `invariantId` is the routing-layer carve-out, not a generic op-level extension point. Authoring + emit derives the migration's `providedInvariants` aggregate from the data ops' `invariantId`s; the manifest field is then re-derived from `ops.json` at load time and compared against the stored copy via `MIGRATION.PROVIDED_INVARIANTS_MISMATCH`. See [ADR 208 — Invariant-aware migration routing](ADR%20208%20-%20Invariant-aware%20migration%20routing.md).

## Alternatives considered

### Execute migration.ts directly at apply time

The simplest model: `migrate` evaluates `migration.ts` and runs whatever it produces. No intermediate JSON, no serialization step.

Rejected because it violates all four properties above. A migration that behaves differently depending on installed packages, environment variables, or Node version is not auditable or deterministic. Arbitrary code execution at deploy time is a security boundary we don't want to cross. And it requires a full TypeScript/Node environment wherever migrations are applied.

### ops.json as a cache, migration.ts as source of truth

`migrate` would re-evaluate `migration.ts` if present, falling back to `ops.json` if not. This makes `ops.json` advisory rather than authoritative — a performance optimization, not a contract.

Rejected because it reintroduces TypeScript evaluation at apply time (same problems as above) and makes the `migrationId` hash meaningless: the hash covers `ops.json`, but the runner might not use `ops.json`. Reviewers can't trust the JSON because the runner might ignore it.

### Shell-syntax strings for MongoDB

We considered serializing MongoDB commands as shell-syntax strings (`db.users.createIndex({email: 1})`) — analogous to how today's SQL `ops.json` carries rendered SQL templates as strings.

Rejected because MongoDB commands have richer structure than SQL DDL. Checks compose source commands with filter expressions and expect clauses ([ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)). Flattening that structure to strings would lose the composability and require a parser on the deserialization side. The AST approach — `kind`-discriminated JSON objects validated by arktype schemas — is lossless, round-trips cleanly, and matches the wire protocol the driver consumes. The structural choice tracks the wire-protocol leaf grammar of each target; what matters for this ADR is that both targets serialize the **post-lowering** form.

### Pre-lowering AST in `ops.json` (deferred lowering at apply time)

We considered embedding the pre-lowering relational-core AST in `ops.json` for SQL data-transform ops, with the runner re-running the lowerer at apply time.

Rejected because it violates every property the "no compilation at apply time" invariant guarantees:

- **Determinism.** The same `ops.json` would produce different SQL across runtime versions whenever the lowerer changes (cast policy, identifier quoting, parameter style).
- **Auditability.** Reviewers reading `ops.json` would see structured AST nodes, not the SQL that actually executes; what was attested would not match what runs.
- **Security.** Apply-time compilation widens the attack surface from "execute a string" to "walk attacker-influenceable JSON tree → reconstruct AST classes → push through the lowerer". The `migrationId` hash pins the AST, not the SQL — so attestation drifts from execution as soon as the lowerer evolves.
- **Portability.** The runner would need the contract, the codec system, and the lowerer at apply time — defeating the "any environment that can read JSON and talk to the database" promise.

The codec-resolution refactor in [ADR 212](ADR%20212%20-%20AST-bound%20codec%20resolution.md) attached `CodecRef` to the in-memory AST for *runtime-side* dispatch and lowering. `CodecRef` is consumed during lowering and dropped before serialization; it never appears in `ops.json`.

## References

- [ADR 028 — Migration Structure & Operations](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md)
- [ADR 169 — On-disk migration persistence](ADR%20169%20-%20On-disk%20migration%20persistence.md)
- [ADR 188 — MongoDB migration operation model](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)
- [ADR 199 — Storage-only migration identity](ADR%20199%20-%20Storage-only%20migration%20identity.md)
- [ADR 208 — Invariant-aware migration routing](ADR%20208%20-%20Invariant-aware%20migration%20routing.md)
