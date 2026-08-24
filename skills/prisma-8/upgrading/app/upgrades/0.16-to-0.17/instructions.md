---
from: "0.16"
to: "0.17"
changes:
  - id: one-prisma-package-per-application
    summary: |
      Do this first — nothing else in this upgrade can run until the project installs. From
      0.17 the `@prisma-next/*` scope is retired: nothing publishes under it again, so a
      manifest that still names it fails at install. The public surface is the `@prisma`
      scope, and an application depends on exactly ONE database facade —
      `@prisma/orm-postgres`, `@prisma/orm-sqlite`, or `@prisma/orm-mongo` — plus any
      extension packs it uses, which remain direct dependencies. Everything else that used
      to be a separate dependency (framework, family, target, adapter, driver, CLI) arrives
      transitively as the facade's exact-pinned dependencies. In `package.json`: delete
      EVERY `@prisma-next/*` entry across dependencies/devDependencies/peerDependencies,
      add the one facade for your database, and keep your extension packs — renamed
      (`@prisma-next/extension-<x>` → `@prisma/orm-extension-<x>`; the middleware cache is
      `@prisma/orm-extension-middleware-cache`). Drop the `prisma-next` devDependency if you
      have one — the facade provides the `prisma-next` bin; the standalone `prisma-next`
      package remains only as the bootstrap path for projects with no Prisma dependencies
      yet. Reinstall, then regenerate your contract artefacts (`prisma-next contract emit`):
      generated files now import facade entrypoints (e.g. `@prisma/orm-postgres/components`)
      instead of old-scope package names. The `contractHash` is unchanged by regeneration —
      `prisma-next db verify` passes with no database work. Finally rewrite hand-written
      imports: same-package entrypoints keep their subpath under the facade
      (`@prisma-next/postgres/config` → `@prisma/orm-postgres/config`, likewise `/runtime`,
      `/target`, `/family`, `/migration`, `/control`, …); programmatic tooling imports
      (`@prisma-next/cli/*`, `@prisma-next/config-loader`, `@prisma-next/migration-tools/*`,
      `@prisma-next/emitter`) move to the matching `@prisma/orm-toolchain/*` subpath
      (`@prisma/orm-toolchain/cli/config-types`, `/cli/control-api`, `/config-loader`,
      `/migration-tools/<subpath>`, `/emitter`). The rule for every rewrite: import only
      from packages your manifest names directly — the facade, your extension packs, and
      (for tooling authors) `@prisma/orm-toolchain`.
    detection:
      glob: "**/*.{json,ts,tsx,mts,cts,js,mjs,cjs}"
      contains:
        - '@prisma-next/'
      anyMatch: true
  - id: strip-sha256-hash-prefixes
    summary: |
      Content hashes are bare lowercase hex from 0.17 — the `sha256:` prefix is gone from every
      surface (emitted `contract.json` / `contract.d.ts`, migration manifests, refs, CLI output,
      and the database marker/ledger), and loaders reject the legacy prefixed form. Contract hash
      VALUES are unchanged (only the prefix drops; `pnpm emit` regenerates live artefacts), but
      `migrationHash` VALUES change because the hashed manifest bytes embed the now-bare
      `from`/`to` strings. Run the colocated codemod over your checked-in `migrations/` trees
      FIRST, before the snapshot-layout migrator in the entries below — the 0.17 layout migrator
      accepts only bare-hex trees. The codemod handles both layouts: it strips the prefix from
      every hash literal (manifests, `ops.json`, pre-store sibling contract snapshots, store
      entries under `migrations/snapshots/`, `.d.ts` branded literals), maps the empty-tree
      sentinel `sha256:empty` to `empty`, recomputes each `migrationHash`, and repoints
      `refs/*.json`. Store directory names are the hash's hex, which does not change. Databases
      whose marker/ledger still hold prefixed values report a hash mismatch on verify — there is
      no compatibility shim; re-sign against the regenerated contract (`prisma-next db sign`).
    detection:
      glob: "**/*.{json,ts,tsx}"
      contains:
        - 'sha256:'
      anyMatch: true
    script: ./strip-sha256-hash-prefixes.ts
  - id: migration-contract-snapshots-moved-to-content-addressed-store
    summary: |
      Committed migration contract snapshots move from per-package sibling files
      (`start-contract.json` / `start-contract.d.ts` / `end-contract.json` /
      `end-contract.d.ts`) and per-space head copies
      (`migrations/<space-id>/contract.json` / `contract.d.ts`) into a single
      content-addressed store per migrations root, at
      `migrations/snapshots/<hex>/contract.json` + `contract.d.ts`, where `<hex>`
      is the contract's 64-hex storage hash (bare hex after the
      `strip-sha256-hash-prefixes` entry above, which must run first). Every
      distinct contract is stored once, however many migrations reference it.
      Every emitted `migration.ts` now imports its bookend contracts from the
      store (`../../snapshots/<hex>/contract.json`, `../../snapshots/<hex>/contract.d.ts`)
      instead of from sibling files in its own directory.
      This is a clean break: there is no fallback reader for the old sibling-file
      layout, so a committed migrations tree that has not been converted fails to
      load once you upgrade — `migration plan` / `migration new` / `migrate` /
      `migration check` all read contract snapshots through the store only, and
      a missing store entry fails with `MIGRATION.CONTRACT_SNAPSHOT_MISSING`
      naming the expected hash and path. `migration.json` / `ops.json` /
      `migrationHash` are unaffected — the contract snapshot was never part of
      migration identity, so converting the layout changes no migration's hash.
      To convert an existing project, run the migrator once per migrations root
      from a checkout of the `prisma/prisma` repository at (or above) the
      version you're upgrading to: `node scripts/migrate-migrations-layout.mjs
      [migrationsRoot...]` (with no arguments it auto-discovers every migrations
      root under the current directory). Per migration package, it reads
      `migration.json`, write-if-absents the destination contract (and the
      source contract, when present) into the store under the matching hash,
      rewrites the committed `migration.ts` import specifiers, and deletes the
      four sibling files. Per contract space, it store-writes any remaining
      per-space `contract.json` / `contract.d.ts` keyed by that space's
      `refs/head.json` hash, then deletes it. It asserts every contract's inner
      `storage.storageHash` against the hash it's filed under before writing
      anything (mismatch aborts the whole run, nothing is deleted), and
      re-verifies every `migrationHash` is unchanged after conversion. Run it,
      review the diff, then `pnpm typecheck` (or your project's equivalent) to
      confirm every rewritten `migration.ts` import resolves.
    detection:
      glob: "**/migration.ts"
      contains:
        - "./start-contract.json"
        - "./end-contract.json"
        - "./start-contract'"
        - "./end-contract'"
      anyMatch: true
  - id: ref-paired-snapshots-moved-to-content-addressed-store
    summary: |
      Ref-paired contract snapshot files (`refs/<name>.contract.json` /
      `refs/<name>.contract.d.ts`, written by `ref set` and `--advance-ref`) are
      no longer written or read. A ref is now only its pointer file,
      `refs/<name>.json` (`{ hash, invariants }`); the contract it names
      resolves through the same content-addressed store as every migration
      graph node, `migrations/snapshots/<hex>/contract.json` + `contract.d.ts`,
      by that hash. This is a clean break: a pointer whose store entry is
      missing now fails with `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming the
      expected hash and path, rather than silently falling back to the
      migration graph. The same one-shot migrator that folds per-package and
      per-space sibling snapshots (see the entry above) also folds any
      existing `refs/<name>.contract.json` / `refs/<name>.contract.d.ts`
      pairs: it write-if-absents the pair into the store under the sibling
      pointer's `hash`, then deletes the pair — the pointer file itself is
      read but never written, so it stays byte-identical. A `.contract.json`
      with no sibling pointer, or whose inner `storage.storageHash` disagrees
      with the pointer's `hash`, aborts the whole run before anything is
      written or deleted. Run `node scripts/migrate-migrations-layout.mjs
      [migrationsRoot...]` (same invocation as above; one run folds both
      migration-package and ref-paired snapshots), review the diff, then
      re-run `prisma-next ref list` to confirm your refs are unaffected.
    detection:
      glob: "**/refs/*.contract.json"
      anyMatch: true
  - id: extension-packs-config-key-renamed-to-extensions
    summary: |
      The `extensionPacks` key is renamed to `extensions` everywhere: the
      low-level `defineConfig` in `prisma.config.ts`, the TS builder's
      `defineContract` (record form), runtime/control client options, and the
      top-level key of the emitted `contract.json` / `contract.d.ts`. The old
      config key now fails loudly with "Config.extensionPacks is no longer
      supported; rename it to Config.extensions" — it is never silently
      ignored. Rename the key in `prisma.config.ts` (and `contract.ts` /
      `db.ts` if they pass `extensionPacks` to client factories). The target
      façades' `defineConfig` already used `extensions`; only projects on the
      low-level config change. Because the key sits in the canonicalized bytes
      of every contract hash, all three hashes (`storageHash`,
      `executionHash`, `profileHash`) change for every contract: re-emit with
      `prisma-next contract emit`, then re-anchor migrations — regenerate
      `migrations/snapshots/<hex>/` store entries and refs for the new hashes
      (a schema-unchanged project needs a hash-advance migration or a
      re-baseline; the database schema itself does not change).
    detection:
      glob: "**/{prisma.config.ts,contract.ts,db.ts}"
      contains:
        - "extensionPacks"
  - id: contract-source-format-key-renamed
    summary: |
      The contract source provider field `sourceFormat` is renamed to `format`
      (`contract.source.format` in the low-level config; provider objects from
      `prismaContract()` / `typescriptContract()` emit the new field
      automatically once upgraded). Rename any literal `sourceFormat:` in
      hand-written provider objects or config assertions.
    detection:
      glob: "**/prisma.config.ts"
      contains:
        - "sourceFormat"
  - id: sugar-output-path-key-renamed-to-output
    summary: |
      The target façades' `defineConfig` option `outputPath` is renamed to
      `output`. Semantics are unchanged (a directory; `contract.json` is
      written inside it). Rename the key in `prisma.config.ts`.
    detection:
      glob: "**/prisma.config.ts"
      contains:
        - "outputPath"
  - id: orm-count-only-mutation-terminals-renamed
    summary: Replace `createCount(...)`, `updateCount(...)`, and `deleteCount()` with `createAndCount(...)`, `updateAndCount(...)`, and `deleteAndCount()` in ORM call sites; arguments, guards, behavior, and `Promise<number>` results are unchanged, and no compatibility aliases remain.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - ".createCount("
        - ".updateCount("
        - ".deleteCount("
      anyMatch: true
  - id: psl-format-error-class-removed
    summary: |
      The `PslFormatError` class is deleted from `@internal/psl-parser`. `format()`
      on source with parse errors now throws a structured envelope with code
      `PSL.PARSE_FAILED`; the diagnostics previously on `error.diagnostics` are at
      `error.meta.diagnostics`. Replace `error instanceof PslFormatError` with
      `isStructuredError(error) && error.code === 'PSL.PARSE_FAILED'`
      (`isStructuredError` from `@internal/utils/structured-error`). The message
      text is unchanged.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "PslFormatError"
  - id: scalar-type-descriptors-channel-removed
    summary: |
      The scalar-type descriptor channel is retired in favour of the unified authoring type
      namespace. Projects with custom control-stack setups that import
      `createPostgresScalarTypeDescriptors` / `createSqliteScalarTypeDescriptors`, or that read
      `scalarTypeDescriptors` from a control stack or contract-source context, must migrate:
      those exports are deleted, and scalar types are now zero-arg type-constructor
      contributions in the component's `authoring.type` namespace — e.g.
      `String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } }`.
      Read the scalar type names via `stack.scalarTypes`, or the full name ->
      `{ codecId, nativeType }` map via `collectScalarTypeConstructors(stack.authoringContributions.type)`
      from `@internal/framework-components/authoring`. Standard target setups
      (`@internal/postgres`, `@internal/sqlite`) supply the contributions themselves.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "createPostgresScalarTypeDescriptors"
        - "createSqliteScalarTypeDescriptors"
        - "scalarTypeDescriptors"
      anyMatch: true
  - id: postgres-native-types-move-to-type-position
    summary: |
      PostgreSQL native storage types are authored directly in PSL type position, and the legacy `@db.*` attribute channel is removed. Rewrite `BaseType @db.Type` as `Type` and `BaseType @db.Type(args)` as `Type(args)` in both `types {}` aliases and model fields, then re-run `prisma-next contract emit`. Any remaining `@db.X(args)` fails with `@db.X(args) is no longer supported; use X(args) in type position`, preserving the constructor name and arguments in the suggested replacement. The supported translations are `@db.Char` → `Char`, `@db.VarChar` → `VarChar`, `@db.Numeric` → `Numeric`, `@db.Uuid` → `Uuid`, `@db.Inet` → `Inet`, `@db.SmallInt` → `SmallInt`, `@db.Real` → `Real`, `@db.Timestamp` → `Timestamp`, `@db.Timestamptz` → `Timestamptz`, `@db.Date` → `Date`, `@db.Time` → `Time`, and `@db.Timetz` → `Timetz`; preserve constructor arguments. Rewrite the old native-json spelling `Json @db.Json` as bare `Json`. This source migration preserves native types and supplied type parameters. It also preserves codec ids except for `@db.Date` → `Date`, which rebinds `pg/timestamptz@1` to `pg/date@1`, changes the contract storage hash, and requires re-emission plus re-signing; see the `postgres-date-rebound-to-pg-date` entry below. Separately, apply the `postgres-json-rebound-to-native-json` entry below to old bare `Json` fields that meant jsonb storage.
    detection:
      glob: "**/*.prisma"
      contains:
        - "@db."
      anyMatch: true
  - id: postgres-json-rebound-to-native-json
    summary: |
      On the postgres target the PSL `Json` scalar re-binds from `pg/jsonb@1` / `jsonb` to
      `pg/json@1` / `json`; a new bare `Jsonb` scalar carries `pg/jsonb@1` / `jsonb`. Postgres
      schemas that use `Json` and mean jsonb storage (which every pre-0.16 `Json` field did)
      must switch those fields — and `types {}` aliases — to `Jsonb`, then re-run
      `prisma-next contract emit`; with `Jsonb` the emitted `contract.json` is byte-identical
      to the pre-0.16 output. A field left as `Json` now emits a native `json` column and a
      new storage hash, which against an existing jsonb database is a schema change. The
      removed `@db.Json` spelling must be rewritten from `Json @db.Json` to bare `Json`; any remaining use fails with migration guidance to use `Json` in type position. SQLite and Mongo `Json` bindings are untouched. The TS builder surface (`field.json()`, `jsonbColumn`) is unchanged and stays jsonb.
    detection:
      glob: "**/*.prisma"
      contains:
        - "Json"
      anyMatch: true
  - id: default-generators-no-longer-set-storage
    summary: |
      `@default(<generator>)` no longer influences a column's storage — the type position is
      the only storage decider. Pre-0.16, a generator default on a bare `String` field re-picked
      the column's storage to a sized char: `String @default(uuid())` / `@default(uuid(7))`
      emitted `sql/char@1` / `character(36)`, `@default(cuid(2))` `character(24)`,
      `@default(nanoid())` `character(21)` (or `character(<size>)` for `nanoid(<size>)`), and
      `@default(ulid())` `character(26)`. From 0.16 such fields emit the target's `String`
      storage (postgres: `pg/text@1` / `text`) with the same execution-time generator, so a
      re-emit produces a new storage hash — against an existing database created with the char
      storage this is a schema change. To keep the prior storage byte-identical, name it in the
      type position: `Char(36) @default(uuid())`, `Char(24) @default(cuid(2))`,
      `Char(21) @default(nanoid())` (or `Char(<size>)` for a sized nanoid), `Char(26)
      @default(ulid())` — or adopt native `Uuid` for `uuid()` if a `uuid`-typed column is
      preferred (that is a schema change too). Then re-run `prisma-next contract emit` and, if
      you accepted a storage change, plan/apply the matching migration. Generator applicability
      validation is unchanged (`uuid()` on `Int` still fails with
      `PSL_INVALID_DEFAULT_APPLICABILITY`), and the TS builder presets
      (`field.id.uuidv4String()`, `field.generated(uuidv4())`, …) are untouched — they bundle
      their `char(N)` storage explicitly.
    detection:
      glob: "**/*.prisma"
      contains:
        - "@default(uuid("
        - "@default(cuid("
        - "@default(nanoid("
        - "@default(ulid("
      anyMatch: true
  - id: postgres-date-rebound-to-pg-date
    summary: |
      On the postgres target, the bare `Date` type constructor re-binds from `pg/timestamptz@1` to the dedicated `pg/date@1` codec. Rewrite the removed `DateTime @db.Date` spelling as `Date`; leaving it unchanged now fails with migration guidance to use `Date` in type position. The stored native type is unchanged (`date`), so no schema migration is needed, but a re-emit changes the column's codec ref and therefore the contract's storage hash: run `prisma-next contract emit`, then re-sign any signed database against the regenerated contract (`prisma-next db sign`) — verify reports a hash mismatch until you do.
      Contracts emitted before the upgrade keep working (`pg/timestamptz@1` still exists).
      Runtime behavior changes on re-emit: date columns decode as a `Date` at UTC midnight
      (previously the driver's local-midnight `Date` passed through, so the instant depended
      on the process timezone — code reading local getters near midnight in negative-UTC-offset
      zones saw the neighboring day), encode formats `YYYY-MM-DD` from UTC getters, and
      relation `.include()` over a date column now decodes instead of failing with
      `RUNTIME.DECODE_FAILED`. Update tests or application code that pinned the old
      local-midnight instants to expect `new Date(Date.UTC(y, m, d))`.
    detection:
      glob: "**/*.prisma"
      regex:
        - '@db\.Date'
        - '\sDate(\s|\?|\[|$)'
      anyMatch: true
  - id: sql-escape-error-class-removed
    summary: |
      The `SqlEscapeError` class is deleted from `@internal/target-postgres` and
      `@internal/target-sqlite` (including its re-export from the postgres/sqlite
      adapter `control` entrypoints). Identifier/literal escaping failures now throw a
      structured envelope with code `CONTRACT.IDENTIFIER_INVALID`. Replace
      `error instanceof SqlEscapeError` with
      `isStructuredError(error) && error.code === 'CONTRACT.IDENTIFIER_INVALID'`
      (`isStructuredError` from `@internal/utils/structured-error`). Message text is
      unchanged.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "SqlEscapeError"
  - id: supabase-error-classes-removed
    summary: |
      The `SupabaseConfigError` and `InvalidJwtError` classes are deleted from
      `@internal/extension-supabase/runtime`. The same failures now throw
      structured envelopes with codes `SUPABASE.CONFIG_INVALID` and
      `SUPABASE.JWT_INVALID`. Replace `error instanceof SupabaseConfigError` with
      `isStructuredError(error) && error.code === 'SUPABASE.CONFIG_INVALID'` and
      `error instanceof InvalidJwtError` with
      `isStructuredError(error) && error.code === 'SUPABASE.JWT_INVALID'`
      (`isStructuredError` from `@internal/utils/structured-error`). Message
      text is unchanged.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"
      contains:
        - "SupabaseConfigError"
        - "InvalidJwtError"
      anyMatch: true

  - id: indexes-are-name-identified
    summary: |
      Secondary indexes are name-identified from 0.17. Every index entry in the emitted
      `contract.json` / `contract.d.ts` now carries `name` (the full physical name) and
      `unique`, plus `prefix` when the name is toolchain-owned; `columns` became optional
      (an index carries either `columns` or an opaque `expression` — never both). Contracts
      emitted by 0.16 fail validation on load (the error message contains "indexes[0].name
      must be a string (was missing)"), and storage hashes move for every contract that
      declares indexes — re-emit with `prisma-next contract emit`. Physical names change for wire-named indexes: an unnamed
      PSL `@@index([a, b])` / TS `constraints.index([a, b])` and every FK-backing index now
      CREATE as `<default-prefix>_<8hex>` content-hash wire names (e.g.
      `user_email_idx_46df9cad`), and a TS `constraints.index([...], { name: "x" })` name is
      now a wire prefix — the physical name becomes `x_<8hex>`. PSL
      `@@index([...], map: "x")` is now an exact physical name whose identity is verified
      against the live catalog. Existing databases converge without rebuilds: after
      re-emitting, the first plan that allows the `widening` class (`db update`, or
      `migration plan` + `migrate`) is `ALTER INDEX … RENAME TO` ops only — renames happen
      only when a widening plan runs FIRST. Under an additive-only policy the rename pairing
      does not run: the new wire-named index is created beside the old one, and once both
      exist a later plan can no longer pair them — the old index is removed only by a
      destructive-allowed plan dropping it. Update any code or tests that hard-code the old
      physical index names.
    detection:
      glob: "**/*.{prisma,ts,json}"
      contains:
        - "@@index"
        - "constraints.index"
        - '"indexes":'
      anyMatch: true
  - id: rls-policy-migration-literal-carries-the-naming-union
    summary: |
      A generated migration's `this.createRlsPolicy({ policy: … })` literal spells the policy's
      name differently from 0.17. The flat `name` / `prefix` pair is replaced by a single
      `naming` field carrying one of two shapes: `{ kind: "exact", name: "<physical name>" }`
      for a policy whose name the author owns, or
      `{ kind: "wire", prefix: "<prefix>", hash: "<8hex>" }` for a toolchain-named one
      (0.16's `name: "<prefix>_<8hex>"` plus `prefix: "<prefix>"`). Every other key is
      unchanged. A migration file emitted by 0.16 that calls `createRlsPolicy` therefore stops
      compiling — TypeScript reports `Property 'naming' is missing`. Regenerate the affected
      migrations with `prisma-next migration plan`, or edit the literal by hand: the shape is
      mechanical, and the migration's identity (`migrationHash`, the SQL it executes) does not
      depend on the literal's spelling.
    detection:
      glob: "**/migrations/**/migration.ts"
      contains:
        - "createRlsPolicy"
  - id: framework-error-classes-removed
    summary: |
      Three exported framework error classes are deleted: `ConfigFileNotFoundError`
      (from `@internal/config-loader`), `ConfigValidationError` (from
      `@internal/config/config-validation`), and `DomainNamespaceResolutionError`
      (from `@internal/contract/types`). The same failures now throw structured
      envelopes with codes `CONFIG.FILE_NOT_FOUND`, `CONFIG.VALIDATION_FAILED`, and
      `CONTRACT.NAMESPACE_INVALID` respectively. Replace each
      `error instanceof <Class>` with
      `isStructuredError(error) && error.code === '<CODE>'`
      (`isStructuredError` from `@internal/utils/structured-error`). Message
      text is unchanged.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"
      contains:
        - "ConfigFileNotFoundError"
        - "ConfigValidationError"
        - "DomainNamespaceResolutionError"
      anyMatch: true
  - id: pg-int8-application-values-are-bigint
    summary: |
      `pg/int8@1` carries `bigint` application values where it carried `number`. A JS `number`
      cannot represent the whole signed 64-bit range, so any value past 2^53 was already being
      silently rounded. Every read of an `int8` column now yields a `bigint`, and every value
      compared against one must be a `bigint` literal. `count()` is the widest instance: it
      resolves to `pg/int8@1`, so a counted column's row type is `bigint` and a `having`
      comparison reads `fns.gt(fns.count(), 5n)`. Update row-type annotations, comparison
      literals, and any arithmetic that mixes a counted value with a `number` — TypeScript will
      not implicitly convert between the two, so `pnpm typecheck` locates every site.
      A contract's `int8` literal defaults are also emitted as decimal strings rather than JSON
      numbers; re-emit to pick that up.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "fns.count("
        - "pg/int8@1"
        - "int8Column"
      anyMatch: true
  - id: pg-interval-values-are-structured-durations
    summary: |
      Reading a `pg/interval@1` column returns `{ months, days, micros }` — the three fields
      PostgreSQL stores — where it returned a `JSON.stringify` of the driver's component object
      such as `{"days":1}`. `months` and `days` are `number`; `micros` is `bigint`, because
      PostgreSQL stores it as a 64-bit integer. Writing takes the same object. Replace any
      parsing of the old string with field access, and replace interval literals with the object
      (`{ months: 0, days: 1, micros: 0n }` for one day). The three fields stay independent
      because a month has no fixed length: one month and thirty days are different values and
      neither converts to the other. Serialized form is unchanged in kind but not in spelling —
      a contract holds the ISO-8601 duration string (`P1M`, `P1Y2M3DT4H5M6S`, `PT0S`), so
      re-emit; `micros` past microsecond resolution rounds as PostgreSQL rounds.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "pg/interval@1"
        - "intervalColumn"
      anyMatch: true
  - id: codec-json-forms-are-canonical
    summary: |
      Several codecs' JSON representation changed so a value survives the round trip through a
      contract. `pg/numeric@1` and `sqlite/bigint@1` are decimal text where they were JSON
      numbers — `9007199254740993` reached JSON as `…992` before, and arbitrary-precision
      decimals lost their tail. `pg/bytea@1` is base64 where it was PostgreSQL's `\x`-prefixed
      hex. `sqlite/blob@1` is uppercase hexadecimal where it was base64. `sqlite/bigint@1`
      additionally accepts values it previously refused outright: half of SQLite's INTEGER range
      had no JSON representation at all.
      This now reaches **reads**, not only contract literals. A query that returns JSON — an
      `.include()`'s nested rows, an aggregated child row set — projects each column through its
      codec, so these codecs' values arrive in the forms above where they previously arrived in
      whatever the database's own JSON conversion produced. Nine codecs project non-identically:
      `pg/numeric@1`, `pg/int8@1`, `pg/bytea@1`, `pg/interval@1`, `pg/timestamptz@1`,
      `pg/vector@1`, `sqlite/bigint@1`, `sqlite/blob@1` and `sqlite/json@1`. If you read such a
      column out of an include and parse or compare its raw JSON yourself — rather than letting
      the ORM decode it — update that code to the new form.
      Run `prisma-next contract emit` to regenerate
      `contract.json` / `contract.d.ts`; any literal default on one of these codecs changes
      spelling, and with it the `storageHash`. Code that reads such a default out of a contract,
      or that hand-writes one, must use the new form.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,json,d.ts}"
      contains:
        - "pg/numeric@1"
        - "pg/bytea@1"
        - "pg/int8@1"
        - "pg/interval@1"
        - "pg/timestamptz@1"
        - "pg/vector@1"
        - "sqlite/bigint@1"
        - "sqlite/blob@1"
        - "sqlite/json@1"
      anyMatch: true
  - id: float-json-requires-extra-float-digits-at-least-one
    summary: |
      The canonical JSON of `pg/float4@1`, `pg/float8@1`, `pg/float@1` and `pg/vector@1` holds
      only where the PostgreSQL session's `extra_float_digits` is 1 or above. That is the default
      from PostgreSQL 12 onward, so most deployments already satisfy it — but a connection that
      sets the GUC to 0 or below reverts to a fixed digit count and truncates: `1/3` reads back
      as `0.333333333333333` rather than `0.3333333333333333`, and the value no longer
      round-trips. Check any connection string, pool `options`, server config or proxy that sets
      `extra_float_digits` and remove settings of 0 or below.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs,json,toml,yaml,yml,env}"
      contains:
        - "extra_float_digits"
      anyMatch: true
  - id: sqlite-real-rejects-non-finite-values
    summary: |
      `sqlite/real@1` rejects infinities and `NaN` on both the encode and decode sides. JSON has
      no spelling for either, and SQLite renders an infinity as `9.0e+999`, which reads back as
      `Infinity` rather than failing — so a non-finite value used to pass through and corrupt the
      value silently. Guard any computation that can produce a non-finite float before writing it
      to a `REAL` column, or store it in a column whose codec admits it.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "sqlite/real@1"
        - "realColumn"
      anyMatch: true
  - id: pg-timestamptz-json-is-utc-iso
    summary: |
      `pg/timestamptz@1`'s canonical JSON is a UTC ISO-8601 timestamp with an explicit `+00:00`
      offset, constructed by the projection rather than inherited from the session. The form
      previously followed the connection's `DateStyle` and `TimeZone`, so the same stored instant
      read back differently on two connections, and under a non-ISO `DateStyle` could fail to
      parse at all. Nothing to change if you decode through the ORM. If you read a timestamptz out
      of database-produced JSON yourself it is now always `YYYY-MM-DDTHH:MM:SS.mmm+00:00`: drop any
      session-dependent parsing, and drop any `SET DateStyle` / `SET TimeZone` you added to
      stabilise it.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,sql}"
      contains:
        - "pg/timestamptz@1"
        - "timestamptzColumn"
        - "DateStyle"
      anyMatch: true
  - id: sqlite-json-documents-survive-nesting
    summary: |
      A `sqlite/json@1` column read through a nested `.include()` arrives as a parsed document
      where it previously arrived as a string containing JSON. SQLite carries "this text is JSON"
      as a subtype on the value, and that subtype does not survive a derived table — which every
      include's child row set passes through — so a document came back double-encoded. The
      projection retags it at the boundary that consumes it. A `sqlite/text@1` column whose
      characters happen to look like JSON is unaffected and still arrives as a string: the retag
      follows the column's codec, not its content. Remove any `JSON.parse` you added to compensate
      for the double encoding.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "sqlite/json@1"
        - "jsonColumn"
      anyMatch: true
  - id: sqlite-blob-null-is-distinct-from-empty
    summary: |
      A `NULL` `sqlite/blob@1` column read through database-produced JSON is `null`, where it
      previously became an empty `Uint8Array`. SQLite's `hex(NULL)` is the empty string, which is
      also the hex of a zero-length blob, so absence and emptiness were the same value and nothing
      raised. If your code distinguishes "no blob" from "empty blob" — and especially if it worked
      around the old behaviour by treating a zero-length blob as absent — that check now needs to
      test for `null`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "sqlite/blob@1"
        - "blobColumn"
      anyMatch: true
  - id: sql-float-rejects-non-finite-values
    summary: |
      `sql/float@1` rejects infinities and `NaN` in both JSON directions, matching
      `sqlite/real@1`. Its `decodeJson` previously performed no check at all, and a database can
      hold a non-finite float and spells it as a *string* in JSON — PostgreSQL emits `"NaN"` — so
      the codec handed back a string typed as `number`, silently. Guard any computation that can
      produce a non-finite float before writing it to a `sql/float@1` column, or use
      `pg/numeric@1`, whose application value is text and which admits all three.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "sql/float@1"
        - "sqlFloatColumn"
      anyMatch: true
  - id: explicit-codec-refs-need-readable-type-params
    summary: |
      A codec ref supplied explicitly — `sql.value(v, { codec: { codecId: 'pg/enum@1' } })` and
      the other surfaces that take a bare `codecId` — must carry `typeParams` the codec's schema
      accepts when that codec is parameterized. For `pg/enum@1` that means
      `typeParams: { typeName: '<enum type>' }`. Such a ref never passes contract validation, so
      the omission used to surface as a static `text` native type — correct only because
      PostgreSQL implicitly casts text to an enum, and wrong for any parameterized codec whose
      type is not text-compatible. It now fails at lowering instead. The failure currently
      surfaces as a params-validation error rather than a message naming the surface that produced
      it; that diagnostic is tracked as
      [TML-3114](https://linear.app/prisma-company/issue/TML-3114). Add the `typeParams` your
      column declares, or drop the explicit codec and let the column's own codec resolve.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - "codec: { codecId"
        - "pg/enum@1"
      anyMatch: true
  - id: sql-timestamp-json-is-utc-not-local
    summary: |
      **`sql/timestamp@1` now reads a zone-less timestamp as UTC where it read it in the running
      process's local zone.** This is an interpretation change, not a formatting one, and it is the
      dangerous half: `new Date('2026-01-02T03:04:05')` resolves in the local zone, so the same
      stored value used to decode to a different instant on a machine in `Europe/Berlin` than on one
      in `UTC` — shifted by the offset, silently. It now resolves as UTC on every machine.
      If you compensated for the old shift anywhere downstream — adding the offset back, forcing
      `TZ=UTC` on the process, normalising after decode — **remove that compensation**, or it now
      double-corrects and the instant is wrong by twice the offset. Nothing raises: the value is
      plausible, just wrong. If you ran with `TZ=UTC` there was no shift to compensate for and
      nothing to change.
      The JSON form changes with it: `encodeJson` emits `2026-01-02T03:04:05.678` where it emitted
      `2026-01-02T03:04:05.678Z`. A `timestamp` carries no zone, so the trailing `Z` claimed one it
      did not have; `decodeJson` now rejects an offset-bearing string outright rather than
      reinterpreting it, since this codec cannot reproduce an offset it was handed. Update any
      hand-written JSON, fixture or comparison that spells the old form.
      `pg/timestamp@1` is unaffected — it already read as UTC and already emitted the zone-less
      form.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,json}"
      contains:
        - "sql/timestamp@1"
        - "sqlTimestampColumn"
      anyMatch: true
