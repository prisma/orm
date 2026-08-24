---
from: "0.16"
to: "0.17"
changes:
  - id: strip-sha256-hash-prefixes
    summary: |
      Content hashes are bare lowercase hex from 0.17 — the `sha256:` prefix is gone from every
      surface (emitted `contract.json` / `contract.d.ts`, migration manifests, refs, CLI output,
      and the database marker/ledger), and framework validators (`coreHash()` / `profileHash()`
      constructors, manifest and contract loaders) reject the legacy prefixed form. Contract hash
      VALUES are unchanged (only the prefix drops; re-emit your pack's committed contract
      artefacts), but `migrationHash` VALUES change because the hashed manifest bytes embed the
      now-bare `from`/`to` strings. Run the colocated codemod over your extension's checked-in
      `migrations/` trees FIRST, before the snapshot-layout migrator in the entries below — the
      0.17 layout migrator accepts only bare-hex trees. The codemod handles both layouts: it
      strips the prefix from every hash literal (manifests, `ops.json`, pre-store sibling
      contract snapshots, store entries under `migrations/snapshots/`, `.d.ts` branded
      literals), maps the empty-tree sentinel `sha256:empty` to `empty`, recomputes each
      `migrationHash`, and repoints `refs/*.json`. Then drop the prefix from any hash literal
      your pack's source, fixtures, or tests hard-code — a prefixed literal now fails validation
      instead of round-tripping. Signed databases your extension maintains (acceptance
      harnesses, reference instances) whose marker/ledger still hold prefixed values report a
      hash mismatch on verify — there is no compatibility shim; re-sign against the regenerated
      contract (`prisma-next db sign`).
    detection:
      glob: "**/*.{json,ts,mts,cts,tsx}"
      contains:
        - 'sha256:'
      anyMatch: true
    script: ./strip-sha256-hash-prefixes.ts
  - id: migration-contract-snapshots-moved-to-content-addressed-store
    summary: |
      Committed migration contract snapshots move from per-package sibling files
      (`start-contract.json` / `start-contract.d.ts` / `end-contract.json` /
      `end-contract.d.ts`) into a single content-addressed store per migrations
      root, at `migrations/snapshots/<hex>/contract.json` + `contract.d.ts`,
      where `<hex>` is the contract's 64-hex storage hash (bare hex after the
      `strip-sha256-hash-prefixes` entry above, which must run first).
      Every distinct contract is stored once, however many migrations
      reference it. An extension source repo keeps the shallow layout — migration
      packages sit directly under `migrations/` (no `app/` segment), so its store
      is `migrations/snapshots/` at the same depth, and every emitted
      `migration.ts` imports its bookend contracts one level up:
      `../snapshots/<hex>/contract.json` / `../snapshots/<hex>/contract.d.ts`
      (a consuming project's `app/`-nested migrations import two levels up,
      `../../snapshots/...` — do not copy that depth into an extension repo).
      This is a clean break: there is no fallback reader for the old sibling-file
      layout, so a committed migrations tree that has not been converted fails to
      load once you upgrade your extension's tooling — `migration plan` /
      `migration new` / `migration check` all read contract snapshots through the
      store only, and a missing store entry fails with
      `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming the expected hash and path.
      `migration.json` / `ops.json` / `migrationHash` are unaffected — the
      contract snapshot was never part of migration identity, so converting the
      layout changes no migration's hash, and no extension-authoring SPI changes.
      To convert an existing extension repo, run the migrator once from a
      checkout of the `prisma/prisma` repository at (or above) the version
      you're upgrading to, pointed at your extension's migrations root:
      `node scripts/migrate-migrations-layout.mjs <path-to-your-migrations-dir>`.
      Per migration package, it reads `migration.json`, write-if-absents the
      destination contract (and the source contract, when present) into the
      store under the matching hash, rewrites the committed `migration.ts`
      import specifiers, and deletes the four sibling files. It asserts every
      contract's inner `storage.storageHash` against the hash it's filed under
      before writing anything (mismatch aborts the whole run, nothing is
      deleted), and re-verifies every `migrationHash` is unchanged after
      conversion. Run it, review the diff, then typecheck your extension package
      to confirm every rewritten `migration.ts` import resolves.
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
      `refs/<name>.contract.d.ts`) are no longer written or read. A ref is now
      only its pointer file, `refs/<name>.json` (`{ hash, invariants }`); the
      contract it names resolves through the same content-addressed store as
      every migration graph node, `migrations/snapshots/<hex>/contract.json` +
      `contract.d.ts`, by that hash. Your extension repo's `migrations/refs/`
      normally carries only the system `head.json` pointer, which was never
      ref-paired — this only matters if your repo also carries named refs
      (e.g. from testing `ref set` against the extension's own migrations
      root). A pointer whose store entry is missing now fails with
      `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming the expected hash and path,
      rather than silently falling back to the migration graph. The same
      one-shot migrator that folds per-package sibling snapshots (see the
      entry above) also folds any existing `refs/<name>.contract.json` /
      `refs/<name>.contract.d.ts` pairs: it write-if-absents the pair into the
      store under the sibling pointer's `hash`, then deletes the pair — the
      pointer file itself is read but never written, so it stays
      byte-identical. A `.contract.json` with no sibling pointer, or whose
      inner `storage.storageHash` disagrees with the pointer's `hash`, aborts
      the whole run before anything is written or deleted. Run `node
      scripts/migrate-migrations-layout.mjs <path-to-your-migrations-dir>`
      (same invocation as above; one run folds both migration-package and
      ref-paired snapshots), then review the diff.
    detection:
      glob: "**/refs/*.contract.json"
      anyMatch: true
  - id: extension-packs-key-renamed-to-extensions
    summary: |
      The `extensionPacks` key is renamed to `extensions` across the config
      surface, the SPI, and the contract document. In your extension repo:
      (1) any `prisma.config.ts` (the extension's own contract space, a
      sibling example app, tests) renames `extensionPacks:` to `extensions:` —
      the old key fails loudly with "Config.extensionPacks is no longer
      supported; rename it to Config.extensions"; (2) the provider-API field
      `ContractSourceContext.composedExtensionPacks` is now
      `composedExtensions`; (3) the emitted `contract.json` / `contract.d.ts`
      top-level key is `extensions`, and because the key sits in the
      canonicalized bytes, every contract's `storageHash` / `executionHash` /
      `profileHash` changes. Re-run your contract-space build
      (`build:contract-space` or `prisma-next contract emit`), re-anchor
      `migrations/refs/head.json` and the `migrations/snapshots/<hex>/` store
      to the new hashes, and re-emit `ops.json` / `migration.json` for the
      head migration (its `to` hash changes). Concept-level SPI type names
      (`ExtensionPackRef`, `ControlExtensionDescriptor`,
      `validateExtensionPackRefs`) are unchanged. Also renamed in the same
      release: `contract.source.sourceFormat` → `format`, and the target
      façades' `defineConfig` option `outputPath` → `output`.
    detection:
      glob: "**/*.{ts,json}"
      contains:
        - "extensionPacks"
        - "composedExtensionPacks"
      anyMatch: true
  - id: orm-count-only-mutation-terminals-renamed
    summary: Replace `createCount(...)`, `updateCount(...)`, and `deleteCount()` with `createAndCount(...)`, `updateAndCount(...)`, and `deleteAndCount()` in ORM call sites; arguments, guards, behavior, and `Promise<number>` results are unchanged, and no compatibility aliases remain.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      contains:
        - ".createCount("
        - ".updateCount("
        - ".deleteCount("
      anyMatch: true
  - id: adopt-sql-json-projection-ast-foundations
    summary: Migrate relational AST construction and traversal to explicit JSON projection wrappers, expanded scalar-expression variants, grouped function-source aliases, and codec-preserving forwarded projections.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "JsonObjectExpr"
        - "JsonArrayAggExpr"
        - "ExprVisitor"
        - "AnyExpression"
        - "FunctionSource.of"
        - "ProjectionItem.of"
      anyMatch: true
  - id: scalar-type-descriptors-channel-removed
    summary: |
      `ComponentMetadata.scalarTypeDescriptors` is retired — the unified authoring type namespace
      is now the single channel for scalar types. If your extension/adapter descriptor declared
      `scalarTypeDescriptors: new Map([['String', 'pg/text@1'], ...])`, move each entry to a
      zero-arg type-constructor contribution in the descriptor's `authoring.type` namespace:
      `String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } }`.
      The `nativeType` is now explicit — it was previously derived from the codec's first target
      type, so check the codec manifest for the value to inline. Code that read
      `ControlStack.scalarTypeDescriptors` / `ContractSourceContext.scalarTypeDescriptors` should
      read `stack.scalarTypes` (the scalar type names) or derive the name ->
      `{ codecId, nativeType }` map via `collectScalarTypeConstructors(stack.authoringContributions.type)`
      from `@internal/framework-components/authoring`. `assembleScalarTypeDescriptors` is
      deleted, and `validateScalarTypeCodecIds` now takes the authoring type namespace instead of
      a descriptor map.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "scalarTypeDescriptors"
        - "assembleScalarTypeDescriptors"
      anyMatch: true
  - id: postgres-native-types-move-to-type-position
    summary: |
      PostgreSQL native storage types are authored directly in PSL type position, and the legacy `@db.*` attribute channel is removed. Rewrite `BaseType @db.Type` as `Type` and `BaseType @db.Type(args)` as `Type(args)` in extension schemas and test fixtures, then re-run contract emission. Any remaining `@db.X(args)` fails with `@db.X(args) is no longer supported; use X(args) in type position`, preserving the constructor name and arguments in the suggested replacement. The supported translations are `@db.Char` → `Char`, `@db.VarChar` → `VarChar`, `@db.Numeric` → `Numeric`, `@db.Uuid` → `Uuid`, `@db.Inet` → `Inet`, `@db.SmallInt` → `SmallInt`, `@db.Real` → `Real`, `@db.Timestamp` → `Timestamp`, `@db.Timestamptz` → `Timestamptz`, `@db.Date` → `Date`, `@db.Time` → `Time`, and `@db.Timetz` → `Timetz`; preserve constructor arguments. Rewrite the old native-json spelling `Json @db.Json` as bare `Json`. This source migration preserves native types and supplied type parameters. It also preserves codec ids except for `@db.Date` → `Date`, which rebinds `pg/timestamptz@1` to `pg/date@1`, changes the contract storage hash, and requires re-emission plus re-signing; see the `postgres-date-rebound-to-pg-date` entry below. Separately, apply the `postgres-json-rebound-to-native-json` entry below to old bare `Json` fields that meant jsonb storage.
    detection:
      glob: "**/*.prisma"
      contains:
        - "@db."
      anyMatch: true
  - id: postgres-json-rebound-to-native-json
    summary: |
      On the postgres target the PSL `Json` scalar re-binds from `pg/jsonb@1` / `jsonb` to
      `pg/json@1` / `json`; a new bare `Jsonb` scalar carries `pg/jsonb@1` / `jsonb`
      (`postgresScalarAuthoringTypes` in `@internal/adapter-postgres`). Extension test
      schemas and fixtures that author postgres `Json` fields and mean jsonb storage must
      switch those fields to `Jsonb`; assertions that pin the `Json` name's derived binding
      (e.g. over `collectScalarTypeConstructors(stack.authoringContributions.type)` or
      `stack.scalarTypes`) now expect `Json -> { codecId: 'pg/json@1', nativeType: 'json' }`
      plus the new `Jsonb -> { codecId: 'pg/jsonb@1', nativeType: 'jsonb' }` entry. PSL
      value-object storage columns still emit jsonb (the interpreter now prefers the target's `Jsonb` scalar and falls back to `Json`). The removed `@db.Json` spelling must be rewritten from `Json @db.Json` to bare `Json`; any remaining use fails with migration guidance to use `Json` in type position. SQLite and Mongo `Json` bindings and the TS builder surface (`field.json()`, `jsonbColumn`) are unchanged.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      contains:
        - "Json"
      anyMatch: true
  - id: default-generators-no-longer-set-storage
    summary: |
      `@default(<generator>)` never mutates a column's storage any more — the type position is
      the only storage decider — and the whole generator-storage-override SPI is retired with
      it. Removed surfaces: `MutationDefaultGeneratorDescriptor.resolveGeneratedColumnDescriptor`
      (`@internal/framework-components/control`) — generator descriptors are now
      `{ id, applicableCodecIds?, buildPhases? }` only, and `applicableCodecIds` remains the
      validation channel (`PSL_INVALID_DEFAULT_APPLICABILITY` on mismatch); the transitional
      `baseScalar` marker on `AuthoringTypeConstructorDescriptor` and
      `ScalarTypeConstructorOutput` (`@internal/framework-components/authoring`) — scalar
      type-constructor contributions and the derived scalar view are plain
      `{ codecId, nativeType, typeParams? }` again; and the `@internal/ids` exports
      `resolveBuiltinGeneratedColumnDescriptor` / `GeneratedColumnDescriptor` (the TS spec
      helpers `uuidv4()`, `nanoid()`, … still return `GeneratedColumnSpec` bundling their
      explicit `sql/char@1` column). Packs that registered a generator descriptor with a
      storage-resolution hook must drop the hook; PSL schemas in extension fixtures relying on
      `String @default(uuid()/cuid()/nanoid()/ulid())` producing `character(N)` columns must
      either accept the target String storage (postgres: `pg/text@1` / `text`) or author the
      char storage explicitly in the type position (`Char(36) @default(uuid())`, …), then
      re-emit.
    detection:
      glob: "**/*.{ts,mts,cts,prisma}"
      contains:
        - "resolveGeneratedColumnDescriptor"
        - "resolveBuiltinGeneratedColumnDescriptor"
        - "baseScalar"
        - "@default(uuid("
        - "@default(cuid("
        - "@default(nanoid("
        - "@default(ulid("
      anyMatch: true
  - id: postgres-date-rebound-to-pg-date
    summary: |
      On the postgres target, the bare `Date` type constructor (`postgresNativeAuthoringTypes` in `@internal/adapter-postgres`) re-binds from `pg/timestamptz@1` to the dedicated `pg/date@1` codec. Rewrite the removed `DateTime @db.Date` spelling as `Date`; leaving it unchanged now fails with migration guidance to use `Date` in type position. The stored native type is unchanged (`date`). Extension assertions over `collectScalarTypeConstructors(stack.authoringContributions.type)` now expect `Date -> { codecId: 'pg/date@1', nativeType: 'date' }`. Extension test schemas and fixtures with date columns produce a different codec ref and contract storage hash on re-emit; regenerate committed contract artefacts and update pinned hash or codec-ref literals. Runtime fixtures change shape too:
      `pg/date@1` canonicalizes the JS value as a `Date` at UTC midnight
      (`new Date(Date.UTC(y, m, d))`) instead of passing through the driver's local-midnight
      `Date`, and its JSON form is the bare `YYYY-MM-DD` string, so relation `.include()`
      decode over date columns now succeeds instead of failing with `RUNTIME.DECODE_FAILED`.
      Contracts emitted before the upgrade keep working (`pg/timestamptz@1` still exists).
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
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

  - id: rls-wire-name-helpers-moved-to-sql-schema-ir-naming
    summary: |
      The RLS wire-name helpers moved out of the target-postgres RLS surface into the
      family-shared naming module, with generalized names — the wire-name scheme now serves
      indexes as well as policies. Deleted from
      `@internal/target-postgres/rls-canonicalize`: `formatRlsPolicyWireName`,
      `parseRlsPolicyWireName`, `normalizePredicate`, and the `RlsPolicyWireName` type. Import
      the replacements from `@internal/sql-schema-ir/naming` instead: `formatWireName`,
      `parseWireName`, `normalizeSqlBody`, and `WireName`. Behavior is byte-identical (same
      `<prefix>_<8hex>` format, same all-prefix-on-no-parse contract, same trim +
      whitespace-collapse normalizer). `@internal/target-postgres/rls-canonicalize` still
      exports the RLS-specific surface: `computeContentHash`, `ContentHashParts`,
      `POLICY_OPERATION_PREDICATES`, `RlsPolicyOperation`. The naming module also gains
      `computeIndexContentHash`, `WIRE_NAME_PREFIX_MAX_LENGTH`, and
      `assertWireNamePrefixLength` for packs that construct index wire names.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "formatRlsPolicyWireName"
        - "parseRlsPolicyWireName"
        - "normalizePredicate"
        - "RlsPolicyWireName"
      anyMatch: true
  - id: rls-policy-migration-literal-carries-the-naming-union
    summary: |
      The Postgres RLS policy migration literal spells its name as one union field from 0.17.
      `PostgresRlsPolicyMigrationInput` is deleted from `@internal/target-postgres/types`;
      the parameter `Migration#createRlsPolicy` accepts and the renderer writes is
      `RenderedRlsPolicyLiteral`, which is `PostgresRlsPolicyInput` with absent-valued keys
      omittable — so the flat `name` / `prefix` pair becomes `naming: { kind: "exact", name }`
      or `naming: { kind: "wire", prefix, hash }`. The contract-JSON shape is unchanged and
      keeps its own type, `SerializedRlsPolicy`, hydrated by `policyInputFromSerialized`
      (0.16's `rlsPolicyInputFromFlat`). Pack code constructing `PostgresRlsPolicy` directly
      already passed the `naming` union and is unaffected; pack code that built the flat
      migration literal, or that imported `PostgresRlsPolicyMigrationInput`, must switch to
      `RenderedRlsPolicyLiteral` and the union field. Regenerate any committed migration your
      pack ships that calls `createRlsPolicy` — a 0.16 file fails to compile with
      `Property 'naming' is missing`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "PostgresRlsPolicyMigrationInput"
        - "rlsPolicyInputFromFlat"
        - "createRlsPolicy"
      anyMatch: true
  - id: sql-index-entities-are-name-identified
    summary: |
      SQL index entities are name-identified from 0.17, at both layers an extension touches.
      Contract IR (`Index` from `@internal/sql-contract/types`): `name` (full physical
      name) and `unique` are required, `prefix` marks a wire name (`name` must parse
      back to `prefix` + 8-hex suffix), and `columns` became optional — exactly one of
      `columns` / `expression` must be set; the constructor and `IndexSchema` validation
      throw on the old shape, so any pack code or test fixture building `indexes: [{ columns:
      [...] }]` must add a real `name` and `unique`. The `index(...)` factory from
      `@internal/sql-contract/factories` is now `index(name, columns, opts?)`. Schema IR
      (`SqlIndexIR` from `@internal/sql-schema-ir/types`): the input requires `name` plus
      explicit `prefix` / `expression` / `where` keys, the diff-tree id is `index:<name>`
      (tuple-derived ids are gone — assertions on `index:<col,col>` ids must switch to the
      name), and `isEqualTo` is mode-selected: both modes compare `unique`/`type` strict,
      `options` loose, `columns` ordered-strict when both sides carry them; an exact-named
      node (no `prefix`) additionally byte-compares `expression`/`where`; a wire-named node
      never compares bodies. Construction sites must supply the real physical name — never a
      placeholder. Re-emit your pack's committed contract space (`build:contract-space` /
      `contract:generate`); storage hashes move for every contract that declares indexes, and
      wire-named index physical names gain the `_<8hex>` content-hash suffix (see the user-skill
      `indexes-are-name-identified` entry for the database-convergence flow — the first
      widening plan is renames-only).
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "SqlIndexIR"
        - "indexes: ["
        - "indexes:["
      anyMatch: true
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
  - id: postgres-extension-codecs-require-target-descriptors
    summary: Migrate PostgreSQL-bound extension codecs to the target-owned descriptor protocol and contribute one target-typed descriptor set through runtime and control stacks.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "extends CodecDescriptorImpl"
        - "CodecDescriptorImpl<"
        - "readonly AnyCodecDescriptor[]"
      anyMatch: true
  - id: rls-policies-gain-exact-names
    summary: |
      RLS policies adopt the same wire/exact identity split as indexes. On
      `PostgresRlsPolicyInput` / `PostgresPolicySchemaNodeInput`, `prefix`, `using`,
      `withCheck` (and the node input's `dependsOn`) change from optional keys to REQUIRED
      keys typed `| undefined` — a hard compile break for every existing construction site
      that omitted them: `new PostgresRlsPolicy({ …, using })` without `withCheck` no longer
      compiles. Fix: state the absent keys explicitly (`withCheck: undefined`,
      `prefix: undefined`, `dependsOn: undefined`). In the serialized policy contract schema
      `prefix` stays optional — its presence means wire-named, absence means
      exact-named (a verbatim adopted physical name). Both constructors now ENFORCE that a
      declared
      `prefix` matches the wire name's parsed prefix: pack code or test fixtures building a
      `PostgresRlsPolicy` / `PostgresPolicySchemaNode` whose `name` is not
      `<prefix>_<8hex>`-shaped while still passing a `prefix` (e.g. `prefix: name` for a
      hand-written legacy name) now throw — omit `prefix` for such names; that is the
      exact-named spelling. Exact-named policy nodes compare by content (`operation` /
      `permissive` strict, `roles` as a deduplicated sorted set, `using` / `withCheck`
      byte-for-byte), so a
      body-drifted same-named exact policy now surfaces as a `not-equal` verify issue and a
      drop + create plan instead of being invisible. PSL policy blocks newly accept
      `@@map("physical name")` to author the exact mode (additive — wire lowering is
      byte-unchanged).
    detection:
      glob: "**/*.{ts,mts,cts,prisma}"
      contains:
        - "PostgresRlsPolicy"
        - "PostgresPolicySchemaNode"
        - "policy_select"
        - "policy_insert"
        - "policy_update"
        - "policy_delete"
        - "policy_all"
  - id: codec-json-projections-must-agree-with-encode-json
    summary: |
      A target codec descriptor's `jsonProjection` hook is now live rather than a placeholder:
      it states, as SQL, the canonical JSON of the codec it belongs to, and the two sides are
      required to agree — the parsed projection must equal `encodeJson(value)`, and
      `decodeJson` of that must return the application value. If your extension contributes a
      PostgreSQL or SQLite codec descriptor whose `jsonProjection` still returns its argument
      unchanged, check that the target's own JSON conversion really is your canonical form; if
      it is not, the projection has to replace that conversion rather than post-process it.
      Where a cast is needed it belongs *inside* the projected expression, so it applies before
      the JSON constructor sees the value — a cast applied to the constructor's result is too
      late, because the value has already been converted. `encodeJson` / `decodeJson` move with
      the projection, in the same change.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "jsonProjection"
        - "PostgresCodecDescriptor"
        - "SqliteCodecDescriptor"
      anyMatch: true
  - id: pgvector-json-form-is-a-numeric-array
    summary: |
      `pg/vector@1` encodes to and decodes from a JSON numeric array — `[1,2,3]` — where it used
      the string `"[1,2,3]"`. `decodeJson` rejects the string form, because reading a vector's
      text back at double width lands on a different number: a vector's elements are `real`, and
      its text form prints the shortest decimal that round-trips *as a real*. If your extension
      consumes `pg/vector@1` values out of a contract, or models a codec on it, switch to the
      array form. Note the element type: an application value must be exactly representable as a
      32-bit float to round-trip at all.
    detection:
      glob: "**/*.{ts,tsx,json}"
      contains:
        - "pg/vector@1"
      anyMatch: true
  - id: default-literal-value-resolves-through-the-codec-json-channel
    summary: |
      `ExtractCodecTypes` gains a `json` channel beside `input` and `output`, read off a codec's
      declared `encodeJson` return type, and the emitted `DefaultLiteralValue` helper resolves a
      contract's literal default through that channel rather than through the codec's application
      type. A literal default lives in `contract.json`, so it is typed by what the file holds and
      not by what the application receives — the two diverge for any codec whose canonical JSON
      differs from its application value. Re-run your contract-space build
      (`pnpm build:contract-space`, or `prisma-next contract emit`) to regenerate every
      `contract.d.ts`; the alias definition changes in each. A codec that narrows its
      `encodeJson` return type publishes its JSON type through the new channel; one that does not
      keeps the `JsonValue` the base signature promises.
    detection:
      glob: "**/*.{ts,d.ts}"
      contains:
        - "DefaultLiteralValue"
        - "ExtractCodecTypes"
      anyMatch: true
  - id: pg-int8-application-values-are-bigint
    summary: |
      `pg/int8@1` carries `bigint` application values where it carried `number`, and its JSON
      form is decimal text. Extension code that reads an `int8` column, resolves an aggregate to
      that codec, or hand-writes an `int8` literal default must move to `bigint` and to the
      decimal-string JSON spelling. `parsePostgresDefault` changes with it: an introspected
      `int8` default now reads as decimal text across the whole signed 64-bit range, where it
      previously returned a `number` for a safe integer and a string only past 2^53 — if your
      extension compares introspected defaults against contract defaults, that split is gone.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "pg/int8@1"
        - "parsePostgresDefault"
      anyMatch: true
  - id: extension-column-codecs-must-be-declared-as-target-descriptors
    summary: |
      An extension that contributes a codec used on a *column* must publish its target descriptors
      through `types.codecTypes.codecDescriptors` on the runtime (and control) extension
      descriptor. The renderers resolve a column's JSON projection out of the assembled descriptor
      registry, which is built from that field alone — `codecs()` feeds a different path. A codec
      reachable through `codecs()` but absent from `types.codecTypes.codecDescriptors` now fails at
      lowering with `RUNTIME.PARAM_REF_MISSING_CODEC` naming the codec id, where the renderer
      previously ignored codec identity and emitted the bare column. The failure is deliberate:
      emitting the bare column would produce exactly the uncanonical JSON the projection exists to
      replace. Publish the same target-typed set in both places.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "codecTypes"
        - "codecs: () =>"
        - "SqlRuntimeExtensionDescriptor"
      anyMatch: true
  - id: contract-infer-emits-full-fidelity
    summary: |
      `contract infer` emits every non-constraint index (expression, partial `where:`,
      unique, `type:`/`options:`) and the RLS surface (`@@rls` natively, every policy as a
      `policy_<operation>` block with `@@map` and verbatim reprinted bodies, `permissive =
      false` for RESTRICTIVE rows). A pack whose contract-space generator runs infer (the
      supabase pattern) sees ADDITIVE movement on its next regeneration: previously omitted
      partial/expression/unique indexes adopt as exact `map:` entries, and `@@rls` no longer
      needs an out-of-band appender — delete any `applyRlsEnablement`-style post-processing
      and regenerate through the checked-in generator; re-emit moves the storage hash. The
      duplicate-index validation keys exact-mode entries by name, so a reference database's
      content-identical twin indexes now validate. An index whose live name is wire-shaped
      and whose hash recomputes against the introspected content re-infers as wire-named
      `name:` — a heuristic: a name that is not wire-shaped, or whose hash does not
      recompute, adopts as exact `map:`.
    detection:
      glob: "**/*.{ts,mts,cts,prisma}"
      contains:
        - "inferPslContract"
        - "contract infer"
        - "@@rls"
      anyMatch: true
  - id: postgres-packages-now-ship-types-pg
    summary: |
      `@internal/postgres`, `@internal/extension-supabase`, and
      `@internal/driver-postgres` re-export `pg` types from their published
      declarations, so each now carries `@types/pg` in `dependencies` instead of
      `devDependencies`. Extension authors previously had to add `@types/pg` to their own
      devDependencies to compile against those declarations — that workaround is now the
      hazard. `pg` ships no types of its own, so a second `@types/pg` copy at a different
      version gives `pg.Client` / `pg.Pool` two identities, and handing your own client or
      pool to a Prisma Next API stops compiling with `Argument of type 'Client' is not
      assignable to parameter of type 'Client'` (`Type 'Client' is missing the following
      properties from type 'Client': connection, setTypeParser, getTypeParser`). Drop
      `@types/pg` from your extension and take it transitively, or pin it to the version
      `@internal/postgres` depends on.
    detection:
      glob: "**/package.json"
      contains:
        - "@types/pg"
      anyMatch: true
  - id: build-against-published-packages-not-workspace-names
    summary: |
      The `@internal/*` packages are gone from the registry. Until 0.17 every
      workspace package published, so a pack could depend on `@internal/contract`,
      `@internal/sql-contract`, `@internal/framework-components` and the rest
      directly — and many do. From 0.17 the published surface is 17 `@prisma/*`
      packages and everything else carries `"private": true` in its manifest, so
      those dependencies no longer resolve anywhere: a stale name fails at install
      time rather than resolving to an outdated artifact left on the registry.
      Build against the platform packages instead: `@prisma/orm-framework` for contract,
      components, errors and the PSL tooling; `@prisma/orm-family-sql` or
      `@prisma/orm-family-mongo` for the family surfaces; `@prisma/orm-target-<db>` for the
      target, adapter and driver your pack extends; `@prisma/orm-toolchain` for the emitter and
      migration tooling. Each internal package became a subpath entrypoint of exactly one of
      those, so the module you imported still exists under a new name — the mapping is one hop
      and the symbols are unchanged. Declare the target shell your pack extends as a peer
      dependency rather than a dependency, so an application cannot end up with two copies of
      the target it is registered against.
    detection:
      glob: "**/package.json"
      contains:
        - '"@internal/'
      anyMatch: true
---

# 0.16 → 0.17 — Extension-author upgrade instructions

## `strip-sha256-hash-prefixes`

Starting at the 0.17 release, every content hash the framework mints or accepts is bare lowercase hex — the `sha256:` prefix is removed across the board: emitted `contract.json` / `contract.d.ts` (including `StorageHashBase<'…'>` / `ProfileHashBase<'…'>` branded type literals), migration manifests, refs, CLI output, and the marker/ledger tables. The prefix carried no information (the algorithm never varied per hash), and the hash **value** — not an in-band tag — signals a format change. The hash constructors and every loader now reject the legacy prefixed form.

Two distinct effects on your pack's checked-in artefacts:

- **Contract hashes keep their value.** `storageHash` / `profileHash` are computed over contract content, which never embedded its own hash — only the textual prefix drops.
- **Migration hash values change.** `migrationHash` is computed over the manifest bytes, which embed the `from` / `to` contract-hash strings; with those now bare, every recomputed `migrationHash` differs from the stored one.

### Migrate checked-in `migrations/` trees — before the layout migrator

Run the colocated codemod from your extension's repository root, **before** `scripts/migrate-migrations-layout.mjs` (the snapshot-layout entries above) — the 0.17 layout migrator accepts only bare-hex trees:

```bash
pnpm exec tsx ./strip-sha256-hash-prefixes.ts
```

For every on-disk migration package (a `migration.json` with a sibling `ops.json`) it strips the prefix from the manifest's `from` / `to`, from hash literals inside `ops.json`, in pre-store sibling contract snapshots (`*-contract.json`, `*.d.ts`, `migration.ts`), and in content-addressed store entries (`migrations/snapshots/<hex>/contract.json` + `contract.d.ts` — the directory name is the hash's hex and does not change), recomputes `migrationHash` over the bare-hex content, and rewrites `refs/*.json` — repointing refs that held old migration hashes at the recomputed ones, and mapping the empty-tree sentinel `sha256:empty` to `empty`. The edit is format-preserving (only hash literals and the recomputed hash value change) and idempotent: re-running over an already-bare tree makes no further changes.

Use `--check` for a dry run that lists files still needing the fix and exits non-zero if any remain:

```bash
pnpm exec tsx ./strip-sha256-hash-prefixes.ts --check
```

### Re-emit committed contract artefacts

If your pack commits emitted contract artefacts (a pack contract under `src/contract/`, test fixtures, example spaces), re-emit them the way your pack generates them (`prisma-next contract emit` or your regeneration script). The regenerated files differ only in hash representation — the hash values themselves are unchanged.

### Update hash literals your pack hard-codes

Sweep your pack's source, fixtures, and tests for `sha256:`-prefixed literals — hand-built contract fixtures, expected `migrationHash` assertions, stub hashes in unit tests. Drop the prefix everywhere; for migration hashes, take the new value from the regenerated manifest, since the value itself changed. Constructing a hash via the framework's `coreHash()` / `profileHash()` constructors with a prefixed string now throws instead of round-tripping.

### Database marker/ledger

There is no compatibility shim: a database whose marker/ledger rows still hold prefixed values reports a hash mismatch on `prisma-next db verify`. This applies to any signed database your extension maintains — acceptance harnesses, reference instances. Re-sign each against its regenerated contract:

```bash
prisma-next db sign
```

### Validation

After the codemod and re-emit, run `pnpm typecheck && pnpm test` in your extension repo, and exercise any flow that loads your migrations — the loader recomputes and verifies each manifest's `migrationHash` on read, so a stale or still-prefixed manifest fails immediately. `git grep -n "sha256:"` over your repository should return no hits in committed artefacts.

## `adopt-sql-json-projection-ast-foundations`

Relational JSON container AST construction now requires an explicit value-projection variant. Import `NativeJsonValueProjection` from `@internal/sql-relational-core/ast` and wrap every expression that 0.16 code passed directly to `JsonObjectExpr.entry(key, expression)` or `JsonArrayAggExpr.of(expression, ...)`: use `JsonObjectExpr.entry(key, new NativeJsonValueProjection(expression))` and `JsonArrayAggExpr.of(new NativeJsonValueProjection(expression), ...)`. `NativeJsonValueProjection` preserves the pre-0.17 target-native JSON conversion. Use `CodecJsonValueProjection` only when the extension deliberately supplies a `CodecRef` for codec-owned JSON conversion, and use `JsonDocumentProjection` only when the wrapped expression already produces a JSON document.

`ExprVisitor<R>` and the `AnyExpression` union now include `FunctionCallExpr` (`kind: 'function-call'`), `CastExpr` (`kind: 'cast'`), and `CaseExpr` (`kind: 'case'`). Add `functionCall`, `cast`, and `case` methods to every visitor object, and add all three discriminants to exhaustive `expr.kind` switches. Binding or rewriting visitors should route these nodes through their normal recursive expression path; restricted visitors such as grouped `HAVING` validators should reject them explicitly when the context does not support them.

`FunctionSource.of(fn, args, alias)` now groups alias state so returned-column aliases cannot exist without a table alias. Replace a string third argument such as `FunctionSource.of(fn, args, 'rows')` with `FunctionSource.of(fn, args, { alias: 'rows' })`; when returned-column names are required, pass `{ alias: 'rows', columnAliases: ['value', 'ordinality'] }`. Calls that omit the alias remain unchanged.

When an extension forwards an existing `ProjectionItem` through a derived-table or row-number wrapper, preserve its known codec in the reconstructed projection: use `ProjectionItem.of(item.alias, ColumnRef.of(wrapperAlias, item.alias), item.codec)`. Leave the codec undefined only for computed or otherwise unknown projected results. After applying the applicable edits, run the extension's typecheck and tests; update AST-shape fixtures to assert the explicit wrapper nodes and preserved codec metadata.
## `rls-wire-name-helpers-moved-to-sql-schema-ir-naming`

The wire-name mechanics are family-shared from 0.17 (they now serve secondary indexes as well as RLS policies), so the helpers moved from the target-postgres RLS module to `@internal/sql-schema-ir/naming` under generalized names. Apply the mechanical rename:

| 0.16 (`@internal/target-postgres/rls-canonicalize`) | 0.17 (`@internal/sql-schema-ir/naming`) |
| --- | --- |
| `formatRlsPolicyWireName(prefix, hash)` | `formatWireName(prefix, hash)` |
| `parseRlsPolicyWireName(name)` | `parseWireName(name)` |
| `normalizePredicate(sql)` | `normalizeSqlBody(sql)` |
| `RlsPolicyWireName` (type) | `WireName` (type) |

Behavior is byte-identical — same `<prefix>_<8hex>` format and parse pattern, same treat-as-all-prefix contract for names that do not parse, same minimal trim-and-collapse normalizer (still a stability commitment: any change would re-suffix every wire name). `@internal/target-postgres/rls-canonicalize` keeps the RLS-specific exports (`computeContentHash`, `ContentHashParts`, `POLICY_OPERATION_PREDICATES`, `RlsPolicyOperation`); there are no re-export shims for the moved names. The naming module additionally exposes `computeIndexContentHash`, `WIRE_NAME_PREFIX_MAX_LENGTH` (54), and `assertWireNamePrefixLength` — the index-side siblings of the RLS hash assembly.

## `sql-index-entities-are-name-identified`

Indexes are name-identified end to end. Two SPI layers change shape; take them in order.

### Contract IR: `Index` / `IndexSchema`

An index entity (`Index` from `@internal/sql-contract/types`; the `indexes: []` array in a `StorageTable`) now requires:

- `name: string` — the full physical name, always present.
- `unique: boolean` — always present.
- `prefix?: string` — present iff the name is wire-named; the constructor enforces that `name` parses back to `prefix` + an 8-hex suffix.
- `columns?` xor `expression?` — exactly one must be set; `where?` carries a partial-index predicate. All body strings are opaque SQL, never parsed or escaped.

Both the class constructor and the arktype `IndexSchema` reject the 0.16 shape. Contract-space fixtures or pack code that load `indexes: [{ columns: ['email'] }]` through validation fail with a `Contract structural validation failed: storage.namespaces.<ns> …` error whose message contains `indexes[0].name must be a string (was missing)` and `indexes[0].unique must be boolean (was missing)`; constructing the entity directly throws `Index: every index carries a full physical name…`. Add the real physical name and `unique: false`. The `index(...)` convenience factory from `@internal/sql-contract/factories` changed signature accordingly: `index(name, columns, opts?)` (opts: `prefix`, `unique`, `type`, `options`). Packs that lower authored index inputs themselves can reuse `lowerAuthoredIndex` from `@internal/sql-contract/index-naming` — it implements the wire/exact naming rules (default prefix, `name:`-as-prefix, `map:`-as-exact) including the 54-character prefix cap.

### Schema IR: `SqlIndexIR`

`SqlIndexIRInput` requires `name` and adds explicit `prefix` / `expression` / `where` keys (the package's every-field-required convention: state absence with `undefined`, never by omission), and `columns` became `readonly string[] | undefined` (xor `expression`). The node's diff-tree `id` is now `index:<name>` — the old tuple-derived `index:<col,col>` ids are gone, so any test asserting child ids or diff paths must use the physical name. `isEqualTo` is mode-selected by the receiver: both modes compare `unique` strict, `type` strict, `options` loosely (`String()`-coerced), and `columns` ordered-strict when both sides carry them; an exact-named receiver (`prefix === undefined`) additionally byte-compares `expression ?? ''` and `where ?? ''`; a wire-named receiver never compares bodies. Introspection now captures expression and partial indexes at full fidelity and preserves same-tuple twin indexes — packs must not assume one index per column tuple.

### Committed contract spaces

Re-emit your pack's contract space with the upgraded toolchain (`build:contract-space`, or your generator script à la `contract:generate`): every contract that declares indexes gets the new entry shape and a new storage hash, and wire-named index physical names gain the `_<8hex>` content-hash suffix. Databases your pack maintains (acceptance harnesses, reference instances) converge via a renames-only widening plan — see the user-skill `indexes-are-name-identified` entry for that flow. Expression and partial indexes are authorable from 0.17 (PSL `@@index(expression:/where:/unique:/type:/name: xor map:)`, TS `constraints.index` with the same matrix); declare them with `name:` for wire names, or `map:` for infer-captured exact names — hand-authoring a body under `map:` warns (`PN_EXACT_NAME_BODY_COMPARISON`) because drift detection byte-compares the authored text against Postgres's reprint. Live indexes you choose not to declare stay tolerated under an `external` control policy. The rules behind all of this — why an index is identified by its name, when the two naming modes apply, and what re-inference does to each — are decided in ADR 243, "Name-identified indexes and exact-name adoption".

## `rls-policy-migration-literal-carries-the-naming-union`

`PostgresRlsPolicyMigrationInput` is gone. The parameter `Migration#createRlsPolicy` accepts, and the shape `CreatePostgresRlsPolicyCall.renderTypeScript` writes into a generated migration, is now `RenderedRlsPolicyLiteral` — `PostgresRlsPolicyInput` with absent-valued keys omittable, which is how a machine-rendered literal spells absence. The practical difference is the name:

| 0.16 | 0.17 |
| --- | --- |
| `name: "post_owner_a1b2c3d4", prefix: "post_owner"` | `naming: { kind: "wire", prefix: "post_owner", hash: "a1b2c3d4" }` |
| `name: "Tenant members can read"` | `naming: { kind: "exact", name: "Tenant members can read" }` |

The two flat fields could disagree; the union cannot be written wrong, which is why the migration authoring surface carries it.

The stored `contract.json` shape does not change — it stays flat and now has its own type: `SerializedRlsPolicy`, hydrated by `policyInputFromSerialized` (0.16's `rlsPolicyInputFromFlat`, renamed for the boundary it serves). Both are exported from `@internal/target-postgres/types`.

Pack code that constructs `PostgresRlsPolicy` directly already passes `naming` and needs no edit. Pack code that builds the migration literal, or that names `PostgresRlsPolicyMigrationInput` in a signature, switches to `RenderedRlsPolicyLiteral`. Regenerate any migration your pack ships that calls `createRlsPolicy`.

## `postgres-extension-codecs-require-target-descriptors`

For every codec descriptor contributed by a PostgreSQL extension, add `@internal/target-postgres` at the same 0.17 version as the extension's other `@internal/*` packages under `dependencies`. Do not leave it only in `devDependencies`: production descriptor modules and runtime/control stack metadata import and expose this protocol. Import the target API from the lean `@internal/target-postgres/codec-descriptor` subpath, and import `ProjectionExpr` from `@internal/sql-relational-core/ast`.

Change a PostgreSQL-bound descriptor that extends `CodecDescriptorImpl<P>` to extend `PostgresCodecDescriptor<P>`. Keep its codec id, traits, target types, `paramsSchema`, factory, output renderer and column helpers unchanged; there is no longer a `meta` / `metaFor` channel to carry alongside, and the descriptor's `nativeTypeFor()` is the only place a native type is declared. Add `protected override nativeType(params: P): string` returning the same trusted PostgreSQL native type spelling the extension already uses, and add `protected override jsonProjection(expression: ProjectionExpr, params: P): ProjectionExpr`.

`return expression` is a claim, not a placeholder: the production JSON renderers call `projectJson()` for every column-valued entry they build, so an identity projection asserts that your codec's stored form already *is* its canonical JSON. Write one only where that holds, and where it does not, see `codec-json-projections-must-agree-with-encode-json` below.

When the extension contributes a reusable target-neutral SQL descriptor instead of owning its descriptor class, keep the generic descriptor unchanged and wrap it with `postgresCodec(genericDescriptor, { nativeType, jsonProjection })`. Supply the native type and the canonical JSON projection as above. The wrapper delegates the generic descriptor's codec id, literals, parameter schema, factory, renderers and target types, and adds the PostgreSQL discriminant and target methods.

Replace broad exported descriptor arrays such as `readonly AnyCodecDescriptor[]` with `definePostgresCodecs([...])`. Use the resulting canonical target-typed set in both runtime and control `types.codecTypes.codecDescriptors`, and return that same set from runtime `codecs()` when the runtime extension SPI requires it. Do not construct independently maintained generic and PostgreSQL descriptor collections. Update exact-type tests that expected `readonly AnyCodecDescriptor[]` to accept `readonly AnyPostgresCodecDescriptor[]`; ordinary descriptors still satisfy `AnyCodecDescriptor` individually.

Review every `CodecRef` construction for a parameterized descriptor, including parameter refs, contract/storage fixtures, and test-created refs. Supply `typeParams` with every field required by the target descriptor `paramsSchema`; for example, a `pg/vector@1` ref for a three-element vector must include `typeParams: { length: 3 }`. Do not make a required descriptor parameter optional merely to preserve an invalid unparameterized ref.

When a parameterized descriptor intentionally supports an unparameterized column or contract reference, make its parameter type and Standard Schema accept the empty validated parameter object used during representative materialization. Express only genuinely absent fields as optional and preserve the existing unparameterized factory behavior; do not add a hidden default or change the codec encoded representation.

After the migration, run the extension package's typecheck, lint, and tests. Verify its public codec ids, factories, column helpers, rendered types, SQL/wire behavior, `encodeJson` / `decodeJson`, runtime/control descriptor membership, and emitted contract behavior are unchanged apart from the descriptor types becoming PostgreSQL-specific.

## `postgres-packages-now-ship-types-pg`

`@internal/postgres`, `@internal/extension-supabase`, and `@internal/driver-postgres` re-export `pg` types from their published `.d.mts` files, so each declares `@types/pg` under `dependencies` from 0.17. Compiling against those declarations no longer requires your extension to supply `@types/pg` itself.

If your extension's `package.json` declares `@types/pg`, act on it. `pg` carries no types of its own, so two `@types/pg` copies in the tree give `pg.Client` and `pg.Pool` two distinct identities. Any call that hands your own client or pool to a Prisma Next API — `new PostgresControlDriver(client)`, a driver `connect: { pool }` — then fails:

```text
Argument of type 'Client' is not assignable to parameter of type 'Client'.
  Type 'Client' is missing the following properties from type 'Client': connection, setTypeParser, getTypeParser
```

The error names the same type on both sides; the two paths under `node_modules/.pnpm/@types+pg@<version>/` in the full message are what identify it.

Prefer dropping `@types/pg` from your extension's `devDependencies` and taking it transitively, so its version tracks Prisma Next's. If you keep the entry — because your own code imports `pg` directly and you want the dependency explicit — pin it to the version `@internal/postgres` depends on rather than a range that can resolve elsewhere.

## Incidental lint-config bumps

Biome `$schema` version alignment in `packages/3-extensions/` (dependabot `dev-deps` group, PR #1058) requires no Prisma Next-specific upgrade action by extension authors.

## `codec-json-projections-must-agree-with-encode-json`

Slice-2 shipped `jsonProjection` as a typed hook that every descriptor implemented as `return expression`. Those hooks now carry real SQL, and a descriptor's two sides are held to agreeing with each other.

The ordering is the part worth internalising, because it is the same in all three shapes it has taken:

- a numeric cast to `text` sits inside the projected expression, so it applies before the JSON constructor can render the value as a JSON number;
- a base64 encoding *replaces* the target's own conversion rather than post-processing it, because the target would otherwise have already emitted its hex form;
- a widening of a narrow float to a wider one happens before any text rendering, because the printing is what discards precision.

In each case a transformation applied to the constructor's output would be too late. If you are authoring a projection, ask what the target does to the value if you do nothing, and whether that is recoverable.

Two properties are worth testing against a real database rather than reasoned about, because both turned out to be contingent: whether your form survives a value at the edge of its representation, and whether it depends on a session setting your consumers may not share.

## `pgvector-json-form-is-a-numeric-array`

The route matters as much as the destination here. Casting a vector's text form to `json` produces an array of numbers and looks correct — but the text prints the shortest decimal that round-trips as a `real`, so reading it at double width yields a different number than the application holds. Widening each element to `float8` before building the array keeps the exact value the `real` denotes.

## `default-literal-value-resolves-through-the-codec-json-channel`

Before this change the emitted type said a literal default had the codec's *application* type. That was true only while the two coincided. For a codec whose application value is a `bigint` and whose canonical JSON is a decimal string, it described a `bigint` sitting in a file that holds `"0"` — which surfaced as an assignability failure rather than as a wrong-but-quiet type.

Regenerating is sufficient; no hand edits to a `contract.d.ts` are needed.

## Incidental release version bump to 0.17.0

The `chore(release): bump to 0.17.0` commit rewrites every workspace manifest's `version` field and `workspace:` pins, which touches `packages/3-extensions/` manifests. No extension-author action beyond the entries above.
