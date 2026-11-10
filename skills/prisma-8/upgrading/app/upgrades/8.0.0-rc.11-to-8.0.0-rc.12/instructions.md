---
from: "8.0.0-rc.11"
to: "8.0.0-rc.12"
# The Prisma 7 contract source adds `prisma7Schema` and the `examples/prisma7-adoption` example.
# The surface itself is new, so there is nothing to translate for it; the entries below cover the
# changes it made to paths every Postgres project already uses.
# contract.d.ts now orders every collection the way contract.json does; a re-emit reorders, nothing else.
changes:
  - id: define-config-becomes-define-prisma-config
    summary: |
      Rename the engine config marker import in `prisma.config.ts` from `defineConfig` to
      `definePrismaConfig`. Required: `@prisma/cli-engine@0.6.1` no longer exports the deprecated
      `defineConfig` alias.
    detection:
      glob: "**/prisma.config.ts"
      contains:
        - "import { defineConfig } from '@prisma/cli-engine'"
  - id: engine-pin-moves-to-0-6-1
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.6.1` (up from 0.4.0). A project that pins `@prisma/cli-engine` itself must move the pin to `0.6.1`. The engine no longer exports the deprecated `defineConfig` alias, so `prisma.config.ts` must import `definePrismaConfig`.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.4.0"'
  - id: config-paths-resolve-from-declaring-file
    summary: |
      A relative path in `prisma.config.ts` now resolves from the directory of the config file that wrote it, not from the working directory. Commands run from the config file's directory behave as before. The engine also discovers `prisma.config.ts` files up to the repository root and merges them, with the nearest file's values winning.
  - id: psl-schema-requires-use-prisma-8-directive
    summary: |
      `prisma contract emit` now refuses to load a PSL schema file that does not carry
      `// use prisma-8` as its first line, failing with `PSL_NO_OPTED_IN_SCHEMA_FILES`. Add the
      directive to every PSL schema file your `contract.source.inputs` matches.
    detection:
      glob: "**/*.prisma"
      regex:
        - '^(?!\s*// *use +(?:prisma-8|prisma-next)(?: *)(?!\S))'
    script: ./scripts/multifile-psl/add-use-prisma-8-directive.mjs
  - id: psl-model-names-table-verbatim
    summary: |
      A PSL `model` with no `@@map` now names its table (or Mongo collection) after the model
      verbatim: `model UserProfile` maps to `"UserProfile"`, where it used to map to `"userProfile"`.
      Run the colocated codemod over every `.prisma` file, including the `contract.prisma` copies
      under `migrations/`, so each unmapped model gets `@@map("<current table name>")` and keeps the
      table it already has. Emitted contracts, storage hashes, and migration history are unchanged
      after the codemod. Planning without it fails with `MIGRATION.TABLE_NAME_CASE_CHANGED`
      instead of dropping and recreating the table.
    detection:
      glob: "**/*.prisma"
      regex:
        - '\bmodel\s+[A-Za-z_][A-Za-z0-9_]*\s*\{'
    script: ./scripts/psl-verbatim-table-names/add-model-map.mjs
  - id: contract-infer-prints-emittable-defaults
    summary: |
      `contract infer` now prints each column default in the form `contract emit` accepts: an unquoted number with every digit for `Decimal` and `Numeric`, plain digits for a large `BigInt`, and a `sql` tagged literal for a list default holding a `NULL` element.
  - id: infer-prints-a-literal-where-it-printed-dbgenerated
    summary: |
      `prisma contract infer` now prints a default as a literal wherever it can read the literal
      back as the stored value, including forms it used to print as `dbgenerated("...")`. Re-running
      infer produces different schema text for the same database. Nothing to fix; review the diff.
    detection:
      glob: "**/*.prisma"
      contains:
        - "dbgenerated("
  - id: dbgenerated-removed-from-psl
    summary: |
      `@default(dbgenerated("..."))` is removed from PSL. `contract emit` refuses it with
      `PSL_UNKNOWN_DEFAULT_FUNCTION`. Write a raw SQL default as the `sql` tagged literal, and a
      value the column's data type writes as that literal.
    detection:
      glob: "**/*.prisma"
      contains:
        - "dbgenerated("
  - id: default-sql-method-deprecated
    summary: |
      `.defaultSql('...')` on the TypeScript contract builder is deprecated and is removed at
      8.0.0. Rewrite each call to `.default(...)` with `now()`, `autoincrement()`, or the `sql`
      template tag.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.defaultSql\('
  - id: a-json-default-is-a-json-tag
    summary: |
      A `Json` or `Jsonb` column's default is written ``@default(json`{ "a": 1 }`)``. A quoted
      string is refused: `pg/jsonb` casts from `pg/json`, not from `pg/text`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(Jsonb|Json)(\[\])?\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([\s\[]*"'
  - id: a-decimal-default-is-written-unquoted
    summary: |
      A `Decimal` or `Numeric` column's default is written as a number, not as a quoted string:
      `@default(1.50)`. Trailing zeros are kept.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(Decimal|Numeric)(\([^)]*\))?(\[\])?\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([\s\[]*"'
  - id: a-float-non-finite-default-is-written-bare
    summary: |
      A `Float` or `Real` column's default is written as a number, and `NaN`, `Infinity` and
      `-Infinity` are written bare: `@default(NaN)`, not `@default("NaN")`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(Float|Real)(\[\])?\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([\s\[]*"'
  - id: a-json-list-default-is-one-json-literal
    summary: |
      A written list on a `Json` or `Jsonb` column that holds one value is refused. A JSON list
      default is one JSON document: ``@default(json`[1, 2]`)``.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(Jsonb|Json)\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([ \t]*\['
  - id: psl-number-defaults-keep-digits
    summary: |
      A PSL number `@default` on a `Decimal` or `Numeric` column now emits as decimal text with every digit (`"10"`, `"1.50"`) instead of a JSON number. Re-emitting such a contract changes its storage hash, so re-sign databases signed with the old contract. `BigInt` and `UnboundedInt` defaults beyond 2^53 now emit, and `contract infer` prints such `BigInt` defaults as plain numbers.
    detection:
      glob: "**/*.prisma"
      regex:
        - '@default\(\[?-?(\d|NaN|Infinity)'
  - id: number-valued-64-bit-columns-store-their-default-as-digit-text
    summary: |
      This flags every contract that holds a `pg/int8number@1` or `sqlite/bigintnumber@1` column.
      Only those columns that carry a literal default change form: the default is digit text now,
      where it was a JSON number. A column with no default, or with a function default, is
      unaffected. For an affected contract, re-run `prisma contract emit`, then `prisma db sign`.
    detection:
      glob: "**/contract.json"
      contains:
        - '"codecId": "pg/int8number@1"'
        - '"codecId": "sqlite/bigintnumber@1"'
  - id: client-generated-created-at-presets
    summary: Re-emit contracts using creation timestamp presets and migrate their removed database defaults.
  - id: re-emit-the-contract-for-the-moved-query-operation-types
    summary: |
      Emitted Postgres `contract.d.ts` files import `QueryOperationTypes` from the target package
      instead of the adapter. Run `prisma contract emit` once; an un-emitted contract names a
      subpath that no longer exists and stops type-checking. Application source that imported that
      subpath directly changes the same way.
    detection:
      # Covers the emitted `contract.d.ts` and hand-written source alike: both
      # name the subpath, and both stop compiling until they are changed.
      glob: "**/*.{ts,tsx,mts}"
      contains:
        - "/adapter/operation-types"
  - id: native-enum-columns-have-no-text-operations
    summary: |
      A native Postgres enum column (`pg.enum(...)`) no longer offers `like`, `ilike`,
      `fullTextMatches`, `fullTextRank` or `fullTextHeadline`, is no longer accepted as the text of
      a tsquery parser, and cannot carry `@@fullTextIndex` or `fullTextIndex`. These calls used to
      compile and then fail in Postgres. Now they fail to compile.
  - id: re-emit-for-the-insert-conflict-skip-capabilities
    summary: "The Postgres and SQLite adapters report two new capability keys, sql.insertOnConflictSkip and sql.insertOnConflictWithoutTarget, which the new createAll/createAndCount option { onConflict: 'skip' } requires; a contract emitted before this release does not carry them and the option is refused against it, so re-emit the contract before using it."
    detection:
      glob: "**/contract.json"
      contains:
        - '"defaultInInsert"'
  - id: params-only-sql-facade-prepare
    summary: Replace injected SQL-builder preparation callbacks with params-only callbacks and lexical facade SQL access.
  - id: postgres-target-owned-list-framing
    summary: |
      PostgreSQL list result decoding is target-owned; direct driver reads now expose raw array literals, and fixed-scale numeric arrays return database-normalized decimal text such as `"1.5000000000"`.
  - id: postgres-verify-reads-more-default-spellings
    summary: |
      `db verify` now reads negative and cast numerals, enum literals cast to a type in another schema, zoneless `timestamp` literals, and `ARRAY[...]` list defaults as the values they are. Columns previously reported as drift verify clean; no contract or database change is needed.
  - id: postgres-introspection-pinned-session
    summary: |
      Introspection now reads defaults, check constraints, index predicates, and policy text with `TimeZone = UTC`, `DateStyle = ISO, MDY`, and `IntervalStyle = postgres`, restoring the caller's settings. A contract inferred earlier from a server outside UTC that holds a `timestamptz` constant in such text shows that text once as a difference.
  - id: source-load-failure-carries-diagnostics
    summary: |
      A contract source that fails to load now reports each finding in a `diagnostics` array on `CONTRACT.SOURCE_LOAD_FAILED`, alongside the existing `meta.diagnostics` and `meta.issues`.
  - id: migration-new-defaults-to-the-db-ref
    summary: |
      Without `--from`, `migration new` now starts from the `db` ref, or from an empty database when there are no migrations, instead of from the newest migration. With migrations on disk and no `db` ref it refuses with `MIGRATION.PLAN_ORIGIN_UNKNOWN`. Scripts that relied on the old default must pass `--from`.
    detection:
      glob: "**/{package.json,*.sh,*.yml,*.yaml}"
      contains:
        - "migration new"
  - id: migration-tip-error-codes-removed
    summary: |
      `MIGRATION.AMBIGUOUS_TARGET`, `MIGRATION.NO_TARGET` and `MIGRATION.NO_INITIAL_MIGRATION` are removed, and `graphTip` / `graphTipHash` are gone from error `meta`. A migration history with two branches now reports the real error, such as `MIGRATION.HASH_NOT_IN_GRAPH`.
    detection:
      glob: "**/*.{ts,tsx,js,mjs,cjs}"
      matches:
        - 'AMBIGUOUS_TARGET|NO_TARGET|NO_INITIAL_MIGRATION|graphTip'
  - id: contract-artifacts-restamp
    summary: |
      The emitted `contract.json` / `contract.d.ts` embed the toolchain version, which moves
      to 8.0.0-rc.12. Run `contract emit` once after upgrading so the emitted artifacts match
      the installed toolchain.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.11"'
---

# 8.0.0-rc.11 → 8.0.0-rc.12 — User upgrade instructions

## `define-config-becomes-define-prisma-config`

For every `prisma.config.ts` matched by `detection`, rename the engine import and its call site from `defineConfig` to `definePrismaConfig`:

```ts
// before
import { defineConfig } from '@prisma/cli-engine';
export default defineConfig({ ... });

// after
import { definePrismaConfig } from '@prisma/cli-engine';
export default definePrismaConfig({ ... });
```

`definePrismaConfig` has been the engine's name for the marker since `@prisma/cli-engine@0.2.0`. `defineConfig` was a deprecated alias, and `@prisma/cli-engine@0.6.1` removes it, so this rename is required before the engine pin moves (`engine-pin-moves-to-0-6-1`, next). Leave any `defineConfig` imported from a product package (for example `@prisma/orm-postgres/config`) untouched — those helpers keep their name. The engine function's behaviour is identical; only the name changes.

## `engine-pin-moves-to-0-6-1`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.4.0` to `0.6.1` and reinstall. Projects assembled by the `prisma` CLI resolve the engine automatically.

The engine removed the deprecated `defineConfig` alias. If `prisma.config.ts` still imports `defineConfig` from `@prisma/cli-engine`, apply `define-config-becomes-define-prisma-config` (the previous entry) in the same upgrade.

## `config-paths-resolve-from-declaring-file`

No change is needed for a project that runs commands from the directory holding its `prisma.config.ts`. A script that runs `prisma ... --config <path>` from another directory and relied on relative paths resolving from the working directory must drop that workaround: `contract`, `contract.output`, and `migrations.dir` now resolve from the config file's own directory.

A project inside a repository whose root, or any directory between the root and the project, holds another `prisma.config.ts` now inherits that file's values for any key the project's own config does not set. If the project must not inherit from a parent config, add `parent: false` to the project's own `prisma.config.ts`, which stops the search at that file, or remove the stray parent config.

## `psl-schema-requires-use-prisma-8-directive`

Every PSL schema file `prisma contract emit` reads must now carry `// use prisma-8` as its literal first line (before any other comment or whitespace beyond leading blank lines). A file a configured glob matches but that lacks the directive is silently excluded from the emitted contract; if excluding it would leave zero opted-in files, emission fails outright:

```
CONTRACT.SOURCE_LOAD_FAILED
  why: No schema file carries the "// use prisma-8" directive
  PSL_NO_OPTED_IN_SCHEMA_FILES: None of the matched files carry the "// use prisma-8" directive: <path>
```

From the project root, run the codemod that sits next to this guide over every PSL schema file `contract.source.inputs` names (a plain path or a glob). `<skill>` is the directory of the synced `prisma-8` skill:

```bash
node <skill>/upgrading/app/upgrades/8.0.0-rc.11-to-8.0.0-rc.12/scripts/multifile-psl/add-use-prisma-8-directive.mjs 'prisma/**/*.prisma'
```

It inserts `// use prisma-8` followed by a blank line at the top of every matched file that lacks the directive (or its earlier `// use prisma-next` spelling); a file that already carries either form is left untouched, so running it twice is a no-op. This is the same directive `orm init` already scaffolds into a fresh project.

The directive is content, not configuration: it does not change `contract.source.inputs`, the emitted `contract.json`, or any migration history. Re-run `prisma contract emit` afterward to confirm the schema loads.

## `psl-model-names-table-verbatim`

A PSL `model` with no `@@map` used to name its table, or its Mongo collection, after the model with the first letter lowered: `model UserProfile` read and wrote `"userProfile"`. It now uses the model name verbatim, `"UserProfile"`, the same rule every other Prisma 8 authoring surface already followed. Every model without `@@map` therefore points at a table that does not exist yet, so the schema must say which table it means.

From the project root, run the codemod that sits next to this guide once over every schema file, including the `contract.prisma` copy inside each migration directory. `<skill>` is the directory of the synced `prisma-8` skill. The script exits with an error if no file matches:

```bash
node <skill>/upgrading/app/upgrades/8.0.0-rc.11-to-8.0.0-rc.12/scripts/psl-verbatim-table-names/add-model-map.mjs '**/*.prisma'
```

It adds `@@map("<model name with its first letter lowered>")` as the last line of every `model` block that has no `@@map`, keeps the file's indentation and line endings, leaves models that already have `@@map` alone, and leaves a variant with `@@base(...)` and no `@@map` alone because it shares its base's table. It never descends into `node_modules` or `dist`, prints every model it mapped as `<file>: model <Name> -> @@map("<name>")`, and is idempotent. If a `model` block is written in a shape it cannot read it prints `<file>:<line>: model block not understood` and exits 1; add the `@@map` to that block by hand.

The codemod cannot see storage. It is for schemas written against the previous release only, where every unmapped model's table was created with its first letter lowered. Run it once, before you re-run `contract infer`, and never on a schema that was inferred or written after upgrading: such a schema already names its tables verbatim, and the codemod would point each unmapped model at a lowercase table that does not exist. Read the printed list and remove the `@@map` from any model whose table already has the verbatim name.

Then run the project's emit command (`prisma contract emit`, or its `contract:emit` script) and check that `contract.json` did not change; `prisma db verify --schema-only` against the database must also be clean. An unchanged `contract.json` proves the codemod was run on the right schema: if it changed, or verify reports the lowercase tables as missing, the schema was already verbatim, so revert the codemod's edits. Storage hashes, migration history, and refs are unchanged after a correct run, so no `db sign`, migration, or data move is needed.

In this upgrade, other entries in this guide also change `contract.json` (the `version` stamp, and the defaults some later entries name). Emit also fails while the schema still holds a form this release refuses, such as `dbgenerated(...)`, until a later entry rewrites it. In either case, run this check after those entries, and compare the table names in `contract.json` rather than the whole file.

If you plan a migration (`prisma migration plan`, `prisma db update`, `prisma migrate`) without running the codemod, planning fails instead of dropping the table:

```text
✘ [MIGRATION.PLANNING_FAILED] Migration planning failed
  why: MIGRATION.TABLE_NAME_CASE_CHANGED: table "UserProfile" would be created and table "userProfile" dropped. Prisma 8 changed the default table name: a model with no @@map now names its table verbatim, so model UserProfile points at "UserProfile" instead of "userProfile".
→ To keep table "userProfile" and its rows, add @@map("userProfile") to model UserProfile (or run the add-model-map codemod over the schema) and plan again. Prisma 8 has no rename-table operation, so a deliberate rename is done by hand: run ALTER TABLE "userProfile" RENAME TO "UserProfile" (schema-qualified where applicable), after which the plan is empty.
```

The conflict fires for each pair where the table to drop equals the table to create with its first letter lowered, in the same namespace, whatever the columns. It does not fire on an empty database or on tables the contract's control policy marks `external` or `observed`. Mongo has no planner and gives no error: an unmapped model silently reads and writes an empty `UserProfile` collection while the documents stay in `userProfile`, so run the codemod before deploying.

To adopt the verbatim names on purpose instead of mapping, rename the storage by hand and skip the codemod for those models. Postgres and SQLite: `ALTER TABLE "userProfile" RENAME TO "UserProfile"` (`ALTER TABLE "auth"."userProfile" RENAME TO "UserProfile"` inside a schema). Mongo: `db.userProfile.renameCollection("UserProfile")`. After the rename the migration plan is empty and `db verify` is clean.

`contract infer` follows the same rule: a table whose name already equals the model name (`"UserProfile"`, `"User"`) infers to a model with no `@@map` and verifies clean, where the previous output pointed the model at a lowercase table that did not exist. A snake_case table still infers with `@@map("user_profile")`. There is nothing to detect for this: the inferred text for such a table is the same as before, it is now correct.

## `contract-infer-prints-emittable-defaults`

No edit to an existing contract. This changes what `prisma contract infer` writes the next time you run it.

Each default is now printed in the form `contract emit` reads back, so an inferred `contract.prisma` emits without hand-editing:

- a `Decimal` or `Numeric` default is printed as an unquoted number that keeps every digit (`@default(1.50)`); a quoted form is refused, as `a-decimal-default-is-written-unquoted` describes;
- a `BigInt` default beyond ±(2^53 − 1) is printed as its digits instead of `dbgenerated(...)`;
- `NaN`, `Infinity` and `-Infinity` are printed bare (`@default(NaN)`), as `a-float-non-finite-default-is-written-bare` describes;
- a list default holding a `NULL` element is printed as `` @default(sql`<expression>`) `` (`dbgenerated(...)` is removed in this release; see `dbgenerated-removed-from-psl`), because no PSL list literal spells a null element. Earlier the default was dropped in silence and the column was emitted without it. `contract emit` stops at such a field with a diagnostic; edit the field or drop the default from the inferred file.

If you keep an inferred contract in version control, re-run `contract infer`, review the diff for these spellings, and re-emit. The stored defaults in the database do not change.

## `infer-prints-a-literal-where-it-printed-dbgenerated`

`prisma contract infer` classifies a stored default with the same rules a written value uses, prints it with the same authoring entry, and reads the text straight back to prove it returns the stored value. A default it can read back is now printed as a literal, including forms it used to print as `dbgenerated("...")` or as a quoted string:

| Column in the database | Before | After |
| --- | --- | --- |
| `jsonb NOT NULL DEFAULT '{}'::jsonb` | `@default(dbgenerated("'{}'::jsonb"))` | ``@default(json`{}`)`` |
| `jsonb DEFAULT 'null'::jsonb` | `@default(dbgenerated("'null'::jsonb"))` | ``@default(json`null`)`` |
| `timestamp(3) NOT NULL DEFAULT '2024-01-01 00:00:00'` | `@default(dbgenerated("'2024-01-01 00:00:00'::timestamp without time zone"))` | `@default("2024-01-01 00:00:00")` |
| `numeric(65,30) DEFAULT -0.5` | `@default("-0.5")` | `@default(-0.5)` |
| `numeric(10,2) NOT NULL DEFAULT 1.50` | `@default("1.50")` | `@default(1.50)` |
| `float8 DEFAULT 'NaN'` | `@default("NaN")` | `@default(NaN)` |
| `timestamp(3)[] DEFAULT ARRAY['2024-01-01 00:00:00'::timestamp(3)]` | `@default(dbgenerated("ARRAY[...]"))` | `@default(["2024-01-01 00:00:00"])` |

This is not a break to fix. The contract is the same; only the schema text differs. Re-run `prisma contract infer`, read the diff, and commit the new text. A default whose value the codec cannot read back, such as `NULL::character varying`, prints as `` @default(sql`<expression>`) `` (`dbgenerated(...)` is removed in this release; see `dbgenerated-removed-from-psl`), so infer never prints a schema that emit cannot read.

## `dbgenerated-removed-from-psl`

`@default(dbgenerated("<expression>"))` no longer parses. Every use is reported at its span as `PSL_UNKNOWN_DEFAULT_FUNCTION` with the message `` Default function "dbgenerated" was removed. Write the SQL as a tagged literal: @default(sql`<expression>`). Supported functions: ... ``. `prisma contract infer` no longer prints it either: a raw expression prints as a `sql` tagged literal, and a value the column's data type writes prints as that literal.

In PSL, a raw SQL column default is written as a tagged literal, ``@default(sql`...`)`` or `@default(sql"...")`. Rewrite each use by what the expression is:

| You wrote | Write instead |
| --- | --- |
| `@default(dbgenerated("gen_random_uuid()"))` | `` @default(sql`gen_random_uuid()`) `` |
| `@default(dbgenerated("now()"))`, `@default(dbgenerated("CURRENT_TIMESTAMP"))` on Postgres | `@default(now())` |
| `@default(dbgenerated("autoincrement()"))`, `@default(dbgenerated("nextval('<seq>'::regclass)"))` on a serial column | `@default(autoincrement())` |
| `@default(dbgenerated("'<json>'::jsonb"))` on a `Json` or `Jsonb` column | `` @default(json`<json>`) `` |
| `@default(dbgenerated("'<member>'::<enum type>"))` on a column typed by that enum | `@default("<member>")` |
| `@default(dbgenerated("'<text>'::text"))` on a text column | `@default("<text>")` |
| `@default(dbgenerated("<anything else>"))` | `` @default(sql`<anything else>`) `` |

The `now()` and `autoincrement()` rows are required, not a matter of style: `` sql`now()` `` and `` sql`autoincrement()` `` are refused with `PSL_INVALID_DEFAULT_SQL`, because Prisma reads those two expressions as its own default functions. Every other expression, including `NOW()` written in capitals, is used exactly as written.

The mechanical rewrite for the last row is `@default(sql"<expression>")` with the argument text copied unchanged: the double-quote fence uses the same escapes as the `dbgenerated("...")` argument, so the contract cannot change. The backtick fence reads better for SQL; to use it, undo the quoted string's escaping (`\"` becomes `"`, `\n` becomes a line break), then write each backtick in the body as `` \` ``. Inside backticks every other backslash is kept as written, `\$` included, because PSL has no escape for `$`, and `${` is ordinary text. A body that contains a backtick is easiest to keep in the double-quote fence.

The JSON and enum rows change the emitted contract: the default becomes `{ kind: 'literal', value }` instead of `{ kind: 'function', expression }`, so the storage hash moves. Run `prisma contract emit`, then `prisma db verify`: the literal compares equal to the live default, so verify passes and no migration is needed. Every other row emits the same contract as before; the storage hash does not move.

Find the uses with `grep -rn "dbgenerated(" prisma/` (or wherever the schema lives).

## `default-sql-method-deprecated`

Rewrite every `.defaultSql('<expression>')` call by its expression:

| Call | Replacement | Import |
| --- | --- | --- |
| `.defaultSql('now()')` | `.default(now())` | `now` from the contract builder |
| `.defaultSql('autoincrement()')` | `.default(autoincrement())` | `autoincrement` from the contract builder |
| `.defaultSql('gen_random_uuid()')` | `` .default(sql`gen_random_uuid()`) `` | `sql` from the contract builder |
| `.defaultSql('<anything else>')` | `` .default(sql`<anything else>`) `` | `sql` from the contract builder |

There is no named helper for other database functions, so they use the `sql` tag, as `gen_random_uuid()` does above. `` sql`now()` `` and `` sql`autoincrement()` `` are refused in the TypeScript `sql` tag as they are in PSL, so those two must use the named form.

Copy the expression's value, not its source string: first undo the TypeScript string's own escaping, so `.defaultSql('it\'s')` contributes `it's`. Then write each backtick as `` \` ``. Write a backslash that precedes a dollar sign as `\\$`, because the tag reads `\$` as the escape for `$`. Every other backslash can be written as it is, or doubled; both give one backslash. An expression that contains `${` is written `\${` inside the `sql` tag, which resolves it back to the two characters; in PSL it is written as it is.

Import the helpers from the module the code already imports `defineContract`, `field`, and `model` from (`@prisma/orm-postgres/contract-builder`, `@prisma/orm-sqlite/contract-builder`, or the internal `@internal/sql-contract-ts/contract-builder`). Every form lowers to the same `{ kind: 'function', expression }` default, so the emitted contract does not change: re-run `prisma contract emit` and confirm the column defaults in `contract.json` are unchanged.

Find the uses with `grep -rn "defaultSql(" src/` (or wherever the contract is defined).

## `a-json-default-is-a-json-tag`

Every value written in PSL now has a data type of its own, decided by what is written rather than by the column. A quoted string is text, and a JSON column's type does not cast from text, so a quoted JSON default is refused with `PSL_DEFAULT_TYPE_INCOMPATIBLE`:

```text
Field "Account.meta": pg/jsonb has no cast from pg/text; it casts from pg/json
```

The `json` tag reads its body as a JSON document, which is what `pg/json` holds, and `pg/jsonb` casts from `pg/json`:

| Before | After |
| --- | --- |
| `meta Jsonb @default("{}")` | ``meta Jsonb @default(json`{}`)`` |
| `meta Jsonb @default("{\"plan\":\"free\"}")` | ``meta Jsonb @default(json`{ "plan": "free" }`)`` |
| `docs Jsonb[] @default(["{}"])` | ``docs Jsonb[] @default([json`{}`])`` |
| `meta Jsonb? @default("null")` | ``meta Jsonb? @default(json`null`)`` |

The body inside the tag is the JSON document itself, so it needs none of the escaping a PSL string needed. The backtick fence resolves `` \` `` and `\\` and nothing else, so `` json`{ "plan": "free" }` `` needs no escaping at all.

A backslash has to survive the fence and then JSON, so a JSON string that holds one backslash is written with four:

| In the schema | After the fence | JSON reads |
| --- | --- | --- |
| ``json`{ "re": "\\\\d+" }` `` | `{ "re": "\\d+" }` | the string `\d+` |

Two backslashes are not enough: the fence turns them into one, and `\d` is not a JSON escape, so the body is refused with `PSL_INVALID_JSON_LITERAL` — as is any other body that is not a JSON document.

## `a-decimal-default-is-written-unquoted`

A written number's data type comes from its own size and precision. Quoted digits are text, and `pg/numeric` does not cast from text:

```text
Field "Account.price": pg/numeric has no cast from pg/text; it casts from pg/int2, pg/int4, pg/int8
```

| Before | After |
| --- | --- |
| `price Decimal @default("1.50")` | `price Decimal @default(1.50)` |
| `price Numeric(10, 2) @default("-1.25")` | `price Numeric(10, 2) @default(-1.25)` |
| `prices Numeric(65, 30)[] @default(["-1.5", "2"])` | `prices Numeric(65, 30)[] @default([-1.5, 2])` |

The stored value does not change. Trailing zeros are kept (`1.50` stays `1.50`), leading zeros are dropped (`007.50` is `7.50`), and `-0.0` is `0.0` — the values these defaults always had.

## `a-float-non-finite-default-is-written-bare`

`NaN`, `Infinity` and `-Infinity` are number tokens in PSL, not identifiers and not text. A `Float` or `Real` column's type casts from the number types, not from text, so the quoted forms are refused with `PSL_DEFAULT_TYPE_INCOMPATIBLE`.

| Before | After |
| --- | --- |
| `ratio Float @default("NaN")` | `ratio Float @default(NaN)` |
| `ratio Float @default("-Infinity")` | `ratio Float @default(-Infinity)` |
| `ratio Real @default("NaN")` | `ratio Real @default(NaN)` |
| `ratios Float[] @default(["-1.5", "2"])` | `ratios Float[] @default([-1.5, 2])` |

## `a-json-list-default-is-one-json-literal`

A written list is several values, and the column takes it only when the column is a list or when the column's data type declares a list cast. `pg/json` and `pg/jsonb` declare none, so a written list on a column that holds one JSON value is refused:

```text
Field "Account.meta": pg/jsonb has no cast from a list; it casts from pg/json
```

A JSON list default is one JSON document, written inside the tag:

| Before | After |
| --- | --- |
| `meta Jsonb @default([1, 2])` | ``meta Jsonb @default(json`[1, 2]`)`` |
| `meta Jsonb @default([])` | ``meta Jsonb @default(json`[]`)`` |

A `Jsonb[]` column is unaffected: it is a list of JSON columns, and each element is written as its own `json` tag — ``docs Jsonb[] @default([json`{}`, json`[]`])``.

## `psl-number-defaults-keep-digits`

In every PSL schema matched by `detection`, look for number defaults on fields typed `Decimal`, `Numeric`, `Numeric(...)`, or a `types {}` alias of one of them, including list fields. If there are none, this entry changes nothing. The schema itself needs no edit.

Before you re-emit: if a database was signed with a contract holding such a default with more digits than a JavaScript number holds (for example `12345678901234567890.123456789`), `db verify` and `db sign` report a default mismatch on that column.

Run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script). In `contract.json`, each such default becomes decimal text: `@default(10)` becomes `"10"`, `@default(1.50)` becomes `"1.50"`, `@default(007)` becomes `"7"`, `@default(-0)` becomes `"0"`, a long value keeps every digit, and `@default(NaN)` becomes `"NaN"` instead of `null`. The storage hash changes. The column default in the database does not, so no migration is needed.

Then run `prisma db sign` against the regenerated contract for every database signed with the old one. Until you do, `db verify` reports a hash mismatch and the application logs `CONTRACT.MARKER_MISMATCH`.

`db init` can now create these defaults; before, it failed with `pg/numeric@1 database JSON value must be a decimal string`. `BigInt` and `UnboundedInt` defaults within ±(2^53 − 1) emit exactly as before. Larger ones now emit instead of failing, and `contract infer` prints such `BigInt` defaults as plain numbers instead of `dbgenerated(...)`.

## `number-valued-64-bit-columns-store-their-default-as-digit-text`

Every codec of one data type now stores and reads that type's one canonical form. `pg/int8` stores digit text, so `pg/int8number@1` — the codec behind `BigIntNumber`, which reads a 64-bit integer as a JavaScript `number` — stores digit text too, where it used to store a JSON number. `sqlite/bigintnumber@1` changed the same way.

The detection flags every contract holding such a column, because a JSON file gives no reliable way to ask for the two facts together. A column is affected only when both are true: its codec is `pg/int8number@1` or `sqlite/bigintnumber@1`, **and** it carries a literal default. A column with no default, or with a function default, is unaffected — read the flagged file and check. In `contract.json` an affected column reads:

```json
"viewCount": {
  "codecId": "pg/int8number@1",
  "default": { "kind": "literal", "value": 10 },
  "nativeType": "int8",
  "nullable": false
}
```

and becomes:

```json
"viewCount": {
  "codecId": "pg/int8number@1",
  "default": { "kind": "literal", "value": "10" },
  "nativeType": "int8",
  "nullable": false
}
```

Re-run `prisma contract emit` to rewrite `contract.json`, then `prisma db sign` so the signature matches the new contract. Nothing in the schema changes, and nothing in the database changes.

No example in this repository has such a column, so a project is affected only if its own contract holds one.

## `client-generated-created-at-presets`

Creation timestamp presets now use the client clock. For schemas using `temporal.createdAt()`, `temporal.createdAtString()`, or `temporal.createdAtJsDate()` (including the matching `field.temporal.*` TypeScript helpers), re-emit the contract with `prisma contract emit`. Review and apply a migration that removes the corresponding database defaults so the database matches the new storage contract. The creation timestamp now uses the same client-side generator as its matching update preset; it is still set only on create.

Update direct SQL writers to supply these required timestamps once their database defaults are removed. If database-generated time is intentional, replace the convenience preset with an explicit timestamp type and `@default(now())` in PSL, or an explicit column with `.default(now())` in TypeScript (`.defaultSql('now()')` is deprecated; see `default-sql-method-deprecated`). Preserve the original native type, precision, and codec representation. Explicit database defaults retain their existing behavior.

For Temporal-backed creation presets, provide a global `Temporal` implementation before writes as well as reads, for example `import 'temporal-polyfill/full/global'` when the runtime lacks native support. String and JavaScript Date presets do not require Temporal for their clock.

## `re-emit-the-contract-for-the-moved-query-operation-types`

The built-in Postgres query operations (`ilike`, and the new `fullTextMatches`, `fullTextRank` and `fullTextHeadline`) are contributed by the Postgres target rather than the Postgres adapter. Emitted contract types follow: the generated line

```ts
import type { QueryOperationTypes as PgAdapterQueryOps } from '@prisma/orm-postgres/adapter/operation-types';
```

becomes

```ts
import type { QueryOperationTypes as PgTargetQueryOps } from '@prisma/orm-postgres/target/operation-types';
```

Run `prisma contract emit` and commit the regenerated `contract.d.ts`. Nothing else in the file changes, `contract.json` does not change, and no contract hash moves. Do not hand-edit the generated file.

Application code that imported `@prisma/orm-postgres/adapter/operation-types` directly imports `@prisma/orm-postgres/target/operation-types` instead. That subpath no longer exists; there is no compatibility re-export.

To use the new operations, index the column with `@@fullTextIndex`, which renders the `to_tsvector` expression the predicate needs:

```prisma
model Message {
  id   Int    @id
  text String

  @@fullTextIndex([text], name: "message_text_search")
}
```

In a TypeScript contract, use the matching helper inside the model's `sql({ indexes: [...] })`:

```ts
import { fullTextIndex } from '@prisma/orm-postgres/contract-builder';

model('Message', { fields: { id, text } }).sql(({ cols }) => ({
  indexes: [
    fullTextIndex(cols.text, { name: 'message_text_search' }),
    fullTextIndex(cols.text, { where: 'archived_at IS NULL', name: 'message_text_search_live' }),
  ],
}));
```

The first argument of each operation is a `tsquery`, built with a helper from `@prisma/orm-postgres/target/full-text`. A bare string is a type error. Use `websearchToTsquery(query)` for search-box text; `plaintoTsquery` requires every word and `phrasetoTsquery` the words in order. In the SQL builder these four parsers are also `fns` members. For user input inside `tsquery` operator syntax, such as a typeahead prefix match, use the `tsquery` tag: `` tsquery`${term}:*` `` quotes each interpolated value as one term, so user input cannot add operators or break the syntax, and Postgres then lowercases and stems the words. A value with several words becomes a phrase: `` tsquery`${'new y'}:*` `` gives `'new':* <-> 'y':*`, so the words must be adjacent and in order, and `:*` applies to each word. Do not put quotes around the interpolation yourself: `` tsquery`'${term}':*` `` is a syntax error for every input. `toTsquery` takes operator syntax the application writes in full; never pass user input to it.

The operations also take an options object as their second argument — `language` for all three, plus `normalization` and `coverDensity` on `fullTextRank` and the `ts_headline` options (`startSel`, `stopSel`, `maxWords`, `minWords`, `highlightAll`) on `fullTextHeadline`:

```ts
import { tsquery, websearchToTsquery } from '@prisma/orm-postgres/target/full-text';

const q = websearchToTsquery(query);
await db.orm.public.Message.select('id', 'text')
  .where((m) => m.text.fullTextMatches(q))
  .orderBy((m) => m.text.fullTextRank(q, { normalization: 32 }).desc())
  .all();

const suggestions = await db.orm.public.Message.select('id', 'text')
  .where((m) => m.text.fullTextMatches(tsquery`${term}:*`))
  .all();
```

The operation's `language` configures only the searched column. The parser or tag takes its own `language` for the query; pass the same value to both.

Postgres only uses a full-text index whose expression is the same `to_tsvector` over the same configuration literal and the same column as the query, so prefer these over writing `@@index(expression: "to_tsvector(…)", type: "gin", …)` by hand. Pass the same `language` to the index and to the operation: a mismatch is silent, and the query falls back to a sequential scan.

## `native-enum-columns-have-no-text-operations`

Postgres has no `LIKE`, `ILIKE` or `to_tsvector` for an enum type. Every one of these calls on a native enum column failed when the query ran, with `operator does not exist` or `function ... does not exist`. A `@@fullTextIndex` on a native enum column failed when the migration ran. So code that uses them never worked. It is now a type error, and `@@fullTextIndex` / `fullTextIndex` on a native enum column is refused when the contract is built (`PSL_FULL_TEXT_INDEX_TEXT_FIELD` in PSL, `CONTRACT.INDEX_INVALID` in TypeScript).

Replace a pattern match on an enum with an equality check on its members:

```ts
// before: failed at runtime
db.orm.public.Ticket.where((t) => t.status.ilike('open%'));
// after
db.orm.public.Ticket.where((t) => t.status.in(['open', 'reopened']));
```

Remove any `@@fullTextIndex` or `fullTextIndex` on a native enum column. If you really need a pattern search over the enum labels, write that query through the raw SQL lane (``db.raw.sql`…` ``) and cast the column to text there, for example `status::text ILIKE $1`.

Nothing else about native enum columns changes: `eq`, `in`, ordering, and `min`/`max` work as before. A PSL `enum` block stored as text (`@@type("pg/text@1")`) is a text column and keeps every text operation.

## `re-emit-for-the-insert-conflict-skip-capabilities`

`createAll` and `createAndCount` on the SQL ORM client take a new option in second position that asks the database to skip rows colliding with a unique constraint:

```ts
const inserted = await db.orm.User.createAll(rows, { onConflict: 'skip' });
const added = await db.orm.User.createAndCount(rows, {
  onConflict: 'skip',
  conflictOn: ['email'],
});
```

The option requires two capability keys that the Postgres and SQLite adapters now report: `sql.insertOnConflictSkip`, and `sql.insertOnConflictWithoutTarget` for the untargeted form. A `contract.json` emitted before this release carries neither, so the ORM refuses the option with `ORM.CAPABILITY_MISSING` before running any statement.

Re-emit your contract to pick up the keys:

```console
prisma contract emit
```

Nothing else changes. The keys are additive, the storage hash does not move, and every existing call — including `createAll(rows, configure)` with the annotation callback in second position — behaves exactly as before. You only need to re-emit if you want to use the new option.

## `params-only-sql-facade-prepare`

Find calls to `prepare(declaration, callback)` on clients created by the Postgres or SQLite facade (`@prisma/orm-postgres/runtime`, `@prisma/orm-sqlite/runtime`, or their `@internal/postgres/runtime` and `@internal/sqlite/runtime` counterparts). Resolve the receiver and callback rather than rewriting every method named `prepare`: native SQLite `database.prepare(sql)` and SQL runtime's existing params-only preparation are different APIs and must remain unchanged.

Change callbacks from `(sql, params) => ...` to `(params) => ...`. Replace references bound to the removed `sql` callback argument with the same facade receiver's lexical `.sql` property. Preserve the params argument's name, declaration, SQL chain, row selection, filters and invocation target/options. For extracted callbacks, capture the same client in the enclosing scope; do not capture an invocation target or evaluate the callback twice. Update explicit callback type annotations to accept only the placeholder-params argument.

```ts
// Before
const query = await db.prepare({ id: 'pg/int4@1' }, (sql, params) =>
  sql.public.users.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
);

// After
const query = await db.prepare({ id: 'pg/int4@1' }, (params) =>
  db.sql.public.users.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
);
```

Apply the same translation to SQLite's flat SQL facade (`sql.users` becomes `db.sql.users`), retaining its existing codec ids. Keep `.query(target, params, options?)` and SQL statistics `.execute(target, params, options?)` calls unchanged. Do not rewrite historical release notes, applied upgrade recipes, generated contracts or tests as part of this source translation.

## `postgres-target-owned-list-framing`

Review application code and snapshots that assert exact PostgreSQL list result spellings. Ordinary Prisma 8 runtime reads still return JavaScript arrays, and builtin and enum lists now use the same raw-text-to-element-codec path. If you assert `Decimal[]` / `numeric[]` strings for fixed-scale columns, update those expectations to PostgreSQL's database-normalized scale: a `numeric(30,10)[]` element inserted as `1.5` reads as `"1.5000000000"`; scalar numeric decoding already follows this text-preserving policy. If you use lower-level Postgres driver direct-query rows, parse raw PostgreSQL array literal strings such as `'{a,b}'` instead of expecting registered builtin arrays to arrive as JavaScript arrays. Do not re-emit contracts solely for this change: codec ids, `typeParams`, and `CodecRef.many` stay unchanged.

## `postgres-verify-reads-more-default-spellings`

No code or schema edit. Run `prisma db verify` once against each Postgres database and read the result.

Postgres prints a column default in spellings the reader did not all recognise. It now reads a negative or cast numeral (`'-1'::integer`, `(5)::smallint`) as the number, an enum literal cast to a type in another schema (`'confidential'::auth.oauth_client_type`) as the enum value, a zoneless `timestamp` literal as that timestamp, and an `ARRAY[...]` default of text, boolean, integer, bigint, float, decimal, timestamp, or enum elements — with the casts Postgres prints, and an empty `VARCHAR(n)[]` — as the list. An element that is an expression or a function call still stays a raw expression.

The effect is one-way: columns that were reported as drift on these spellings now report nothing. No column that verified before starts failing. If a test pins the exact findings `db verify` returns for such a column, remove that expectation rather than adjusting it.

The same rendering is now used when planning a migration, so a list literal default is written with its cast (`ARRAY['1', '-2']::int8[]`). Update snapshots of planned DDL that hold the uncast form.

## `postgres-introspection-pinned-session`

No code or schema edit. This matters only if you have a committed contract that was inferred from a server whose session time zone was not UTC.

Every introspection read now runs with `TimeZone = UTC`, `DateStyle = ISO, MDY`, and `IntervalStyle = postgres`, and the caller's settings are restored afterwards, so the text read back no longer depends on the server, the role, or the caller. Postgres prints a `timestamptz` constant in the session time zone, so a check constraint or index predicate whose text contains one was recorded in that server's zone.

Run `prisma db verify`. If a check constraint or an index predicate is reported as different and the only difference is the time zone written into a `timestamptz` constant, that is this change. Re-emit and re-sign once; the new text is stable from then on. Column defaults are compared as instants where they can be, so most of them are unaffected.

## `source-load-failure-carries-diagnostics`

Only for code or agents that read the CLI's `--json` output.

When a contract source fails to load, `CONTRACT.SOURCE_LOAD_FAILED` now carries a `diagnostics` array: one entry per finding, each with `code`, `summary`, `severity`, and, where the source gave a position, `where.path` and `where.line`. A finding whose source code is dotted (`PSL.PRISMA7_VIEW_UNSUPPORTED`) carries that code directly. A finding whose source code is an undotted legacy code (`PSL_INVALID_DECLARATION`) carries `CONTRACT.SOURCE_DIAGNOSTIC` with the original code in `meta.code` and at the start of the summary.

Nothing is removed: `meta.diagnostics` and `meta.issues` carry what they carried before. Read `diagnostics` in new code, and leave existing readers alone until you want the codes.

## `migration-new-defaults-to-the-db-ref`

`migration new` now picks its starting point the same way `migration plan` does. For every file matched by `detection` that runs `migration new` without `--from`:

- If the project keeps a `db` ref that points at a migration, nothing changes in practice: the command starts there.
- If the project has migrations on disk but no `db` ref, the command now refuses with `MIGRATION.PLAN_ORIGIN_UNKNOWN`. Add `--from <contract hash or ref>` naming the migration to build on; `prisma migration list` shows the hashes.
- If the migration history is empty and a `db` ref exists, the command refuses and points at `migration plan`, which writes the baseline. Run `migration plan` first.

## `migration-tip-error-codes-removed`

The CLI no longer looks for a single newest migration, so the errors that came from that lookup are gone. For every file matched by `detection`, remove handling of `MIGRATION.AMBIGUOUS_TARGET`, `MIGRATION.NO_TARGET` and `MIGRATION.NO_INITIAL_MIGRATION`, and stop reading `graphTip` or `graphTipHash` from an error's `meta`. A command that used to fail with one of those codes on a migration history with two branches now fails with the error that describes the actual problem, for example `MIGRATION.HASH_NOT_IN_GRAPH` for a hash that is not in the history, or `MIGRATION.MARKER_MISMATCH` for a database marker outside it.

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the embedded `version` moving to `8.0.0-rc.12`; any other difference in the emitted files comes from an earlier entry in this guide.