---

# 0.16 → 0.17 — User upgrade instructions

## `strip-sha256-hash-prefixes`

Starting at the 0.17 release, every content hash Prisma Next mints or accepts is bare lowercase hex — the `sha256:` prefix is removed across the board: emitted `contract.json` / `contract.d.ts` (including the `StorageHashBase<'…'>` / `ProfileHashBase<'…'>` branded type literals), migration manifests, refs, CLI output, and the marker/ledger bookkeeping tables in your database. The prefix carried no information (the algorithm never varied per hash), and the hash **value** — not an in-band tag — signals a format change. Loaders and validators now reject the legacy prefixed form outright.

Two distinct effects on your checked-in artefacts:

- **Contract hashes keep their value.** `storageHash` / `profileHash` are computed over contract content, which never embedded its own hash — only the textual prefix drops.
- **Migration hash values change.** `migrationHash` is computed over the manifest bytes, which embed the `from` / `to` contract-hash strings; with those now bare, every recomputed `migrationHash` differs from the stored one.

### Migrate checked-in `migrations/` trees — before the layout migrator

Run the colocated codemod from your project root, **before** `scripts/migrate-migrations-layout.mjs` (the snapshot-layout entries below) — the 0.17 layout migrator accepts only bare-hex trees:

```bash
pnpm exec tsx ./strip-sha256-hash-prefixes.ts
```

