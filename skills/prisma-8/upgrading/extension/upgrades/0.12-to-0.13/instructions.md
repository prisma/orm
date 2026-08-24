---
from: "0.12"
to: "0.13"
changes:
  - id: sqlite-create-table-method
    summary: |
      SQLite migrations: `createTable` is no longer a free function exported from `@internal/sqlite/migration`. It is now a protected method on the `Migration` base class. If your extension ships SQLite migration files, replace every free `createTable(...)` call with `this.createTable({ table: ..., columns: [...], constraints: [...] })`. If your extension's migration facade re-export test asserts `createTable` is defined, remove that assertion. The `col()`, `lit()`, `fn()`, `primaryKey()`, `foreignKey()`, and `unique()` builder helpers are now exported from `@internal/sqlite/migration` directly.
    detection:
      glob: "**/migration.ts"
      contains:
        - "createTable"
        - "@internal/sqlite/migration"
      anyMatch: false
  - id: regen-extension-contracts-strip-empty-type-params
    summary: |
      The canonicalizer now strips empty `typeParams: {}` from `storage.types` entries in
      `contract.json`. Any extension that has shipped a `contract.json` with `typeParams: {}`
      on its named-type entries (e.g. `types { Uuid = String @db.Uuid }`) must re-emit its
      contract artefacts and re-pin its migration baselines so the on-disk hashes match the
      new canonical form.
    detection:
      glob: "**/contract.json"
      contains:
        - '"typeParams": {}'
      anyMatch: true
  - id: thread-namespace-id-through-codec-ref-resolver-spi
    summary: |
      The codec-resolution SPI in `@internal/sql-relational-core` now takes a leading, required `namespaceId` coordinate. The `CodecDescriptorRegistry.codecRefForColumn(table, column)` build-time helper — the one AST authors call to stamp `codec` onto every column-bound `ParamRef` / `ProjectionItem`, exported from `@internal/sql-relational-core/query-lane-context` and `@internal/sql-relational-core/codec-descriptor-registry` — is now `codecRefForColumn(namespaceId, table, column)`. The underlying free function `codecRefForStorageColumn(storage, table, column)` (exported from `@internal/sql-relational-core/codec-descriptor-registry`) is now `codecRefForStorageColumn(storage, namespaceId, table, column)`. Extension authors who derive codec refs directly must thread the namespace the table sits in at every call site: pass the explicit `namespaceId` ahead of `table`. There is no codemod — the right namespace is call-site-specific (read it from the model/table you are building the ref for). Two same-bare-named tables in different namespaces now resolve to their own per-namespace columns/codecs instead of the first scan hit.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "codecRefForColumn("
        - "codecRefForStorageColumn("
      anyMatch: true
  - id: storage-namespace-envelope-re-emit
    summary: |
      The storage IR in `contract.json` moved to a namespace envelope
      (`storage.namespaces.<ns>.entries.<kind>`). This changes `storageHash` for every
      SQL and Mongo extension contract. Re-emit your extension contract artefacts
      (`pnpm --filter <your-extension-package> build:contract-space`), then re-pin your
      migration baselines so `migrations/refs/head.json`, `end-contract.json`,
      `end-contract.d.ts`, `migration.json`, `migration.ts`, and `ops.json` all reflect
      the new hash. No source change is required — re-emitting is sufficient.
    detection:
      glob: "**/contract.json"
      anyMatch: true
---

<!--
TML-2843: @internal/sqlite gained a facade-level transaction API
(`SqliteClient.transaction()` + `SqliteTransactionContext`), mirroring
the existing Postgres facade. Purely additive public surface backed by
the unchanged SQL runtime `withTransaction` helper; existing extension
code is unaffected. Incidental substrate diff only.

TML-2838: vitest configs in `packages/3-extensions/postgres` and
`packages/3-extensions/supabase` now pass `--no-memory-protection-keys`
to the test worker forks to stop a V8 WASM-teardown crash on Linux CI.
Test-harness only — no runtime, contract, or public-API change.
Incidental substrate diff only.

TML-2500 M4: `packages/3-extensions/supabase/README.md` link updated
from the old project spec to the canonical ecosystem-extensions doc and
ADR 226. Docs-only; no runtime, contract, or public-API change.
Incidental substrate diff only.

TML-2784: many-to-many became a first-class, validatable contract shape.
`ContractReferenceRelation` is now a cardinality-discriminated union — the
`'N:M'` variant requires a `through` junction descriptor ({ table,
namespaceId, parentColumns, childColumns, targetColumns }); the
non-junction variant carries `through?: never`. Purely additive: N:M
contracts did not validate before this change, so no working extension
constructs them, and existing 1:1 / 1:N / N:1 relation values match the
non-junction variant unchanged. No codemod required.

