---
from: "0.14"
to: "0.15"
changes:
  - id: sql-contract-createnamespace-required
    summary: |
      The SQL family no longer materialises a placeholder namespace, so authoring a SQL contract now
      requires a target namespace factory. If your extension builds a contract via `prismaContract(...)`
      or `defineContract(...)` from `@internal/sql-contract-psl` / `@internal/sql-contract-ts`
      (rather than through a target pack's own `defineContract` wrapper, which already supplies it),
      pass the now-required `createNamespace` option: `postgresCreateNamespace` from
      `@internal/target-postgres/types`, or `sqliteCreateNamespace` from `@internal/target-sqlite/control`.
      Without it, `contract emit` / build fails at runtime with "createNamespace is not a function".
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "prismaContract("
        - "defineContract("
      anyMatch: true
  - id: sql-namespace-types-renamed-and-removed
    summary: |
      `SqlNamespace` is now an abstract class and the family placeholder concretion is gone. Rename the
      factory-input type `SqlNamespaceTablesInput` -> `SqlNamespaceInput` (it is the `createNamespace`
      factory input, not a tables-only type). The removed symbols `buildSqlNamespace`,
      `buildSqlNamespaceMap`, `SqlBoundNamespace`, and `SqlUnboundNamespace` have no drop-in replacement:
      construct SQL namespaces only through a target `createNamespace` factory (`postgresCreateNamespace`
      / `sqliteCreateNamespace`). Any hand-written SQL namespace type literal or fixture must carry the
      target `kind` (e.g. `'postgres-schema'`) instead of the removed `'sql-namespace'` discriminator.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      contains:
        - "SqlNamespaceTablesInput"
        - "buildSqlNamespace"
        - "SqlBoundNamespace"
        - "SqlUnboundNamespace"
        - "'sql-namespace'"
      anyMatch: true
  - id: codec-render-value-literal-for-restricted-columns
    summary: |
      A field/column restricted to a value set (e.g. an enum) now derives its narrowed TS literal
      union **through the codec**, not the framework's (now-deleted) domain-enum override. If your
      extension authors a custom codec descriptor (`extends CodecDescriptorImpl`) used by a
      restricted/enum column, implement `renderValueLiteral(value, side)` on it so the column narrows
      to its value union; without it the column widens to the codec's output type
      (`CodecTypes[id][side]`). If your extension builds a `CodecLookup` by hand and drives the
      framework emitter (`generateContractDts`), expose `renderValueLiteralFor` so the emit path can
      reach your descriptor's renderer. Framework-built lookups (via the CLI/build / control-stack)
      already supply it — no action there. (`side`: `output` = the read/SELECT type, `input` = the
      create/update type.)
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "CodecDescriptorImpl"
        - "renderValueTypeFor"
        - "renderOutputType"
      anyMatch: true
  - id: sql-codec-json-result-decoding
    summary: |
      SQL `encodeJson` / `decodeJson` now use the exact scalar shape produced by the corresponding
      database inside JSON values. SQL include decoding calls `decodeJson`; ordinary column decoding
      continues to call `decode`. Update custom SQL codecs whose database JSON representation differs
      from their normal driver wire representation, then re-emit committed contracts and defaults.
      Built-in representation changes are: `pg/bytea@1` base64 -> `\\x`-prefixed hex,
      `pg/numeric@1` string -> JSON number, `pg/timestamp@1` UTC `Z` suffix -> no timezone suffix,
      `pg/timestamptz@1` UTC `Z` suffix -> `+00:00`, `sqlite/bigint@1` string -> JSON number,
      `pg/vector@1` JSON array -> Postgres vector text, and `pg/geometry@1` GeoJSON object -> HEXEWKB
      text. SQLite cannot represent BLOB values inside its native JSON values; such queries still fail
      at the database boundary rather than receiving a synthetic codec representation.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "encodeJson"
        - "decodeJson"
      anyMatch: true
  - id: mongo-derive-json-schema-value-sets-param
    summary: |
      `deriveJsonSchema` / `derivePolymorphicJsonSchema` (from `@internal/mongo-contract-psl`) now
      source a value-set field's `$jsonSchema` `enum` keyword from a value-set map, not the domain
      enum. Their fourth argument changed from a domain-enum map
      (`Record<string, ContractEnum>`, read as `members.map(m => m.value)`) to a value-set map
      (`FieldValueSets` = `Record<string, { values: readonly JsonValue[] }>`, keyed by the field's
      `valueSet` `entityName`). If your extension calls either function directly, pass the storage
      value sets (`contract.storage.namespaces[<ns>].entries.valueSet`) instead of `domain.enum`; the
      values are identical for enums, so the rendered validator is unchanged. Most extensions author
      Mongo contracts through `mongoContract(...)` / `defineContract(...)`, which call these
      internally — those need no change.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "deriveJsonSchema"
        - "derivePolymorphicJsonSchema"
      anyMatch: true
  - id: sql-migration-planner-keep-diff-issue-to-ownership-oracle
    summary: |
      `MigrationPlanner.plan()` (and the SQL family's `SqlMigrationPlannerPlanOptions`) drops the
      `keepDiffIssue` option — a caller-supplied `(issue: DiffIssue) => boolean` predicate the
      planner applied to its schema diff for multi-space ownership scoping. It is replaced by
      `ownership?: SchemaOwnership` — an ownership oracle (`{ declaresEntity(entityName): boolean }`,
      exported from `@internal/framework-components/control`) that the `ContractSpaceAggregate`
      satisfies. The planner asks it, per live extra node, whether any contract space declares that
      entity: a node another space owns is left untouched, a node no space owns is a genuine extra it
      may drop under a destructive policy. If your extension calls `planner.plan(...)` directly with
      `keepDiffIssue` (rather than through the aggregate's `db init` / `db update` / `migrate`
      orchestration, which passes the aggregate as the oracle for you), drop the predicate and pass
      the aggregate (or any object implementing `SchemaOwnership`) as `ownership`. There is no
      names-set and no filter function — ownership lives in the aggregate; the planner only asks.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "keepDiffIssue"
      anyMatch: true
  - id: family-sql-collect-sql-schema-issues-removed
    summary: |
      `collectSqlSchemaIssues`, `collectSqlSchemaIssuesPerNamespace`, and their
      `CollectSqlSchemaIssuesOptions` options type are removed from `@internal/family-sql/diff`.
      They implemented the coordinate-based relational schema diff the migration planner used before
      it moved onto the generic node differ (`plan(start, end)`). There is no drop-in replacement —
      if your extension called either function directly to compare a contract against a live/derived
      schema, use the generic node differ instead: `diffSchemas` (from
      `@internal/framework-components/control`) over two schema-IR trees, or a target's own
      `buildXPlanDiff` (e.g. `buildPostgresPlanDiff` from `@internal/target-postgres/diff-database-schema`,
      `buildSqlitePlanDiff` from the sqlite target) for the same op-render-stamped comparison the
      planner itself runs.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "collectSqlSchemaIssues"
        - "collectSqlSchemaIssuesPerNamespace"
        - "CollectSqlSchemaIssuesOptions"
      anyMatch: true
  - id: sql-control-target-descriptor-diff-database-schema-removed
    summary: |
      `SqlControlTargetDescriptor` (from `@internal/family-sql/control`) drops the
      `diffDatabaseSchema` field — the per-target `SchemaDiffer` hook that used to back the
      coordinate-based relational diff. If your extension implements a custom SQL target descriptor
      and supplied this field, remove it; the migration planner reaches the one differ directly via
      the target's own diff-tree builder now (see the `family-sql-collect-sql-schema-issues-removed`
      entry above). `diffSchemaForVerdict` (the full-tree node diff the verify verdict derives from)
      is unaffected and still required.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "diffDatabaseSchema"
      anyMatch: true
  - id: migration-tools-aggregate-strategy-rename
    summary: |
      `@internal/migration-tools/aggregate` renames its exported graph-walk strategy to say what
      it does, not how it's implemented: `graphWalkStrategy` -> `resolveRecordedPath`,
      `GraphWalkOutcome` -> `ResolveRecordedPathOutcome`, `GraphWalkStrategyInputs` ->
      `ResolveRecordedPathInputs`. The function's behaviour, inputs, and outcome shape are
      unchanged — only the names. If your extension imports any of these symbols directly (rather
      than going through `planMigration`, which handles this internally), update the import names.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "graphWalkStrategy"
        - "GraphWalkOutcome"
        - "GraphWalkStrategyInputs"
      anyMatch: true
  - id: target-postgres-diff-postgres-database-schema-removed
    summary: |
      `diffPostgresDatabaseSchema` is removed from `@internal/target-postgres/planner` — the
      Postgres-specific coordinate-based `SchemaDiffer` implementation, retired alongside
      `SqlControlTargetDescriptor.diffDatabaseSchema` (see the entry above). If your extension
      imported it directly, use `buildPostgresPlanDiff` from
      `@internal/target-postgres/diff-database-schema` instead — it runs the same one-differ
      comparison the planner itself uses (relational + RLS-policy issues in one node-typed list,
      filter to the subset you need) and additionally stamps the op-render payload the planner reads.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "diffPostgresDatabaseSchema"
      anyMatch: true
  - id: schema-issue-vocabulary-retired
    summary: |
      The coordinate-based issue vocabulary is gone: `BaseSchemaIssue`, `SchemaIssue`,
      `EnumValuesChangedIssue`, and the `DiffIssue` union are removed from
      `@internal/framework-components/control`. `SchemaDiffIssue` (`{ path, reason, message,
      expected?, actual? }`) is the only issue shape everywhere now — verify results, the codec
      `verifyType` hook, and `SchemaVerifier.issues` all report it. Its `outcome` field is also
      gone; use `reason` (`'not-found'` | `'not-expected'` | `'not-equal'`) instead — `outcome`'s
      `'missing'` / `'extra'` / `'mismatch'` map onto those three respectively. If your extension
      imports any of the removed types, constructs a `{ kind, table, message }`-shaped issue by
      hand, or reads `.outcome` off a `SchemaDiffIssue`, switch to the node-typed shape and
      `reason`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "BaseSchemaIssue"
        - "EnumValuesChangedIssue"
        - "SchemaDiffOutcome"
        - ".outcome === 'missing'"
        - ".outcome === 'extra'"
        - ".outcome === 'mismatch'"
      anyMatch: true
  - id: schema-finding-lists-single-list
    summary: |
      `SchemaFindingLists` (and therefore `VerifyDatabaseSchemaResult.schema` /
      `.schema.warnings`) collapses from two lists (`issues: SchemaIssue[]`, `schemaDiffIssues:
      SchemaDiffIssue[]`) to one: `{ issues: SchemaDiffIssue[] }`. The framework `SchemaDiff`
      class follows the same collapse — its constructor now takes one issue array instead of
      two (`new SchemaDiff(issues)`, not `new SchemaDiff(issues, schemaDiffIssues)`), and
      `.filter()` narrows the single list. If your extension reads
      `result.schema.schemaDiffIssues` (or `.schema.warnings.schemaDiffIssues`) directly, or
      constructs a `SchemaDiff` by hand, update both call sites to the single-list shape —
      concatenate the old two lists into one, in the same order, if you need to reproduce prior
      combined output.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "schemaDiffIssues"
        - "new SchemaDiff("
      anyMatch: true
  - id: codec-verify-type-hook-returns-schema-diff-issue
    summary: |
      `CodecControlHooks.verifyType` (the storage-type verification hook,
      `@internal/family-sql/control`) now returns `readonly SchemaDiffIssue[]` instead of
      `readonly SchemaIssue[]` — no more `kind` string; classify by `reason` instead. A storage
      type (e.g. a native enum) only ever diverges in its value set, so every paired
      `not-equal` finding grades as value drift (suppressed under an `external` control policy,
      same as before); `not-found` is a missing type, `not-expected` an extra one. If your
      extension implements a custom codec's `verifyType` hook, return `{ path, reason, message,
      expected?, actual? }` issues instead of the old `{ kind, table, message }` shape.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "verifyType:"
        - "verifyType("
      anyMatch: true
  - id: policy-target-models-require-rls-attribute
    summary: |
      If your extension's contract space authors `policy_select` blocks (PSL), each block's
      `target` model must now declare `@@rls`; `contract emit` / `build:contract-space` fails
      with `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE` otherwise. Add `@@rls` to the
      policy-bearing models and re-emit; the contract gains an `rls` marker entity
      (`entries.rls[tableName]`) and a new storage hash.
    detection:
      glob: "**/*.prisma"
      contains:
        - "policy_select"
      anyMatch: true
  - id: postgres-table-schema-node-rls-enabled-required
    summary: |
      `PostgresTableSchemaNodeInput.rlsEnabled` (from `@internal/target-postgres/types`) is
      now a required boolean, and `isEqualTo` compares it alongside the table name. Every
      `new PostgresTableSchemaNode({ ... })` construction in your extension (planner tests,
      diff-tree fixtures, tooling) must supply it explicitly - `false` for a table that is not
      RLS-controlled. The expected side derives the value from the contract's `entries.rls`
      marker; the actual side from `pg_class.relrowsecurity` at introspection.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "new PostgresTableSchemaNode("
      anyMatch: true
  - id: authoring-contributions-model-attributes-slot
    summary: |
      `AuthoringContributions` gains a `modelAttributes` slot and the assembled control-stack
      shape (`AssembledAuthoringContributions`) is now five fields - code that constructs the
      assembled shape literally (e.g. a stubbed `ContractSourceContext.authoringContributions`
      in tests) must add `modelAttributes: {}`. New SPI for pack authors: a target/extension
      pack can contribute declarative `@@` model attributes via
      `AuthoringContributions.modelAttributes` (an `AuthoringModelAttributeDescriptor` carries
      the bare attribute name, an ADR-231 `modelAttribute()` spec, and a lowering that files an
      entity into the namespace's `entries[attribute][key]`), and a PSL block descriptor can
      declare `requiresModelAttribute: { parameter, attribute }` to demand that the model
      named by a ref parameter carries a bare `@@` attribute.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "AssembledAuthoringContributions"
        - "authoringContributions: {"
      anyMatch: true
  - id: native-enum-serialized-in-contract-json
    summary: |
      `native_enum` entities now serialize into an extension's emitted `contract.json` (previously they
      were authoring-time-only — stripped on emit, leaving only the derived `valueSet`). If your
      extension declares native Postgres enums — `native_enum` blocks in a `.prisma` contract, or
      `pg.enum(...)` / `nativeEnum(...)` columns in the TypeScript DSL — re-emit your bundled contract
      (`prisma-next contract emit`) and commit the result, so the `entries.native_enum` maps and the
      recomputed `storageHash` land in your checked-in `contract.{json,d.ts}`. Re-emitting is what makes
      your pack's enum type names visible in the published contract: a consumer running `contract infer`
      with your pack in the stack subtracts your pack-owned enum types by matching those serialized type
      names, so an un-re-emitted contract leaves the consumer re-declaring types your pack already owns.
      The change is backward compatible (a pre-existing contract still hydrates), so re-emit at your
      next release rather than urgently.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      contains:
        - "native_enum"
        - "pg.enum("
        - "nativeEnum("
      anyMatch: true
  - id: native-enum-entry-keyed-by-physical-type-name
    summary: |
      A serialized `native_enum` entry is now keyed by its physical Postgres type name — the `@@map`
      value, or the declared type name when unmapped — not the TS-facing PascalCase name it previously
      used (`entries.native_enum.aal_level`, not `entries.native_enum.AalLevel`). This aligns the
      `native_enum` key with every other storage entry (a table keys by its physical name) per ADR 221.
      If your extension declares native Postgres enums, re-emit your bundled contract
      (`prisma-next contract emit`) and commit the result so the re-keyed `entries.native_enum` map and
      the recomputed `storageHash` land in your checked-in `contract.{json,d.ts}`. If your extension code
      addresses a `native_enum` entry by key
      (`contract.storage.namespaces[<ns>].entries.native_enum[<name>]`), switch that key from the
      PascalCase type name to the physical type name.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      contains:
        - "native_enum"
        - "pg.enum("
        - "nativeEnum("
      anyMatch: true
  - id: scalar-field-state-descriptor-generic
    summary: |
      `ScalarFieldState` (from `@internal/sql-contract-ts/contract-builder`) changes its first
      type parameter from the codec-id string (`CodecId extends string = string`) to the full column
      descriptor type (`Descriptor extends ColumnTypeDescriptor = ColumnTypeDescriptor`), so field
      states preserve the whole descriptor type — including a native-enum entity's member literal
      tuple — instead of only the codec id. If your extension names `ScalarFieldState<...>` with
      positional generics, wrap the codec id in the descriptor type: `ScalarFieldState<'pg/text@1',
      ...>` becomes `ScalarFieldState<ColumnTypeDescriptor<'pg/text@1'>, ...>` (import
      `ColumnTypeDescriptor` from `@internal/framework-components/codec`); the remaining six
      parameters are unchanged. Two narrowing ride-alongs can surface in exact-type test assertions:
      built contract types now keep a descriptor's literal `nativeType`/`typeParams` (previously
      widened to `string`), and `pg.enum(handle)` (from `@internal/postgres`) returns a descriptor
      whose `entityRef` is non-optional and whose `entityRef.entity` is `PostgresNativeEnum<Members>`
      instead of `unknown`. Both remain assignable everywhere the old types were accepted — update
      `expectTypeOf`-style equality assertions to the narrowed types; do not re-widen production
      types to satisfy them.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "ScalarFieldState"
      anyMatch: true
  - id: schema-ir-fk-unbound-referenced-schema-absent
    summary: |
      The family's `contractToSchemaIR` (from `@internal/family-sql/control`) no longer stamps
      `referencedSchema` on a derived `SqlForeignKeyIR` whose target is the unbound namespace — the
      field is now absent for that case (it previously carried the `__unbound__` sentinel). Namespace
      identity is answered by the namespace node's new `isUnbound` getter (on `NamespaceBase` /
      `SqlNamespace`), never by comparing an id against the sentinel. If your extension rebuilds a
      target schema-IR tree from a `contractToSchemaIR`-derived one and reconstructs each
      `SqlForeignKeyIR` (as the Postgres target does in `contractToPostgresDatabaseSchemaNode`),
      default the absent value back to the target's own coordinate for the unbound slot:
      `referencedSchema: fk.referencedSchema ?? UNBOUND_NAMESPACE_ID`. Extensions that read
      `referencedSchema` only for bound (named-schema) FK targets need no change — absence already
      meant "unbound" downstream.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "SqlForeignKeyIR"
        - "referencedSchema"
      anyMatch: true
  - id: supabase-pack-contract-complete
    summary: |
      The `@internal/extension-supabase` shipped contract is now the complete, introspection-generated
      description of everything Supabase owns — every `auth` (23) and `storage` (10) table of the
      reference platform version (supabase/postgres:17.6.1.106), all 10 native enum types, and the three
      roles — up from the previous 5-table minimum. All additive and still `external`: composing apps
      re-emit and pick up the new pack storageHash; `db.asServiceRole().supabase.{sql,orm}` now exposes
      the full owned table set; extension-aware `contract infer` omits correspondingly more. `db verify`
      now requires the full owned set to exist in the live database — real Supabase projects have them;
      a local or CI stand-in database should restore the pack's reference fixture: `bootstrapSupabaseShim`
      from `@internal/extension-supabase/test/utils` now does exactly that (it restores the complete
      reference schema — all Supabase schemas and roles — instead of a hand-authored 5-table subset), so
      shim users need no change beyond re-running. The curated `/contract` model handles (AuthUser,
      AuthIdentity, AuthSession, StorageBucket, StorageObject) are unchanged.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,prisma,json}"
      contains:
        - "@internal/extension-supabase"
      anyMatch: true
  - id: psl-relation-index-argument
    summary: |
      PSL's `@relation(...)` gained an optional boolean `index` argument that lowers onto the foreign
      key's existing IR `index` flag: `@relation(fields: [x], references: [y], index: false)` declares
      the FK without the derived backing-index expectation, for databases whose FK columns genuinely
      have no physical index (previously unexpressible in PSL — verify would report the synthesized
      index `not-found`). `contract infer` now emits `index: false` automatically for FKs it introspects
      without a live backing index, using the same column-key predicate verify uses (shared helper
      `backingIndexColumnKeys`/`isBackedByColumnKeys` in `@internal/family-sql`). Purely additive —
      omitted `index` keeps the default `true`; existing contracts re-emit byte-identically.
    detection:
      glob: "**/*.prisma"
      contains:
        - "@relation"
      anyMatch: true
  - id: contract-canonicalization-preserves-false
    summary: |
      The contract canonicalizer no longer strips `value: false` from resolved default-value objects
      (bare `false` was treated as an omittable empty value, so a `@default(false)` column lost its
      default in the emitted `contract.json` and never round-tripped against live introspection).
      Re-emitting a contract that has boolean-`false` column defaults changes its emitted JSON (the
      default is now present) and therefore its storageHash. No authoring-surface change; re-emit and
      commit the refreshed artifacts.
    detection:
      glob: "**/*.prisma"
      contains:
        - "@default(false)"
      anyMatch: true
  - id: sql-array-columns-round-trip
    summary: |
      Fixes for scalar-list (array) columns and introspection fidelity that can change emitted/derived
      artifacts for affected schemas: (1) the family's `contractToSchemaIR` now keeps an array column's
      `nativeType` as the bare element type with `many: true` (previously it baked `"text[]"` into
      `nativeType`, so every list column verified `not-equal` against live introspection); (2) Postgres
      introspection now excludes expression-keyed indexes (e.g. on `lower(email)`) and no longer
      collides a unique and non-unique index over identical columns; (3) `contract infer` carries a
      non-default index access method through as `@@index(..., type: "<method>")` — note the type must
      be registered in the stack's IndexTypeRegistry to emit. Extensions that snapshot introspection
      output or assert on derived schema-IR for array/expression-indexed tables should re-run and
      refresh expectations.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "contractToSchemaIR"
        - "introspect"
      anyMatch: true
  - id: postgres-inet-codec
    summary: |
      The postgres target gains a `pg/inet@1` codec (transparent string carrier, like `pg/uuid@1`):
      `inet` columns are now authorable as `String @db.Inet` in PSL and representable in contracts,
      and `contract infer` maps an introspected `inet` column to `String @db.Inet` instead of
      `Unsupported("inet")`. Purely additive — no existing contract changes; re-running `contract
      infer` against a database with inet columns now includes them in the output.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      contains:
        - "inet"
        - "db.Inet"
      anyMatch: true
  - id: psl-role-block
    summary: |
      PSL gains a standalone `role` block on the postgres target, authored inside the explicit
      unbound namespace: `namespace unbound { role anon {} }` (name-only, no parameters) lowers to a
      first-class `PostgresRole` entity in the contract's `__unbound__` storage slot
      (`control: 'external'` — roles are referenced, never owned; the planner emits no role DDL and
      `db verify` checks existence via `pg_roles`). The unbound namespace's purpose is late binding
      (search_path-resolved tables); roles are declared there because they are cluster-scoped and
      belong to no schema. To make this authorable, the "no `namespace unbound { }` alongside named
      namespaces" restriction is narrowed to models: a blocks-only unbound namespace is legal next
      to named namespaces, while one containing models next to named namespaces stays rejected
      (`PSL_RESERVED_NAMESPACE_NAME`). A `role` block anywhere else — a named namespace or the
      document top level — is rejected with `PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE`. Purely
      additive for existing contracts.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      contains:
        - "role "
        - "AuthoringPslBlockDescriptor"
      anyMatch: true
  - id: supabase-pack-contract-declares-roles
    summary: |
      The `@internal/extension-supabase` shipped contract now declares Supabase's three standard
      Postgres roles (`anon`, `authenticated`, `service_role`) as first-class `role` entities with
      `control: 'external'`. `db verify` on a project composing the pack now fails with a `not-found`
      schema issue naming each declared role the live database lacks. Real Supabase databases always
      have these roles, so hosted projects need no change; a local or CI database that stands in for
      Supabase must create them — `bootstrapSupabaseShim` from
      `@internal/extension-supabase/test/utils` already does. The public
      `SupabaseRoleBinding['role']` type is unchanged (`'anon' | 'authenticated' | 'service_role'`);
      it is now derived from the `SupabaseRole` Prisma Next enum handle's values; the contract declares the roles via the
      new PSL `role` blocks inside `namespace unbound { }` (see the `psl-role-block` entry).
    detection:
      glob: "**/*.{ts,mts,cts,tsx,prisma,json}"
      contains:
        - "@internal/extension-supabase"
      anyMatch: true
---
<!--
Release bump to 0.15.0 (PR #988): the version bump itself. Every
`packages/3-extensions/*/package.json` advances to 0.15.0 (version field +
`workspace:` specifier lockstep; one stray `workspace:*` in target-postgres
normalized to the pinned form). No SPI, contract shape, or emitted artefact
change beyond the pack version stamp. No extension-author action beyond the
normal dependency upgrade this recipe covers. Incidental substrate diff only.
-->

<!--
TML-2503 (extension-supabase Slice E — launch close-out, PR #985): docs only.
The `packages/3-extensions/` touch is `packages/3-extensions/supabase/README.md` —
the package README corrected to as-built (runtime usage, JWT validation modes, the
service_role admin root, unsupported scope). No SPI, contract shape, or emitted
artefact change. Incidental substrate diff only.
-->

<!--
TML-2787 (M:N slice 3): namespace-scoped execution-default refs land in
`@internal/sql-orm-client` (nested writes through a junction, the
required-payload gate, and the namespace-keyed `ExecutionMutationDefault.ref`).
The changes are internal to the ORM client and its emitted-contract consumption;
the extension-author surface is unchanged. No extension-author action — re-emit
picks up the new contract ref shape. Incidental substrate diff only.

TML-2929 (replace legacy PSL parser with CST symbol table): the SQL/Mongo PSL
interpreters now consume a symbol table built from the CST parser instead of the
legacy `parsePslDocument` AST. The only `packages/3-extensions/` touch is a
test-file call-shape rewire in `postgres/test/psl-namespace-qualifier-routing.test.ts`
(`{ document }` → the symbol-table interpreter input); no extension-author API
changed. No extension-author action. Incidental substrate diff only.

TML-2794 (M:N slice 5): wires the `mn-psl` integration fixture into the
`@internal/sql-orm-client` test `emit` script. Test-fixture infrastructure
only; no extension-author surface change. Incidental substrate diff only.

TML-2868 (Postgres RLS slice 1): adds the additive Postgres row-level-security
authoring feature. The only `packages/3-extensions/` touches are the re-emitted
`supabase/src/contract/contract.d.ts` (regeneration picks up the new RLS-capable
contract shape) and the `supabase/test/supabase-bootstrap.ts` test helper. No
extension-author API changed — the framework SPI is unchanged and re-emit
absorbs the contract shape. Incidental substrate diff only.

TML-2931 (entity-kind-migration-seam): implements the entity-kind seam for
schema diffing and provenance-symmetric RLS diff. The `packages/3-extensions/`
touches are test updates in `pgvector/test/migrations/` (planner fixtures
converted to `PostgresSchemaIR`) and `pgvector/test/descriptor.test.ts`
(contract shape updated to remove `__unbound__` namespace and adjust
`FieldOutputTypes`/`FieldInputTypes` to namespace-keyed form; precheck/postcheck
SQL assertions updated for parameterised queries). No extension-author API
changed. Incidental substrate diff only.

TML-2884 (Mongo enum end-to-end vertical): adds the Mongo domain-enum authoring
surface. The `packages/3-extensions/mongo/` touches are:
- New `mongo/src/contract/enum-type.ts` and exports in `mongo/src/exports/contract-builder.ts`
  (`enumType`, `member`, `EnumTypeHandle`, `EnumMember`) — all net-new exports; nothing
  existing was changed or removed.
- `mongo/src/runtime/mongo.ts` gains a `db.enums` facade property — an additive
  field on `MongoClient`; existing fields are unchanged.
- `mongo/package.json` gains `@internal/emitter` and `@internal/mongo-emitter`
  devDependencies for the new e2e test.
The `EnumTypeHandle` brand changed from a `Symbol()` to a string-key phantom (`__prismaNextEnumTypeHandle__`);
extension authors never construct or assert against the brand directly, so the structural surface
is unchanged. No extension-author action required — the enum surface is purely additive and
re-emit absorbs the new contract shape. Incidental substrate diff only.
-->

<!--
TML-2886 (redo, PR #841): type SQL enum columns via a baked storage column lookup.
The SQL emitter generates a new `StorageColumnTypes` map in `contract.d.ts`, keyed
`[namespace][table][column]`; `FieldOutputTypes`/`FieldInputTypes` are derived from it
at emit time. The extension-package `contract.d.ts` fixtures (paradedb, pgvector,
postgis, supabase, sql-orm-client test fixture) regenerate to add the `StorageColumnTypes`
block. `contract.json` and hashes are byte-identical; `FieldOutputTypes` is unchanged.
No extension-author API or surface change. Incidental substrate diff only.
-->

<!--
TML-2919: typed-DDL conversion of the not-null-with-temporary-default recipe (slice
1 of the typed-DDL migration-ops project). The recipe's ADD COLUMN execute step
now lowers a typed `PostgresAlterTable` DDL node through the adapter, with the
temporary backfill value carried as a `FunctionColumnDefault` — so the emitted
DEFAULT clause parenthesizes its expression (e.g. `DEFAULT ('')` instead of the
previous `DEFAULT ''`). Semantically identical in PostgreSQL. The recipe's DROP
DEFAULT step also routes through a new typed `DropDefaultAction`. The pgvector
`planner.behavior.test.ts` assertion that pins the recipe's emitted ADD COLUMN
SQL was updated to the parenthesized form. Test-only assertion update — no
extension-author API change. Incidental substrate diff only. (The 0.13 → 0.14
counterpart entry already records the same change; this entry covers the same
substrate diff against the post-0.14.0 main.)
-->

<!--
TML-2911 (native scalar-array storage machinery): the emitted contracts now carry
the adapter-reported `scalarList` capability marker and the bumped envelope
version. The scalar-list machinery threaded through this release is internal — no
authoring path emits a list storage column yet, so extension contracts and runtime
behaviour are unchanged. No extension-author API or surface change. Incidental
substrate diff only.
-->

<!--
PR #894 (postgres-rls slice 2, schema-node-tree-restructure): restructures the
schema-diff node tree, splits `db verify` into per-space contract-satisfaction
plus one unclaimed-elements list, and moves plan/verify scoping into the
aggregate orchestration. The only `packages/3-extensions/` touches are test
files: `pgvector/test/migrations/planner.*.test.ts` (planner fixtures rebuilt
for the schema-node tree) and `supabase/test/classification.e2e.test.ts`
(comment wording). The renamed internals (`AggregateContractSpace`,
`combineVerifyResults`, the planner keep-predicate) are migration-tools/CLI
internals with no references in any extension source. No extension-author API
changed; no extension-author action. Incidental substrate diff only.
-->

<!--
Exercise Mongo enums in retail-store (this PR): the `MongoClient` facade gains two
additive members — `raw` (MongoRawClient) and `execute<Row>(plan)` (direct query
execution without going through `runtime()`). Both additive; existing extension code
is unaffected. No extension-author action required. Incidental substrate diff only.
-->

<!--
TML-2955 (expose the static ExecutionContext symmetrically): the built-in target
facades gain a client-safe `@internal/{mongo,postgres,sqlite}/static` entrypoint
(`<target>Static`) and expose `db.context` / `db.contract`. Internally, the mongo
adapter codec now imports `ObjectId` from `bson` instead of `mongodb` so the static
`ExecutionContext` is genuinely driver-free (client-bundle-safe). All additive /
internal — no extension-author API or surface change; existing extensions are
unaffected. No extension-author action required. Incidental substrate diff only.
-->

<!--
TML-2503 (extension-supabase slice D): `@internal/extension-supabase` gains a
secondary `.supabase` admin root on `asServiceRole()` — new `ServiceRoleDb` /
`SupabaseInternalDb` exports from `/runtime`, backed by the extension contract's own
execution context plus a second runtime sharing the app pool + `service_role` session.
Purely additive for extension authors — no other extension's API is affected, and no
released surface changed (the `WithExtensionNamespaces` export existed only on this
branch's earlier, unmerged merge-design revision and was removed before merge). No
extension-author API change. Incidental substrate diff only.
-->

<!--
TML-2892 (migration-author ContractView): the `unboundNamespace` helper that the
SQLite and Mongo runtimes use to unwrap their single default namespace was lifted
into the shared foundation (`@internal/framework-components/ir`); the two
extension runtimes (`packages/3-extensions/{mongo,sqlite}/src/runtime`) now import
it from there instead of defining a local copy. Behaviour-preserving — the runtime
facade surface (`db.enums`, `sql`, `orm`) is byte-identical. No extension-author
API or surface change; nothing to migrate. Incidental substrate diff only.
-->

<!--
TML-2915 (infer an enum's `@@type` from its members): a PSL `enum` block may now
omit `@@type` and have the codec inferred (text for bare/string members, int for
integers). Additive: the framework gains an optional `AuthoringEntityContext.enumInferenceCodecs`
and a `resolveEnumCodecId` export; each built-in target's config supplies its default
codec ids, and `@internal/adapter-mongo` gains a `./codec-ids` entrypoint. Explicit
`@@type` is unchanged. No extension-author action required — the new context field is
optional and framework-populated. Incidental substrate diff only.
-->

<!--
TML-2912 (PSL native scalar lists, end-to-end): PSL now lowers scalar-list fields
(`String[]`, `Int[]`, …) to native array storage columns instead of the JSONB
fallback, gated on the adapter-reported `scalarList` capability. The review-round
follow-up also makes the adapter capability matrix required end-to-end on the
contract-source seam — `ContractSourceContext.capabilities`,
`InterpretPslDocumentToSqlContractInput`, and the SQL PSL resolution inputs are no
longer optional. These are framework-internal contract-emission types that the
control stack always populates; extension authors do not construct them. The only
`packages/3-extensions/` touch is a one-line test-context update in
`postgres/test/psl-namespace-qualifier-routing.test.ts` (threading the now-required
`capabilities` field). No extension-author API changed — re-emit absorbs the
scalar-list contract shape. No extension-author action required. Incidental
substrate diff only.
-->

<!--
Postgres-RLS slice 2.5 (one-differ-two-ir-planner, the cutover to
`plan(start, end)`): the migration planner now diffs two derived schema IRs
via the generic node differ instead of the coordinate-based relational walk.
The only `packages/3-extensions/` touch is a fixture fix in
`pgvector/test/migrations/{planner.behavior,planner.contract-to-schema-ir}.test.ts`
— the hand-built `PostgresTableSchemaNode` foreign-key fixtures now stamp
`resolvedReferencedSchema` (the differ pairs FK nodes by id, which folds in
that field; an unresolved FK on a hand-built actual node no longer paired with
the derived expected side). Test-fixture-only; no extension-author API
changed. See the `sql-migration-planner-keep-diff-issue-to-ownership-oracle`,
`family-sql-collect-sql-schema-issues-removed`,
`sql-control-target-descriptor-diff-database-schema-removed`,
`migration-tools-aggregate-strategy-rename`,
`target-postgres-diff-postgres-database-schema-removed`,
`schema-issue-vocabulary-retired`, `schema-finding-lists-single-list`, and
`codec-verify-type-hook-returns-schema-diff-issue` entries above for the real
breaking changes this slice makes to the framework SPI.

TML-2976 (native Postgres enums, external Supabase types — this PR): the
`packages/3-extensions/` diff is additive. `@internal/extension-postgres` gains a
`db.nativeEnums` accessor (new `src/runtime/native-enums.ts`; `runtime/postgres.ts`,
`exports/runtime.ts`, and `static/postgres-static.ts` expose it) — a Postgres-only
sibling of `db.enums` for reading external native enum columns.
`@internal/extension-supabase` gains the same accessor and regenerates its bundled
contract (`src/contract/contract.{prisma,json,d.ts}`) to carry the `auth.aal_level`
native enum. A new `sql-orm-client` type test
(`test/native-enum.field-output.test-d.ts`) pins native-enum field-output typing.
All additive — the existing extension-author SPI is unchanged, and re-emit absorbs the
contract shape. No extension-author action required. Incidental substrate diff only.

TML-2962 (extension-aware contract infer, PR #919): `contract infer` now omits DB
elements a stack extension pack's contract space already describes, and resolves an
app table's foreign key into pack-owned space to the qualified cross-space relation
(`<spaceId>:<namespace>.<Model>`, e.g. `supabase:auth.AuthUser`) rather than a bare
local reference. The only `packages/3-extensions/` touch is the `supabase` package
gaining an `infer-cross-space-fk.integration.test.ts` and a `@internal/psl-printer`
devDependency for it — no extension-author API changed. One new behavior worth noting
for pack authors: a pack that declares a table's storage coordinate but no domain
model mapped to it now makes `contract infer` throw (malformed pack); packs normally
ship storage + domain together, so no action for well-formed packs. No extension-author
action required. Incidental substrate diff only.

TML-2965 (native-enum-ts-authoring): a native Postgres enum + `pg.enum` column is now
authorable in the TypeScript DSL, producing a contract byte-identical to the PSL
`native_enum` equivalent (including in a non-`public` schema). The `packages/3-extensions/`
diff is additive: `@internal/extension-postgres` gains `src/contract/native-enum.ts` —
`nativeEnum(name, ...values)` returns a handle whose entity name is `name` and whose
Postgres type name defaults to `name`; chain `.map(typeName)` to override the Postgres
type name only. A column binds the handle through `field.column(pg.enum(handle))` (the
deferred column descriptor resolved at contract-build time). The module exports
`nativeEnum` / `pg` / `NativeEnumHandle` from `src/exports/contract-builder.ts`;
`package.json` gains
`@internal/emitter` and `@internal/sql-contract-emitter` devDependencies for the
new test's `.d.ts` emission assertion. All net-new exports — nothing existing was
changed or removed. No extension-author action required. Incidental substrate diff only.
-->

<!--
TML-2960 (no-emit native-enum column typing): a `field.column(pg.enum(handle))`
column now types as its member-value literal union in `typeof contract` (the
no-emit path), matching what the emit path already produced. The
`packages/3-extensions/` diff is the feature itself plus its type test:
`postgres/src/contract/native-enum.ts` makes `pg.enum()` generic over the
handle's members (returning a descriptor whose `entityRef.entity` is
`PostgresNativeEnum<Members>`), and
`postgres/test/contract-builder/native-enum-typeof.test-d.ts` pins the
resulting `typeof contract` types. Runtime values and emitted
`contract.{json,d.ts}` are byte-identical. The extension-author-facing type
reshape this rides on (`ScalarFieldState`'s first generic) is recorded in the
`scalar-field-state-descriptor-generic` entry above; beyond that, no
extension-author action. Incidental substrate diff only.
-->

<!--
TML-2828 (variant relations on the narrowed accessor, PR #933): the
`packages/3-extensions/` diff is confined to `@internal/sql-orm-client` (itself an
extension). The `.variant('X')`-narrowed predicate accessor now surfaces relations the
variant model declares in the contract, alongside the base model's relations —
`createModelAccessor` resolves a variant-owned relation against the variant's
coordinates (variant table for MTI, base table for STI), and
`VariantAwareModelAccessor` intersects in the variant's relation accessors so
`t.variant('Feature').where(x => x.assignee.some(…))` type-checks and plans a correct
EXISTS. Purely additive to the ORM client's query surface; no extension-author SPI
(`@internal/contract`, `@internal/framework-components`, …) changed. No
extension-author action required. Incidental substrate diff only.
-->

<!--
TML-2883 (rls-ts-authoring): Postgres RLS is now authorable in the TypeScript DSL,
producing contracts wire-name-identical to the PSL `policy_*` / `@@rls` equivalents.
The `packages/3-extensions/` diff is additive: `@internal/postgres` gains
`src/contract/rls.ts` (frozen branded handles from `policySelect` / `policyInsert` /
`policyUpdate` / `policyDelete` / `policyAll` / `rlsEnabled(model)` / `role(name)`;
predicates are opaque strings); its `defineContract` accepts an optional
`entities?: readonly RlsEntityHandle[]` input. The lowering is target-side: the
generic contract build groups `entities` handles by the pack that registered each
`entityKind` and calls the pack's batch hook (`lowerEntityHandles`, a SQL-family
contributions extension exported from
`@internal/sql-contract/entity-handle-lowering-hook`), which target-postgres
implements beside its PSL lowering. A TS-declared `role(name)` lands in
`entries.role` under the `__unbound__` namespace, identical to a PSL `role` block
(roles are cluster-scoped). `@internal/extension-supabase` gains `anon` /
`authenticated` role-handle exports from `/contract`. Supporting additive exports
only elsewhere: `buildContractDefinition` from
`@internal/sql-contract-ts/contract-builder`; `formatRlsPolicyWireName` +
`POLICY_OPERATION_PREDICATES` from `@internal/target-postgres/rls-canonicalize`.
`entities` is the sole public channel for attaching pack entities; the internal
`packEntities` input never had a real author and was removed (test-only, never
documented as user-facing), so no extension-author action is required. Incidental
substrate diff only.
-->

<!--
Dependabot runtime-deps group bump (PR #962): the packages/3-extensions/
diff is package.json dependency version ranges only (arktype ^2.2.2 /
~2.2.2). No extension-facing API, contract shape, or emitted artefact
changes. No user action required. Incidental substrate diff only.
-->

<!--
pg binding resolution by structure, not instanceof (PR #969): the
`packages/3-extensions/` diff is a bug fix plus additive exports. The postgres
extension (`@internal/postgres`) gains two net-new `/runtime` exports —
`isPgPool` / `isPgClient`, structural type guards that identify a `pg`
Pool/Client by shape instead of `instanceof`. `resolvePostgresBinding` and the
`@internal/extension-supabase` `toPool` helper now use them, so a
caller-supplied pool that came from a duplicated `pg` copy in an app bundle
resolves correctly instead of throwing `Unable to determine pg binding type`
at boot. The change only accepts inputs the old `instanceof` check rejected —
nothing that resolved before resolves differently — and the two guards are
additive. No extension-author action required. Incidental substrate diff only.
-->

<!--
TML-2980 (variant-declared SQL ORM includes, PR #976): the `packages/3-extensions/` diff fixes the existing `.variant().include()` API inside `@internal/sql-orm-client` so singleton variant narrowing can include relations declared by that variant, with union-valued narrowing rejecting shadowed ambiguous names. Mutation `RETURNING` rows now also map variant-owned physical columns back to their domain field names, matching reads and the existing static row type. No extension-author SPI, contract shape, syntax, or configuration changed, and existing consumers need no code migration. Incidental substrate diff only.
-->

<!--
postgres-rls project close-out (PR #979): the packages/3-extensions/ diff is
one documentation link in the supabase README — the RLS pointer into the
now-deleted projects/postgres-rls/ directory re-pointed at the promoted
ADR 234 and the Adapters & Targets subsystem doc, with the surface names
updated to the shipped forms. No code, API, contract shape, or emitted
artefact changes. No extension-author action required. Incidental docs-only
diff.
-->

<!--
PR #915 (middleware doc-comment lifecycle fixes): comments-only. The only
`packages/3-extensions/` touch is doc comments in
`packages/3-extensions/middleware-cache/src/cache-middleware.ts`, correcting
stale claims about the cache-hit lifecycle (a hit skips only the driver call
and per-row `onRow` hooks; `beforeExecute` has already run, `afterExecute`
still fires; `decodeRow` still runs). No SPI or behavioural change.
No user action required. Incidental substrate diff only.
-->