For every on-disk migration package (a `migration.json` with a sibling `ops.json`) it strips the prefix from the manifest's `from` / `to`, from hash literals inside `ops.json`, in pre-store sibling contract snapshots (`*-contract.json`, `*.d.ts`, `migration.ts`), and in content-addressed store entries (`migrations/snapshots/<hex>/contract.json` + `contract.d.ts` — the directory name is the hash's hex and does not change), recomputes `migrationHash` over the bare-hex content, and rewrites `refs/*.json` — repointing refs that held old migration hashes at the recomputed ones, and mapping the empty-tree sentinel `sha256:empty` to `empty`. The edit is format-preserving (only hash literals and the recomputed hash value change) and idempotent: re-running over an already-bare tree makes no further changes.

Use `--check` for a dry run that lists files still needing the fix and exits non-zero if any remain:

```bash
pnpm exec tsx ./strip-sha256-hash-prefixes.ts --check
```

### Re-emit live contract artefacts

Regenerate your emitted artefacts so `contract.json` / `contract.d.ts` pick up the bare-hex form:

```bash
pnpm emit
# (runs `prisma-next contract emit` under the hood)
```

The regenerated files differ only in hash representation — the hash values themselves are unchanged.

### Update hash literals your own code carries

If your application or tests hard-code hash strings (asserting a `migrationHash`, comparing a `storageHash`, matching CLI output), drop the `sha256:` prefix — and for migration hashes, read the new value from the regenerated manifest, since the value itself changed.