Bug fix in @internal/sql-orm-client — `orderBy` on a
variant-narrowed collection now resolves MTI variant-owned fields
(previously threw), mirroring the existing variant-aware `where`/`first`
treatment. Additive: the no-variant `orderBy` path and its types are
unchanged; no extension API change. No codemod required.

Release bump 0.13.0 (#789): version-number changes across all workspace
`package.json` files and `pnpm-lock.yaml` specifiers. Incidental substrate
diff — no extension-author action required.
-->

# 0.12 → 0.13 — Extension-author upgrade instructions

## `sqlite-create-table-method`

Starting at this release, `createTable` is no longer a free function exported from `@internal/sqlite/migration`. It is now a protected method on the `Migration` base class — call it as `this.createTable({...})` inside `get operations()`.

If your extension ships SQLite migration files, update them to use `this.createTable(...)` and remove `createTable` from the import list.

If your extension has a facade re-export parity test that asserts `createTable` is defined, remove that assertion; add assertions for `col`, `lit`, `fn`, `primaryKey`, `foreignKey`, and `unique` if your test also checks that the column builders are exported.

The `col()`, `lit()`, `fn()`, `primaryKey()`, `foreignKey()`, and `unique()` builder helpers are now exported from `@internal/sqlite/migration` directly.

See the user-skill entry `sqlite-create-table-method` for the full before/after migration steps — the authoring-surface change is identical for both user and extension migration files.

## `regen-extension-contracts-strip-empty-type-params`

The contract canonicalizer now omits `typeParams` from `storage.types` entries when the
value is an empty object. Previously, emitting a named-type alias like:

```prisma
types {
  Uuid = String @db.Uuid
}
```

produced a `contract.json` entry such as:

```json
"types": {
  "Uuid": {
    "codecId": "pg/text@1",
    "kind": "codec-instance",
    "nativeType": "uuid",
    "typeParams": {}
  }
}
```

From this release the canonicalizer strips `typeParams` when it is empty, so the emitted
form is:

```json
"types": {
  "Uuid": {
    "codecId": "pg/text@1",
    "kind": "codec-instance",
    "nativeType": "uuid"
  }
}
```

Empty and absent `typeParams` are treated as equivalent at every comparison boundary, so
the runtime behaviour is unchanged. The only visible effect is that re-emitting produces a
different `storageHash` — the hash now reflects a `contract.json` without the empty key.

### Re-emit your extension contract

If your extension's `contract.json` carries `"typeParams": {}` on any `storage.types`
entry, re-emit to pick up the canonical form:

```bash
pnpm fixtures:emit
# or, for a single package:
pnpm --filter <your-extension-package> build:contract-space
```

### Re-pin migration baselines

Because the `storageHash` changes, re-generate the migration baselines so
`migrations/refs/head.json`, `end-contract.json`, `end-contract.d.ts`, `migration.json`,
`migration.ts`, and `ops.json` all reflect the new hash.

> **Note:** `scripts/regen-extension-migrations.mjs` is a monorepo-internal tool that
> hard-codes `packages/3-extensions/` paths. It does not exist in external extension
> repos. Follow the manual steps below.

1. Copy the freshly-emitted `src/contract.json` → `migrations/refs/end-contract.json`
   and `src/contract.d.ts` → `migrations/refs/end-contract.d.ts`.
2. Open your HEAD migration's `migration.ts` and update the `to` literal to the new
   `storageHash` from `src/contract.json`.
3. Run `pnpm exec tsx migrations/<head-migration>/migration.ts` (from the extension
   package root) to re-emit `ops.json` and `migration.json`.
4. Update `migrations/refs/head.json` — set `"hash"` to the new `storageHash`,
   preserving the existing `"invariants"` array unchanged.

### Validation

After re-emitting and re-pinning, run `pnpm typecheck && pnpm test --filter <your-extension-package>`,
then confirm `prisma-next migration check` passes. The `contract.json` diff should show
`"typeParams": {}` removed from every `storage.types` entry.

## `thread-namespace-id-through-codec-ref-resolver-spi`

Starting at the 0.13 release, every model/table sits in an explicit namespace, and the column-bound codec-resolution SPI in `@internal/sql-relational-core` carries that namespace as a leading, required coordinate. If your extension stamps `codec: CodecRef` onto AST nodes at build time (the "CodecRef invariant for AST authors" path — `descriptors.codecRefForColumn(...)`), or calls the free `codecRefForStorageColumn(...)` against `SqlStorage` directly, you must thread the namespace coordinate through.

### `CodecDescriptorRegistry.codecRefForColumn`

The registry method exported from `@internal/sql-relational-core/query-lane-context` (the `CodecDescriptorRegistry` interface) and built by `buildCodecDescriptorRegistry` (`@internal/sql-relational-core/codec-descriptor-registry`) gained a leading `namespaceId` parameter.

```ts
// Before 0.13
const ref = descriptors.codecRefForColumn('document', 'embedding');

// Starting at 0.13 — namespaceId leads the coordinate args
const ref = descriptors.codecRefForColumn('public', 'document', 'embedding');
```

The namespace is whatever namespace the model/table you are building the ref for lives in — read it from the resolved table coordinate you already hold at the construction site, not a hard-coded literal. The table is now resolved strictly within that namespace, so two same-bare-named tables in different namespaces resolve to their own per-namespace column codecs without colliding.

### `codecRefForStorageColumn`

The free function exported from `@internal/sql-relational-core/codec-descriptor-registry` gained the same leading coordinate, inserted between `storage` and `tableName`.

```ts
// Before 0.13
const ref = codecRefForStorageColumn(storage, 'document', 'embedding');

// Starting at 0.13
const ref = codecRefForStorageColumn(storage, 'public', 'document', 'embedding');
```

It now resolves the table via `resolveStorageTable(storage, tableName, namespaceId)` rather than scanning every namespace for the first bare-name match, so a name that is ambiguous across namespaces is no longer silently bound to whichever namespace happened to enumerate first.

### Validation

This is a type-level signature change — `pnpm typecheck` (or `pnpm build`) pinpoints every call site that still passes the pre-0.13 argument list. Fix each one by inserting the namespace coordinate, then run your extension's standard `pnpm test`.

## Validation by execution

This entry is prose-only — there is no colocated codemod, so no execution-replay applies. The right namespace coordinate is call-site-specific (it depends on which model/table the AST node is bound to), so the translation is per-site agent reasoning rather than a deterministic transform. The substrate diff inside `packages/3-extensions/` in this transition is the same translation downstream extension authors replicate by hand: the namespace coordinate threaded through every column-bound codec-ref construction site. The release-pipeline gate (`pnpm check:upgrade-coverage`) is satisfied by this directory carrying at least one entry; the substantive verification of the consumer-facing translation lives in the published extension-upgrade skill's per-step bump-install-instructions-validate-commit loop, which runs in extension authors' own CI.

## `storage-namespace-envelope-re-emit`

The storage IR inside `contract.json` moved to a namespace envelope in 0.13. Every
table and type entry that was previously at the top level of `storage` now lives under
`storage.namespaces.<ns>.entries.<kind>`. Cross-references that were bare strings are
now `{ namespace, model }` objects in `domain`. The emitter handles the shape change
automatically — no source change is needed.

Because the shape change affects `storageHash`, every extension contract must be
re-emitted and migration baselines re-pinned.

### Re-emit your extension contract

```bash
pnpm --filter <your-extension-package> build:contract-space
```

### Re-pin migration baselines

Follow the manual re-pin steps described in the
[`regen-extension-contracts-strip-empty-type-params`](#regen-extension-contracts-strip-empty-type-params)
section above: copy `src/contract.{json,d.ts}` to `migrations/refs/end-contract.*`,
update `migration.ts` with the new `storageHash`, re-run `tsx migration.ts` to
re-emit `ops.json` + `migration.json`, then update `migrations/refs/head.json`.

### Validation

After re-emitting and re-pinning, run `pnpm typecheck && pnpm test --filter
<your-extension-package>`, then confirm `prisma-next migration check` passes.

## Declarative PSL-block SPI (additive)

**Informational — no action required.**

This release adds a declarative SPI for extension-contributed top-level PSL blocks.
Register an `AuthoringPslBlockDescriptor` under `AuthoringContributions.pslBlockDescriptors`
(exported from `@internal/framework-components`) and the framework's generic PSL
parser, validator, and printer handle the block round-trip through `contract infer`
without any per-block parsing code. Each descriptor claims a PSL keyword and supplies
the argument schema; a matching `entityTypes` entry lowers the parsed node to an IR
class instance.

This is purely additive — existing extensions that use hand-written PSL-block parsers
are unaffected. Adopt `pslBlockDescriptors` when you want the framework to own the
parse/print cycle for a new top-level block your extension introduces.

## Many-to-many contracts (additive)

No extension-author action required for the many-to-many change: M:N relations became a first-class, validatable contract shape this release (`'N:M'` cardinality with a required `through` junction descriptor). It is additive — existing non-junction relations and the public framework factories (`crossRef`, the contract-builder) are unchanged.