### Database marker/ledger

There is no compatibility shim: a database whose marker/ledger rows still hold prefixed values reports a hash mismatch on `prisma-next db verify`. Re-sign the database against your regenerated contract:

```bash
prisma-next db sign
```

### Validation

After the codemod and re-emit, run `pnpm typecheck && pnpm test` (or your application's equivalent), and exercise any command that loads your migrations (deploy or migration-status step) — the loader recomputes and verifies each manifest's `migrationHash` on read, so a stale or still-prefixed manifest fails immediately. `git grep -n "sha256:"` over your project should return no hits in committed artefacts.

Also in this release, the ORM client's internal `throw new Error(...)` sites
were converted to a structured-error scheme (`ORM.*` codes via `structuredError`,
or `InternalError` for invariants). These are internal throw sites: the errors
are still `Error` instances with unchanged message text, so application code
that catches them by message or by `instanceof Error` is unaffected. No action
required beyond the migration contract-snapshot layout change above.

## `indexes-are-name-identified`

Secondary indexes are **name-identified**: the contract stores every index's full physical name, and schema verification and migration planning pair indexes by that name instead of by column tuple.

### What changed in the emitted contract

Each entry in a table's `indexes` array in `contract.json` / `contract.d.ts` now always carries:

- `name` — the full physical name of the index in the database.
- `unique` — always present (`false` for everything authored today).
- `prefix` — present when the name is toolchain-owned: the physical name is then `<prefix>_<8hex>`, where the suffix is a content hash of the index definition.
- `columns` — now optional; an index carries either `columns` or an opaque `expression` string, never both.

Newly available in 0.17 (additive — no migration needed): `contract infer` captures the full index matrix (expression, partial `where:`, unique non-constraint, `type:`/`options:`) and the RLS surface (`@@rls`, every policy as a `policy_<operation>` block with `@@map` and verbatim reprinted bodies, `permissive = false` for RESTRICTIVE rows), so `infer → emit → db verify` is zero-issue on databases carrying those objects. Re-running `contract infer` therefore rewrites `contract.prisma` with more entries than 0.16 emitted; an index whose live name is wire-shaped (`<prefix>_<8hex>`, created by this toolchain) and whose hash recomputes now re-infers as wire-named `name:` instead of exact `map:` — both spellings verify clean, the wire-named one keeps renames first-class. `permissive` is an authorable policy-block property (default `true`; wire names for `permissive = true` policies are byte-unchanged). Contracts may also now carry two content-identical exact-named (`map:`) indexes under different names — legal twins a signed database can have. RLS policy blocks (`policy_select` etc.) accept `@@map("physical name")` to adopt an existing live policy under its exact name — no wire-name hash, drift detection byte-compares the body against Postgres's reprint (hand-authoring the text warns with `PN_EXACT_NAME_BODY_COMPARISON`), and replacing `@@map` with the plain head later converges via a single `ALTER POLICY … RENAME`. Also newly available: both authoring surfaces accept the full index parameter matrix. PSL `@@index` and TS `constraints.index` take `expression:` (instead of a fields list; requires `name:` or `map:`), `where:` (partial-index predicate), `unique:`, `type:`/`options:` (target-registered access method), and `name:` xor `map:`. Combining `map:` with a SQL body emits the `PN_EXACT_NAME_BODY_COMPARISON` warning at build time — drift detection byte-compares hand-authored text against Postgres's reprint, so prefer `name:` unless the text was captured by `contract infer`. SQLite contracts reject `expression:`/`where:` with `CONTRACT.ARGUMENT_INVALID` (the target does not support them).

A contract emitted by 0.16 fails validation when a 0.17 toolchain loads it — a `Contract structural validation failed: storage.namespaces.<ns> …` error whose message contains `indexes[0].name must be a string (was missing)` and `indexes[0].unique must be boolean (was missing)` — and the storage hash moves for every contract that declares indexes. Re-emit:

```bash
prisma-next contract emit
```

### What changed about physical index names

| Authoring input | 0.16 physical name | 0.17 physical name |
| --- | --- | --- |
| PSL `@@index([a, b])` / TS `constraints.index([cols.a, cols.b])` (unnamed) | `<table>_<a>_<b>_idx` | `<table>_<a>_<b>_idx_<8hex>` (wire-named) |
| FK-backing index (derived from a relation) | `<table>_<col>_idx` | `<table>_<col>_idx_<8hex>` (wire-named) |
| TS `constraints.index([...], { name: "x" })` | `x` | `x_<8hex>` — the name is now a wire *prefix* |
| PSL `@@index([...], map: "x")` | `x` | `x` — an exact physical name, now verified against the live catalog |

The `<8hex>` suffix is a content hash over the index definition (element list, predicate, uniqueness, access method, options), so an unchanged definition always produces the same name.

### Converging an existing database

No index is rebuilt. After re-emitting the contract, the first plan that allows the `widening` operation class converges the live names with `ALTER INDEX … RENAME TO` ops only:

- `prisma-next db update` (its default policy includes widening), or
- `prisma-next migration plan --name converge-index-names` followed by `prisma-next migrate`.

Inspect the plan before applying — for a schema whose only drift is the index naming, it contains nothing but renames.

Under an **additive-only** policy (e.g. `db init`'s class set) the rename pairing is skipped: the plan creates the new wire-named index beside the old one. Once both indexes exist, a later widening plan has nothing left to pair — the new name is already present, and the rename op's own precheck requires its target name to be absent — so after the additive create the old index is removed **only** by a destructive-allowed plan dropping it. A rename happens only when a widening-allowed plan is the *first* convergence, before any create. This degradation is deliberate — an additive-only run never emits an op class it is not allowed to execute; if you want renames instead of create-then-drop, run the widening plan first.

### Hard-coded names

If application code, tests, or operational scripts hard-code physical index names (e.g. `user_email_idx`), read the new names from the regenerated `contract.json` — wire names now carry the hash suffix. PSL schemas that must keep a byte-exact legacy name can pin it with `@@index([...], map: "<exact name>")`.

## `rls-policy-migration-literal-carries-the-naming-union`

Generated migrations that create an RLS policy carry the policy as a literal. Where 0.16 spelled its name as two flat fields, 0.17 spells it as one `naming` field with two shapes:

```ts
// 0.16
this.createRlsPolicy({ schema: "public", table: "post", policy: {
  name: "post_owner_a1b2c3d4",
  prefix: "post_owner",
  // …
} })

// 0.17
this.createRlsPolicy({ schema: "public", table: "post", policy: {
  naming: { kind: "wire", prefix: "post_owner", hash: "a1b2c3d4" },
  // …
} })
```

A policy whose name the author owns (adopted through `@@map`) carries `naming: { kind: "exact", name: "Tenant members can read" }` instead. Every other key of the literal is unchanged.

The two fields could disagree — a `prefix` that is not what `name` ends with was representable and had to be checked at runtime — while the union cannot be written wrong. A 0.16 migration file that calls `createRlsPolicy` stops compiling against 0.17 with `Property 'naming' is missing`. Either regenerate the migration (`prisma-next migration plan`) or rewrite the two fields as the one union field by hand; the migration's identity and the SQL it runs do not depend on the literal's spelling, so a hand edit needs no re-hashing.

## Incidental dependency and lint-config bumps

Routine dev-dependency bumps and biome `$schema` version alignment in `examples/` (dependabot `dev-deps` group, PR #1058) require no Prisma Next-specific upgrade action; review and test the affected examples as with any routine dependency update.

## Incidental dependency bumps in examples

Routine runtime dependency bumps in `examples/` (dependabot `runtime-deps` group, PR #1065) require no Prisma Next-specific upgrade action; review and test the affected examples as with any routine dependency update.

## Incidental runtime dependency bumps in examples (August 2026)

Routine runtime dependency bumps in `examples/` (dependabot `runtime-deps` group, PR #29872) require no Prisma Next-specific upgrade action; review and test the affected examples as with any routine dependency update.

## Incidental dev-dependency bumps in examples (August 2026)

Routine dev-dependency bumps in `examples/` (dependabot `dev-deps` group, PR #29877) require no Prisma Next-specific upgrade action; review and test the affected examples as with any routine dependency update.

## Incidental example dependency bumps (react-router 8)

The `react-router-demo` example moves its `react-router`, `@react-router/dev`, `@react-router/node`, and `@react-router/serve` dependencies from 7.x to 8.x. This is an example-local framework upgrade and requires no Prisma Next-specific upgrade action; the Prisma Next surfaces the example uses are unchanged.

## `pg-int8-application-values-are-bigint`

An `int8` is a signed 64-bit integer; a JS `number` holds integers exactly only to 2^53. The codec previously handed you a `number`, so anything larger was already wrong by the time your code saw it. It now hands you a `bigint`.

TypeScript does not implicitly convert between `number` and `bigint`, so `pnpm typecheck` finds every affected site. Three shapes recur:

- **Row-type annotations.** A counted column is `bigint`: `SqlQueryPlan<{ name: string; postCount: bigint }>`.
- **Comparison literals.** `fns.gt(fns.count(), 5)` becomes `fns.gt(fns.count(), 5n)`.
- **Values read from a driver.** A raw `pg` query returns an `int8` as a decimal *string*; convert with `BigInt(row.id)` rather than annotating it `number`.

Arithmetic mixing the two throws at runtime rather than coercing, so a site that typechecks after a cast is worth reading again.

## `pg-interval-values-are-structured-durations`

An interval is not a duration. PostgreSQL stores three independent fields — months, days and microseconds — because a month has no fixed length, so `{ months: 1 }` and `{ days: 30 }` are different intervals and neither can be converted into the other. The application value is now those three fields, so reading an interval hands you numbers to compute with rather than a string to parse.

```ts
// before
const gap: string = row.gap;              // "{\"days\":1}"

// after
const gap = row.gap;                      // { months: 0, days: 1, micros: 0n }
const totalDays = gap.days + gap.months * 30;   // your calendar rule, not ours
```

The representation is separate from the value, as it is for `pg/bytea@1` (a `Uint8Array` carried as base64) and `pg/int8@1` (a `bigint` carried as decimal text). A contract holds the ISO-8601 duration string, so re-emit to pick up the spelling — `P1M`, `P1Y2M3DT4H5M6S`, `PT0S` for zero, each component carrying its own sign.

Two details worth knowing:

- **The ISO rendering normalises where the value does not.** Thirteen months render as `P1Y1M` and read back as `{ months: 13 }`. The value keeps what you gave it.
- **Fractional seconds round.** PostgreSQL rounds past microsecond resolution rather than truncating — `1.1234567` seconds is `1.123457` — and both paths into the value now agree with it.

## `codec-json-forms-are-canonical`

The rule these follow is that a value written through a codec and read back must be the same value. Where a codec's JSON form could not carry its own range, the form changed rather than the range being quietly clipped.

Re-emit first (`prisma-next contract emit`), then reconcile any code that reads or writes one of these forms directly. Literal defaults are where this most often surfaces: an `int8` default of `0` is now `"0"` in `contract.json`, and the `storageHash` moves with it.

The second place it surfaces is reads. A query that returns JSON projects each column through its codec, so a column whose codec is one of the nine listed above arrives in that codec's canonical form rather than in whatever the database's own JSON conversion produced. Decoding through the ORM needs no change — the codec's `decodeJson` is the other half of the same pair, and the two moved together. What needs checking is code that bypasses the ORM's decoding: a raw query that reads an aggregated JSON column and parses it itself, a comparison against a hand-written JSON string, a snapshot of database-produced JSON.

Where a form is a strict improvement in range, nothing downstream breaks by widening. Where a form changes spelling — `bytea` from `\x`-hex to base64, `sqlite/blob@1` from base64 to uppercase hex — a hand-written comparison is the thing that breaks, and it breaks loudly rather than silently.

## `sql-timestamp-json-is-utc-not-local`

The formatting change is easy to see and easy to fix. The interpretation change is neither, so take it first.

A `timestamp` column carries no time zone. Its JSON form is therefore a zone-less string, and something has to decide which instant that string denotes. `sql/timestamp@1` used to hand the string to `new Date(...)`, which resolves a zone-less form **in the zone the process happens to be running in**. The same stored value decoded to a different instant depending on where the code ran, and it decoded silently — a `Date` is a `Date`, whichever instant it holds.

It now resolves as UTC, unconditionally, and `encodeJson` writes UTC. The pair round-trips on any machine.

The migration hazard is compensation you may already have in place:

- If you added an offset back after decoding, **remove it.** It now double-corrects, and the result is wrong by twice your offset.
- If you set `TZ=UTC` on the process specifically to stabilise these values, you can drop that — though leaving it costs nothing, since UTC was already the case it produced.
- If you normalised timestamps after reading them, check whether the normalisation is still doing anything.

None of these fail loudly. A doubled offset produces a timestamp that parses, compares and serialises perfectly well and denotes the wrong moment, which is why this entry leads with the interpretation rather than the dropped `Z`.

Two smaller consequences follow:

- `encodeJson` emits `2026-01-02T03:04:05.678` rather than `2026-01-02T03:04:05.678Z`. Update fixtures, snapshots and hand-written comparisons.
- `decodeJson` rejects an offset-bearing string instead of reinterpreting it. The codec cannot reproduce an offset, so accepting one would decode a value it could never encode back.

`pg/timestamp@1` needs no attention: it already read as UTC and already emitted the zone-less form, and this change brings the generic codec into line with it.

## Incidental release version bump to 0.17.0

The `chore(release): bump to 0.17.0` commit rewrites every workspace manifest's `version` field and `workspace:` pins, which touches `examples/` manifests. No user action beyond the entries above.
