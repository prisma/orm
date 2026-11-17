---
from: "8.0.0-rc.17"
to: "8.0.0-rc.18"
changes:
  - id: psl-default-namespace-duplicate-declaration
    summary: |
      A declaration at the top level of a PSL schema and one inside `namespace public { … }` (Postgres) now share one set of names. The same name declared both ways is `PSL_DUPLICATE_DECLARATION`, and so is a member of `namespace public { … }` named like a `types { }` binding or a namespace. Remove or rename one.
    detection:
      glob: "**/*.{prisma,psl}"
      matches:
        - '(^|\n)\s*namespace\s+public\s*\{'
  - id: psl-default-namespace-name-is-reserved
    summary: |
      A top-level model, composite type, block or `types { }` binding cannot be named like the target's default namespace: `public` on Postgres; `unbound` or `__unbound__` on SQLite and MongoDB. This also holds for a schema read with `prisma7Schema(...)` or `prisma6Schema(...)`. Rename the declaration.
    detection:
      glob: "**/*.{prisma,psl}"
      matches:
        - '(^|\n)[ \t]*(?!namespace[ \t])[A-Za-z_]\w*[ \t]+(public|unbound|__unbound__)[ \t]*\{'
        - '(^|\n)\s*(public|unbound|__unbound__)\s*=\s*\S'
  - id: raw-sql-is-a-sql-literal
    summary: |
      `@@index(where:)`, `@@index(expression:)`, `@@fullTextIndex(where:)`, `@@check(expression:)` and a policy's `using` and `withCheck` take `sql` literals. A quoted string there is refused with `PSL_VALUE_TYPE_INCOMPATIBLE`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(where|expression)\s*:\s*["'']'
        - '^\s*(using|withCheck)\s*=\s*["'']'
    script: ./scripts/sql-expression-literals-psl/rewrite-sql-strings.mjs
  - id: psl-storage-hash-may-change-once
    summary: |
      A raw SQL text with indentation shared by every line, blank lines at the start or end, a whitespace-only line or CRLF line breaks is stored as its canonical text once it is written as a `sql` literal, which changes the contract's storage hash once. For an index or check named with `map:`, `migration plan` then stops with a conflict and asks for a migration written with `migration new`. For a policy named with `@@map`, `migration plan` writes a migration that drops the policy and creates it again.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(where|expression)\s*:\s*["'']'
        - '^\s*(using|withCheck)\s*=\s*["'']'
  - id: builder-raw-sql-is-a-sql-value
    summary: |
      In a TypeScript contract, `index({ where, expression })`, `check({ expression })`, `fullTextIndex({ where })` and the `using` and `withCheck` of `policySelect`, `policyInsert`, `policyUpdate`, `policyDelete` and `policyAll` take a `sql` value. A string there does not compile. Migration files keep strings.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<!readonly |''function'', )\b(where|expression|using|withCheck)\s*:\s*[''"\x60]'
  - id: sql-tag-interpolates-sql-values
    summary: |
      The `sql` tag interpolates other `sql` values: `` sql`${owner} AND deleted_at IS NULL` ``. Compose predicates this way instead of joining strings.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<!\bsql)\x60\$\{[\w.]+\}\s+(AND|OR)\b'
  - id: sql-tag-error-codes-renamed
    summary: |
      `CONTRACT.DEFAULT_SQL_INTERPOLATION` is renamed `CONTRACT.SQL_EXPRESSION_INTERPOLATION`. A NUL character or an oversize text in a `sql` value is `CONTRACT.SQL_EXPRESSION_INVALID`, not `CONTRACT.DEFAULT_INVALID`. `.default()` raises `CONTRACT.DEFAULT_INVALID` for `` sql`now()` ``, `` sql`autoincrement()` `` and unsafe SQL.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bDEFAULT_SQL_INTERPOLATION\b'
        - '\bCONTRACT\.DEFAULT_INVALID\b'
  - id: ts-storage-hash-may-change-once
    summary: |
      A raw SQL string with indentation shared by every line, blank lines at the start or end, a whitespace-only line or CRLF line breaks is stored as its canonical text once it is written as a `sql` value, which changes the contract's storage hash once.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<!readonly )\b(where|expression|using|withCheck)\s*:\s*(\x60[ \t]*$|[''"\x60][ \t\r\n])'
  - id: infer-notes-defaults-that-do-not-read-back
    summary: |
      `contract infer` writes a column default whose text a `sql` literal cannot write back unchanged and adds a note to the model; `contract print` refuses such a default with `CONTRACT.PRINT_UNSUPPORTED`.
    detection:
      glob: "**/contract.prisma"
      matches:
        - '@default\(\s*sql\x60[^\x60]*$'
        - '@default\(\s*sql"[^"]*\\[rn]'
  - id: re-emit-contracts-with-a-full-text-index
    summary: |
      A full-text index declared before this change is stored in `contract.json` in a new form: an index of type `fullText` over its columns whose `options` hold the weight groups and the language, with no `expression`. Its storage hash and its index name change, so the first migration after upgrading changes the index: `migration plan` renames it, and `db update` drops and recreates it. Re-emit the contract and plan a migration.
    detection:
      glob: "**/*.{prisma,ts,mts}"
      matches:
        - '@@fullTextIndex\s*\('
        - '(?<![\w$.])fullTextIndex\s*\('
  - id: full-text-index-one-field-diagnostic-removed
    summary: |
      `@@fullTextIndex` now takes several fields, so the diagnostic `PSL_FULL_TEXT_INDEX_ONE_FIELD` is gone. Code that asserts it asserts a diagnostic that is never raised.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      matches:
        - '\bPSL_FULL_TEXT_INDEX_ONE_FIELD\b'
  - id: re-emit-contracts-with-polymorphic-models
    summary: |
      A polymorphic base model's `variants` is stored in a new form in `contract.json` and `contract.d.ts`: keyed by discriminator value, each entry naming the variant model and its namespace. A contract in the previous form is rejected with `CONTRACT.VALIDATION_FAILED`. Re-emit the contract, and rewrite `variants` in the contract snapshots under `migrations/snapshots/`.
    detection:
      glob: "**/contract*.json"
      matches:
        - '"variants"\s*:\s*\{\s*"[^"]+"\s*:\s*\{\s*"value"\s*:'
  - id: read-variants-by-discriminator-value
    summary: |
      Code that reads a base model's `variants` from a contract finds the variant model at `variants[<value>].model`, where it used to find the value at `variants[<Model>].value`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])variants(?![\w$])'
  - id: prisma7-ignore-keeps-storage
    summary: |
      A Prisma 7 schema read with `prisma7Schema()` keeps the columns, tables, keys, indexes and foreign keys of `@ignore` fields and `@@ignore` models in the contract's storage, as storage with no model. Ignored objects now meet every rule of the reader, so a schema that loaded only because they were dropped can be refused. A project whose Prisma 7 schema uses `@ignore` or `@@ignore` gets a new storage hash: it emits its contract again and brings each existing database to the new hash, after recording a migration if Prisma 8 already plans its migrations. The detection matches a `.prisma` file that uses `@ignore` or `@@ignore`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@ignore\b'
  - id: mongo-enum-member-written-as-stored
    summary: |
      A Mongo contract now refuses an enum member that its codec stores as a value it reads back differently, with `CONTRACT.ENUM_INVALID` in TypeScript and `PSL_EXTENSION_INVALID_VALUE` in PSL and Prisma 6 schemas. The built-in Mongo codecs store every enum member as written, so only an enum typed by your own codec can be refused. Write each refused member as the message says, or fix the codec so `decodeJson(encodeJson(value))` gives the value back.
  - id: typescript-contract-namespace-keys
    summary: |
      A contract built with `defineContract` from TypeScript now types `contract.domain.namespaces`, `contract.storage.namespaces` and `db.orm` with the same namespace keys the built contract has at runtime, each holding only its own models and tables. Before, any string key typechecked and every namespace listed every model. Code that reads a namespace the contract does not have, or indexes `domain.namespaces` with a `string` variable, now fails to typecheck. ORM rows of such a contract, which were typed `unknown` field by field, now have each field's codec output type, so a cast to a type that disagrees with the codec type now fails with TS2352. The detection matches dot and bracket access to `domain.namespaces`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.domain\.namespaces\b'
        - '\[\s*[''"]domain[''"]\s*\]\s*\[\s*[''"]namespaces[''"]\s*\]'
  - id: model-with-no-fields-has-no-keys
    summary: |
      A model with no fields now has no keys at the type level: reading a property of its row, such as `row.legacy_key`, fails to compile. In an emitted `contract.d.ts`, the fields and output types of such a model change from `Record<string, never>` to `{}`. In the SQL ORM client, writing a key in the create or update input of such a model, such as `create({ legacy_key: 'x' })`, also fails to compile now; before, both the read and the write compiled, for an emitted contract and for a contract built with `defineContract`. In the Mongo ORM, writes behave as before: an emitted contract already rejected such a key, and the update methods now take the type `UpdateInput` (see the next entry).
  - id: generic-update-data-uses-update-input-type
    summary: |
      Code that is generic over the model name and passes a value typed `Partial<DefaultModelRow<Contract, M>>` to `updateAll`, `updateAndCount` or the `update` of `upsert` no longer compiles. Type the value as `ScalarUpdateInput<Contract, M>` from the SQL ORM client (`orm-client` entry point of the SQL facade, such as `@prisma/orm-postgres/orm-client`), or `UpdateInput<Contract, M>` from the Mongo ORM, instead.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'Partial<\s*DefaultModelRow<'
  - id: orm-refuses-names-that-are-not-fields
    summary: |
      The SQL ORM client refuses any name a caller passes that is not a field of the model, or of the variant the collection is narrowed to, with `ORM.FIELD_UNKNOWN`. That covers `where` shorthand and callbacks, `orderBy`, `select`, `distinct`, `distinctOn`, `groupBy`, `cursor`, aggregates, `having`, create, update and upsert data, `conflictOn`, include nested selects and relation filters. A column name that differs from its field name is no longer accepted, and rows no longer carry a column no field maps. `conflictOn` with a name that is not a field raised `ORM.ARGUMENT_INVALID` and now raises `ORM.FIELD_UNKNOWN`. The detection matches a file that names both `conflictOn` and `ORM.ARGUMENT_INVALID`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bconflictOn\b)[\s\S]*\bORM\.ARGUMENT_INVALID\b'
  - id: fragment-is-made-from-the-root-collection
    summary: "The SQL ORM client's collection.fragment(body) refuses a collection with chained calls, such as db.Post.where(...).fragment(body), which used to ignore those calls; chain on the collection directly instead, or define a shared fragment on the model's root collection. A receiver typed by a type parameter, such as this in a custom collection class method, is refused at compile time. The detection matches .fragment( right after a closing parenthesis, as in a chained call, and this.fragment(."
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\)\s*\.fragment\('
        - '\bthis\s*\.fragment\('
  - id: fragment-types-are-renamed
    summary: |
      The SQL ORM client's types `Fragment` and `FieldFragment`, which 8.0.0-rc.17 exports, are renamed to `QueryFragment` and `DeclaredFieldsFragment`. Code still on the 8.0.0-rc.16 names renames `Scope` to `QueryFragment`, `FieldScope` to `DeclaredFieldsFragment` and `ScopeFacts` to `FragmentFacts` directly. `FragmentFacts`, `DeclaredField`, `db.orm.fragment` and `collection.fragment` keep their names. The detection matches `Fragment` and `Scope` only in an import or re-export from an `orm-client` entry, after a namespace import of one, or in an inline `import(...)` type of one, so React's `Fragment` and the SQL builder's `Scope` do not match.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(?:FieldFragment|FieldScope|ScopeFacts)\b'
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\b(?:Fragment|Scope)\b[^}]*\}\s*from\s*[''"]@prisma/[\w-]+/orm-client[''"]'
        - 'import\s+(?:type\s+)?\*\s+as\s+([\w$]+)\s+from\s*[''"]@prisma/[\w-]+/orm-client[''"][\s\S]*\b\1\.(?:Fragment|Scope)\b'
        - 'import\(\s*[''"]@prisma/[\w-]+/orm-client[''"]\s*\)\.(?:Fragment|FieldFragment|Scope|FieldScope)\b'
  - id: unique-criterion-rejects-null
    summary: |
      `UniqueConstraintCriterion` in the SQL ORM client (`@prisma/orm-postgres/orm-client` and the other facades' `orm-client` entries) no longer accepts `null` for a nullable unique column, so the `conflictOn` of `upsert` and the criteria of a relation `connect` or `disconnect` stop compiling when a value is `null` or may be `null`. Pass a non-null value, or handle the null case before the call. The detection matches every `conflictOn`, `.connect(` and `.disconnect(`; leave as they are the calls on other objects, such as `postgres.connect(...)`, and the `conflictOn` of `createAll` and `createAndCount`, which is an array of field names.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bconflictOn\b|\.(?:connect|disconnect)\s*\(|\bUniqueConstraintCriterion\b'
  - id: prepared-all-and-aggregate-need-their-receiver
    summary: |
      On every collection of the SQL ORM client, `prepared.all` and `prepared.aggregate` no longer compile when called without the `prepared` object as their receiver, such as after `const { all } = collection.prepared`. Call them on the `prepared` object. `prepared.first` and `prepared.firstOrThrow` are not affected, and nothing changes at run time.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\{[^}]*\b(?:all|aggregate)\b[^}]*\}\s*=\s*[^;\n]*\.prepared\b'
  - id: native-enums-leave-out-domain-enums
    summary: |
      On Postgres, `db.nativeEnums` now holds only native enum types (`native_enum` blocks and `nativeEnum()`). It used to also hold every domain enum (`enum` blocks and `enumType()`), with its values as stored, such as `['1', '10']` for an enum over `pg/int8`. Read a domain enum through `db.enums`, which holds its values as a query returns them.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.nativeEnums\b'
  - id: middleware-hooks-are-activity-hooks
    summary: |
      The per-statement middleware hooks are replaced. `beforeQuery` and `beforeExecute` become `beforeEncode`; `interceptQuery` and `interceptExecute` become `intercept.onQuery` and `intercept.onExecute`; `afterQuery` and `afterExecute` become `activityEnded` on a statement; `afterTransaction` becomes `activityFinalized` on a statement. `onRow` and `beforeCompile` are unchanged.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(beforeQuery|beforeExecute|interceptQuery|interceptExecute|afterQuery|afterExecute|afterTransaction)\b'
  - id: middleware-context-is-activity-context
    summary: |
      `RuntimeMiddlewareContext` is renamed `ActivityContext`. It gains `parent`, `state(key)` and `inTransaction()`, and loses `planExecutionId`; use `activity.id` instead.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bRuntimeMiddlewareContext\b'
        - '\bplanExecutionId\b'
  - id: after-result-types-removed
    summary: |
      `AfterQueryResult`, `AfterExecuteResult` and `AfterTransactionResult` are removed. Use `ActivityEndedResult` (narrow it with `result.kind === 'statement'` and `result.returns`) and `ActivityFinalizedResult`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bAfter(Query|Execute|Transaction)Result\b'
  - id: aborted-phase-before-encode
    summary: |
      A `RUNTIME.ABORTED` error raised during the middleware stage before encoding reports `details.phase: 'beforeEncode'`, not `'beforeQuery'` or `'beforeExecute'`. The phases `'afterQuery'` and `'afterExecute'` no longer occur. Mongo's `RUNTIME.CONTENT_HASH_REQUIRES_RESOLVED_COMMAND` also reports `details.phase: 'beforeEncode'`, not `'beforeExecute'`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '[''"`](beforeQuery|beforeExecute|afterQuery|afterExecute)[''"`]'
  - id: every-started-statement-is-ended-and-finalized
    summary: |
      Every statement the runtime accepts now starts an activity, and every started statement ends and is finalized exactly once. A call with an already-aborted signal fires `activityStarted` before it fails. A statement that fails before it runs, in `beforeCompile`, `beforeEncode` or parameter encoding, now ends `failed` and is finalized, where it got no `afterTransaction` before. `activityEnded` also fires for a statement the caller stopped reading (outcome `'stopped'`) and for a statement that failed before it ran (outcome `'failed'`, `latencyMs: 0`, `source: 'driver'`); `afterQuery` and `afterExecute` fired for neither, so a metrics or slow-query middleware now counts them unless it checks `result.outcome`. When a middleware's `activityStarted` throws, the middleware after it receive no `activityEnded` or `activityFinalized` for that activity. A statement still running when its transaction ends, such as a row stream still being read, is finalized when it ends, with the transaction's outcome, and keeps its `ctx.state` until then.
  - id: observed-row-budget-runs
    summary: |
      The `budgets()` middleware now counts the rows a query returns and enforces `maxRows` on them. Before, the observed-row check never ran. With the default row severity `'error'`, or in `strict` mode, a query that returns more than `maxRows` rows fails with `BUDGET.ROWS_EXCEEDED`; with `'warn'` in `permissive` mode it logs one warning for the statement and keeps streaming.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bbudgets\('
  - id: lossy-type-changes-ask
    summary: |
      On Postgres and SQLite, `migration plan` and `db update` no longer write a type change that can lose values without asking. A script that runs them without a terminal fails with `CLI.CONSENT_REQUIRED` until it passes `--convert <Model.field>` (`migration plan` only: write the conversion into the slot) or `--delete <Model.field>` (the database's own cast runs: it may cut or round values, such as a longer text cut to a shorter `VarChar` on Postgres, and a value it cannot cast fails the apply).
  - id: placeholders-only-when-asked
    summary: |
      `migration plan` writes `placeholder(...)` slots on Postgres and SQLite only for a field that `--convert` or `--backfill` names. A new required field now gets a temporary value in the existing rows (`''`, `0`, …), which the output names, and an optional field made required is tightened directly. Pass `--backfill <Model.field>` to get the backfill step to fill instead.
  - id: required-field-failures-count-rows
    summary: |
      A migration that makes a field required while rows have no value for it fails with `MIGRATION.RUNNER_FAILED`, whose summary counts the rows and whose advice names the fix. Scripts that matched the old summary text (`… failed during precheck: ensure no NULL values in …`) must match the new one, or the `rowsWithoutValue` failure field.
  - id: postgres-alter-column-type-plain-options
    summary: |
      `this.alterColumnType(...)` in a Postgres `migration.ts` now takes `{ schema, table, column, type, using?, operationClass? }`. The `options` object with `qualifiedTargetType`, `formatTypeExpected`, `rawTargetTypeForLabel` and `using` is gone. Move `options.qualifiedTargetType` to `type` and `options.using` to `using`, and drop the other two.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\bqualifiedTargetType\s*:'
  - id: mongo-rename-statements-carried-out
    summary: |
      On MongoDB, `migration plan` and `db update` carry out `--rename`: a model rename renames its collection, keeping the documents, indexes and validator, and a field rename renames the field in every document that holds it. They used to refuse every statement with `MIGRATION.PLANNING_FAILED`. A question about a dropped collection now offers `--rename` as well as `--delete`.
  - id: mongo-removed-field-asks
    summary: |
      On MongoDB, removing a field from a model is now data loss. `migration plan` and `db update` ask about it, and fail with `CLI.CONSENT_REQUIRED` where nobody can answer, until `--delete <Model>.<field>` or a `--rename` answers it. `--delete` removes the field from every document that holds it.
  - id: mongo-preview-get-collection
    summary: |
      A MongoDB plan's preview writes each collection as `db.getCollection("users")`, for example `db.getCollection("users").createIndex(...)` where it wrote `db.users.createIndex(...)`. `ops.json` does not change.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs,snap}"
      matches:
        - 'db\.[A-Za-z_][\w]*\.(?:createIndex|dropIndex|drop)\('
  - id: mongo-time-series-update
    summary: |
      `db update` on a database with a MongoDB time-series collection no longer fails with "Cannot change immutable collection option 'timeseries'" when nothing changed.
  - id: storage-question-wording
    summary: |
      A data-loss question about data named by its storage name, because the origin contract is unknown, ends with `--delete loses that data` instead of `--delete loses its rows`.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '--delete loses its rows'
  - id: migration-ts-finds-its-config
    summary: |
      Running a `migration.ts` with node and no `--config` uses the config that owns the migration, whose migrations directory holds the file: the nearest `prisma.config.ts` above the migration's directory, else the one in the working directory. If neither owns it, it fails with `CLI.MIGRATION_CONFIG_NOT_FOUND`. It used to load only the working directory's config, whichever project it belonged to.
  - id: contract-artifacts-restamp
    summary: |
      An extension that writes its own package version into the contracts it emits, such as the
      Supabase extension, now writes 8.0.0-rc.18. Run `contract emit` once after upgrading so the
      emitted `contract.json` and `contract.d.ts` match the installed extension.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.17"'
---

# 8.0.0-rc.17 → 8.0.0-rc.18 — User upgrade instructions

## Top-level declarations belong to the default namespace

A declaration written at the top level of a schema is a member of the target's default namespace: `public` on Postgres, the late-bound namespace (`unbound`, contract id `__unbound__`) on SQLite and MongoDB. Emitted contracts do not change.

### `psl-default-namespace-duplicate-declaration`

```prisma
model Account {
  id Int @id
}

namespace public {
  model Account {
    id Int @id
  }
}
```

This is `PSL_DUPLICATE_DECLARATION: Duplicate declaration of "Account"` on the second declaration. Remove one or rename it. The same holds for a member of `namespace public { … }` named like a `types { }` binding, like another namespace, or `public`.

### `psl-default-namespace-name-is-reserved`

A top-level declaration named `public` (Postgres), or `unbound` or `__unbound__` (SQLite, MongoDB), is rejected, even when the schema has the name once, because the default namespace already has it:

```text
PSL_DUPLICATE_DECLARATION: Duplicate declaration of "public"
```

On Postgres, `unbound` and `__unbound__` are rejected only when the schema also has a `namespace unbound { … }` or `namespace __unbound__ { … }` block. Rename the declaration; on a model, `@@map("public")` keeps the table or collection name. A schema read with `prisma7Schema(...)` or `prisma6Schema(...)` is the file the Prisma 7 or Prisma 6 client reads, so the rename applies there too.

## Raw SQL in PSL is a `sql` literal

### Every place that holds raw SQL takes a `sql` literal

Raw SQL in a PSL schema is written as a `sql` literal, the form `@default` already uses. A quoted string is refused in these places:

| Place | Before | After |
| --- | --- | --- |
| `@@index(where:)` | `@@index([email], where: "(archived_at IS NULL)", name: "users_email_active")` | ``@@index([email], where: sql`(archived_at IS NULL)`, name: "users_email_active")`` |
| `@@index(expression:)` | `@@index(expression: "lower(email)", name: "users_email_lower")` | ``@@index(expression: sql`lower(email)`, name: "users_email_lower")`` |
| `@@fullTextIndex(where:)` | `@@fullTextIndex([text], where: "archived_at IS NULL", name: "message_text_search_live")` | ``@@fullTextIndex([text], where: sql`archived_at IS NULL`, name: "message_text_search_live")`` |
| `@@check(expression:)` | `@@check(expression: "total > 0", name: "order_total_positive")` | ``@@check(expression: sql`total > 0`, name: "order_total_positive")`` |
| a policy's `using` | `using = "\"userId\"::uuid = auth.uid()"` | ``using = sql`"userId"::uuid = auth.uid()` `` |
| a policy's `withCheck` | `withCheck = "\"userId\"::uuid = auth.uid()"` | ``withCheck = sql`"userId"::uuid = auth.uid()` `` |

Inside a `sql` literal no quote is escaped: `\"` becomes `"`. A literal may span lines.

Run the script from the project root to rewrite every `.prisma` file:

```sh
node <skill>/upgrading/app/upgrades/8.0.0-rc.17-to-8.0.0-rc.18/scripts/sql-expression-literals-psl/rewrite-sql-strings.mjs '**/*.prisma'
```

It finds each quoted string in those places, outside `//` and `///` comments, decodes its escapes, and writes the same text as a `sql` literal. A text that holds a backtick is written in the double-quote form, `sql"..."`. A text that spans lines is written with the text on its own lines. The script prints each changed file and its number of rewrites, and running it twice changes nothing. Check the diff by hand.

A place the script did not rewrite, for example a string the script cannot read, is refused when the schema is emitted:

```text
PSL_VALUE_TYPE_INCOMPATIBLE: Expected sql`...`; write sql`(archived_at IS NULL)`
```

The message ends with the literal to write. When the string's text would read back from a `sql` literal as different text (it has indentation shared by every line, blank lines at the start or end, a whitespace-only line, or a carriage return), the message is ``Expected sql`...` `` alone; write the SQL in a `sql` literal, and see the next section. A number, `true` or `false` is refused the same way, an identifier is `PSL_INVALID_ATTRIBUTE_SYNTAX` (``Expected sql`...`; got an identifier``), and `pg.sql` is `PSL_UNKNOWN_LITERAL_TAG`.

`contract infer` now writes these places as `sql` literals. When an index's SQL would read back from a `sql` literal as different text and the index has a Prisma-generated name, `contract infer` writes the canonical text, which keeps the same name. It skips an index, check or policy named with `map:` whose SQL would read back as different text, and writes a comment in its place, such as `// prisma: skipped index "users_email_active": its SQL cannot be written as a sql literal that reads back unchanged. It is not in this schema, so migration plan will drop it. A sql literal written by hand holds different text, so migration plan then stops with a conflict for an index or check, or drops and recreates a policy. Either change the SQL in the database to the text of the literal, or add the object without map: or @@map so Prisma names it.` Such an object is still in the database. If you run `migration plan` without adding it to the schema, the plan drops it; for a policy, that removes a row-level security rule. Adding it by hand as written does not fix this: a `sql` literal holds canonical text, which is not the text in the database, so `migration plan` stops with a conflict for an index or check, and drops and recreates a policy. Do one of these instead:

- Change the SQL in the database to the canonical text, for example with a migration written with `migration new`, then add the object with that text.
- Add the object without `map:` (for a policy, without `@@map`) so Prisma names it. `migration plan` then drops the old object and creates it again under its new name, once.

`contract print` refuses such an object with `CONTRACT.PRINT_UNSUPPORTED`; write its SQL in the canonical form in the contract's source.

This supersedes the PSL `@@index(expression: "to_tsvector(…)", type: "gin", …)` example of the `postgres-full-text-search` app instructions in the upgrade from 8.0.0-rc.11 to 8.0.0-rc.12: write it as ``@@index(expression: sql`to_tsvector(…)`, type: "gin", …)``.

### `psl-storage-hash-may-change-once`

A `sql` literal stores its canonical text: indentation shared by every line, blank lines at the start and end, whitespace-only lines and carriage returns are removed. Every blank line at the start and end is now removed, not only the first and the last, so a `sql` literal in PSL or a `sql` template in TypeScript that starts or ends with two or more blank lines also stores a different text once. A quoted string whose text had any of these is stored differently once it is rewritten, so the contract's storage hash changes once. Prisma-generated index, check and policy names do not change, because their hash is computed from text with its whitespace collapsed.

After emitting the rewritten schema, run `prisma migration plan` once and commit the migration it writes. For objects with Prisma-generated names that migration has no operations; it records the new storage hash. For an index or check named with `map:` whose text changed, `migration plan` stops with a conflict for that object and says to write a custom migration with `migration new`. The database needs no change, so write that migration with no operations. For a policy named with `@@map` whose text changed, `migration plan` writes a migration that drops the policy and creates it again with the canonical text. A schema whose texts had none of these forms emits the same contract as before, and `migration plan` reports no change.

## Raw SQL in a TypeScript contract is a `sql` value

### `builder-raw-sql-is-a-sql-value`

Every field of the TypeScript contract builder that holds raw SQL takes a `sql` value, as `.default()` already did. Wrap each string in the `sql` tag, imported from the same contract-builder module as the other helpers:

| Place | Before | After |
| --- | --- | --- |
| `index` `where` | `constraints.index([cols.email], { where: '(archived_at IS NULL)', name: 'users_email_active' })` | ``constraints.index([cols.email], { where: sql`(archived_at IS NULL)`, name: 'users_email_active' })`` |
| `index` `expression` | `constraints.index({ expression: 'lower(email)', name: 'users_email_lower' })` | ``constraints.index({ expression: sql`lower(email)`, name: 'users_email_lower' })`` |
| `fullTextIndex` `where` | `fullTextIndex(cols.text, { where: 'archived_at IS NULL', name: 'message_text_search_live' })` | ``fullTextIndex(cols.text, { where: sql`archived_at IS NULL`, name: 'message_text_search_live' })`` |
| `check` `expression` | `check({ expression: 'total > 0', name: 'order_total_positive' })` | ``check({ expression: sql`total > 0`, name: 'order_total_positive' })`` |
| a policy's `using` and `withCheck` | `policySelect(Profile, { name: 'profile_owner_read', roles: [authenticated], using: '"userId"::uuid = auth.uid()' })` | ``policySelect(Profile, { name: 'profile_owner_read', roles: [authenticated], using: sql`"userId"::uuid = auth.uid()` })`` |

```ts
import { check, policySelect, sql } from '@prisma/orm-postgres/contract-builder';
```

Copy the string's value, not its source: undo the TypeScript string's own escaping first, so `'"userId"'` and `"\"userId\""` both become `` sql`"userId"` ``. Inside the template, write each backtick as `` \` ``, each `${` as `\${`, and a backslash that precedes a backtick, a dollar sign or another backslash as `\\`; every other backslash is kept as written, so `E'\n'` stays `E'\n'`. An index or check object written by hand in `.sql({ indexes, checks })` takes a `sql` value in the same fields. A shared predicate held in a `const` becomes a `sql` value too: `` const owner = sql`"userId"::uuid = auth.uid()`; ``.

Skip files under a `migrations/` folder and leave them as they are: migration functions take a string or a `sql` value, and a string keeps its exact text, while wrapping it in `sql` canonicalizes it, which can change the SQL that migration runs.

The string form is a type error. JavaScript that is not type-checked and passes a string fails when the contract is built, with `CONTRACT.ARGUMENT_INVALID`, for example ``Index "users_email_active" where must be a sql`...` value.`` The message names the index, check or policy; an index or check with no `name` or `map` is named by its model, as in `Index on "User" where`. `.default('draft')` is not raw SQL: a string there is still a literal default. The `{ fields, render }` form of an index expression still returns a string from `render`, because that text is generated by code; lowering canonicalizes that text as it canonicalizes a `sql` value.

This supersedes the TypeScript `fullTextIndex(cols.text, { where: 'archived_at IS NULL', … })` example of the `postgres-full-text-search` app instructions in the upgrade from 8.0.0-rc.11 to 8.0.0-rc.12: write it as ``fullTextIndex(cols.text, { where: sql`archived_at IS NULL`, … })``.

### `sql-tag-interpolates-sql-values`

The `sql` tag accepts other `sql` values inside `${…}`. It joins their text into the template and canonicalizes the whole text once. A predicate that was built by joining strings is written as one `sql` template:

```ts
const owner = sql`owner_id = current_setting('app.uid')::int`;
const ownerAlive = sql`${owner} AND deleted_at IS NULL`;
```

Anything else inside `${…}`, such as a string or a number, is a type error, and throws `CONTRACT.SQL_EXPRESSION_INTERPOLATION` from JavaScript that is not type-checked. Prisma never quotes a value into SQL, so write any other text inside the template. Each line of an interpolated value after its first takes the indentation of the template line the `${…}` sits on, so a multi-line value inside an indented template stores the same text as the same SQL written out in one template.

### `sql-tag-error-codes-renamed`

- `CONTRACT.DEFAULT_SQL_INTERPOLATION` is now `CONTRACT.SQL_EXPRESSION_INTERPOLATION`, and its message is ``sql`...` only interpolates other sql`...` values; write any other text inside the template.``
- A `sql` value whose text holds a NUL character or is larger than 65536 bytes throws `CONTRACT.SQL_EXPRESSION_INVALID` when it is made. It was `CONTRACT.DEFAULT_INVALID`.
- `` sql`now()` ``, `` sql`autoincrement()` `` and unsafe SQL (`;`, a comment token, `$$` or `SELECT`) are no longer refused by the tag. `.default()` refuses them with `CONTRACT.DEFAULT_INVALID` and the same messages, so `` const current = sql`now()` `` compiles and runs, and `.default(current)` throws. In every other place such text is passed to the database unchanged.

Update code that matches on these codes. Code that catches `CONTRACT.DEFAULT_INVALID` around a `sql` template that is not passed to `.default()` no longer sees it.

### `ts-storage-hash-may-change-once`

A `sql` value stores its canonical text, as a PSL `sql` literal does: indentation shared by every line, blank lines at the start and end, whitespace-only lines and carriage returns are removed. A raw SQL string whose text had any of these, for example a multi-line template string, is stored differently once it is written as a `sql` value, so the contract's storage hash changes once. Prisma-generated index, check and policy names do not change. Skip files under a `migrations/` folder and leave them as they are: migration functions take a string or a `sql` value, and a string keeps its exact text, while wrapping it in `sql` canonicalizes it, which can change the SQL that migration runs. Follow the steps of `psl-storage-hash-may-change-once` in this guide: run `prisma migration plan` once and commit the migration it writes. For an index or check named with `map:` whose text changed, `migration plan` stops with a conflict and asks for a migration written with `migration new`, which needs no operations. The TypeScript policy helpers take no exact name, so a policy never needs this. A `{ fields, render }` index expression whose `render` returns text that is not canonical, such as indented multi-line text, also stores different text once, with the same steps; `fullTextIndex` stores its fields and language as data, renders no SQL, and is not affected.

### `infer-notes-defaults-that-do-not-read-back`

A column default whose text a `sql` literal cannot write back unchanged, for example a string constant holding a carriage return or a whitespace-only line, is treated differently by the two commands that write PSL, for the reason ADR 268 gives ("Column defaults that do not read back"):

- `contract infer` still writes the default as a `sql` literal and adds the comment `// prisma: default of "<column>" holds text a sql literal cannot write back unchanged; check its string constants before applying a migration` to the model. The literal reads back as a different constant, so a database created from the inferred schema gets that constant. Check the constant, and fix it in the schema or in the database before you apply a migration planned from it.
- `contract print` refuses the default with `CONTRACT.PRINT_UNSUPPORTED` (``default of column "public"."post"."slug" holds SQL that a sql literal cannot write back unchanged``). Write the default in its canonical form in the contract's source. A contract holds such a default only when it was built before this release, or through `.default({ kind: 'function', expression })` or `.defaultSql('...')`.

This applies to projects that write only PSL as well as TypeScript projects.

## A full-text index is stored as data

### `re-emit-contracts-with-a-full-text-index`

`@@fullTextIndex` and the TypeScript `fullTextIndex` helper used to store a SQL expression in the contract. They now store the index's definition as an index of type `fullText`, and the SQL is rendered from it when the index is created and when a query searches it. The database index is still a `gin` index over the same expression. For `@@fullTextIndex([title], name: "post_title_search")` the emitted index changes like this:

```diff
 {
-  "expression": "to_tsvector('english', \"title\")",
-  "name": "post_title_search_724b05e5",
+  "columns": ["title"],
+  "name": "post_title_search_e0dd1131",
+  "options": { "language": "english", "weightGroups": [["title"]] },
   "prefix": "post_title_search",
-  "type": "gin",
+  "type": "fullText",
   "unique": false
 }
```

The schema source does not change. The index's name ends in a hash of its contract entry, so the name changes, and the database needs one rename. Do this:

1. Run `prisma contract emit` and commit the regenerated `contract.json` and `contract.d.ts`. The storage hash changes. Do not hand-edit the generated files.
2. Run `prisma migration plan` and apply the migration as usual. Planned from the previous contract, it renames each full-text index: `ALTER INDEX "post_title_search_724b05e5" RENAME TO "post_title_search_e0dd1131"`. A rename is instant and keeps the index.

Do not use `prisma db update` for this step if a full-text index is large. `db update` compares the contract with the live database, where Postgres prints the expression in its own form, so it cannot tell that the old index is the new one under another name. It drops the index and builds it again. For the index above it plans:

```
├─ ⚠ Drop index "post_title_search_724b05e5"
└─ Create index "post_title_search_e0dd1131" on "post"

DROP INDEX "public"."post_title_search_724b05e5";
CREATE INDEX "post_title_search_e0dd1131" ON "public"."post" USING "gin" (to_tsvector('english', "title"));
```

Building a GIN index reads the whole table. If you must use `db update`, rename each index by hand first, with the old name from the database and the new one from the re-emitted contract (`ALTER INDEX "post_title_search_724b05e5" RENAME TO "post_title_search_e0dd1131"`). `db update` then has nothing to do for it.

Until the rename, `prisma db verify` reports the new index name as missing. With `--strict` it also reports the old name as an extra index.

If code reads a full-text index's `expression` from the contract, recognise the index by `type: "fullText"` and read `options.weightGroups` and `options.language` instead. `weightGroups` lists the weight groups, each a list of storage column names, and `columns` is the same columns in the same order. The search document is no longer stored anywhere in the contract.

An index declared with `map:` keeps its exact name, so neither the name nor the database changes. Only the storage hash moves. `db verify` compares a `map:` index's expression with the text Postgres prints for it, character for character, so it reports a `map:` full-text index as changed, as it did before.

A full-text index can now cover several fields, each top-level item a weight group, strongest first. This is optional:

```prisma
@@fullTextIndex([[title, subtitle], body], name: "post_search")
```

In an index of several fields, every column is wrapped in `coalesce(column, '')`, so the index does not change when a column becomes optional or required. To search it, pass the index from the table's `indexes` to `fns.fullTextMatches` and `fns.fullTextRank` in the SQL builder, which then search its weight groups in its language: `fns.fullTextMatches(post.indexes.post_search, q)`. To search several columns without an index, wrap the groups in `fullTextDocument` from `@prisma/orm-postgres/target/full-text`.

### `full-text-index-one-field-diagnostic-removed`

`@@fullTextIndex([a, b])` was refused with `PSL_FULL_TEXT_INDEX_ONE_FIELD`. It is now a valid index with two weight groups, and that code is never raised. Remove assertions on it. The new refusals are `PSL_FULL_TEXT_INDEX_TOO_MANY_GROUPS` (more than four groups), `PSL_FULL_TEXT_INDEX_EMPTY_GROUP` (an empty group) and `PSL_FULL_TEXT_INDEX_DUPLICATE_FIELD` (a field named twice). `PSL_FULL_TEXT_INDEX_TEXT_FIELD`, `PSL_FULL_TEXT_INDEX_REQUIRES_NAME` and `PSL_FULL_TEXT_INDEX_NAME_XOR_MAP` are unchanged.

## A base model lists its variants by discriminator value

### `re-emit-contracts-with-polymorphic-models`

For `@@base(Task, "bug")` and `@@base(Task, "feature")` the base model's entry changes like this:

```diff
 "Task": {
   "discriminator": { "field": "type" },
   "variants": {
-    "Bug": { "value": "bug" },
-    "Feature": { "value": "feature" }
+    "bug": { "model": "Bug", "namespace": "public" },
+    "feature": { "model": "Feature", "namespace": "public" }
   }
 }
```

The schema source does not change, and neither does a variant model's `base`. The storage hash does not change, so no migration is needed and the database marker stays valid.

1. Run `prisma contract emit` and commit the regenerated `contract.json` and `contract.d.ts`.
2. Rewrite each contract snapshot under `migrations/snapshots/<hash>/` whose `contract.json` matches `detection`. No command regenerates a snapshot, and a snapshot in the previous form stops `prisma migration plan` when it is the plan's origin. The directory names stay as they are.

In a snapshot's `contract.json`, for every model that has `variants`:

- replace each entry `"<Model>": { "value": "<value>" }` with `"<value>": { "model": "<Model>", "namespace": "<namespace>" }`, where `<namespace>` is the key under `domain.namespaces` that holds the base model;
- order the entries by key;
- keep the file on one line with no added whitespace.

In the snapshot's `contract.d.ts`, make the same change to the type of `variants`:

```diff
 readonly variants: {
-  readonly Bug: { readonly value: 'bug' };
-  readonly Feature: { readonly value: 'feature' };
+  readonly bug: { readonly namespace: 'public' & NamespaceId; readonly model: 'Bug' };
+  readonly feature: { readonly namespace: 'public' & NamespaceId; readonly model: 'Feature' };
 };
```

Quote a key that is not an identifier, such as `'view-product'`. Change nothing else in either file.

A MongoDB contract has one namespace, `__unbound__`; use it as `<namespace>`.

### `read-variants-by-discriminator-value`

This affects only code that reads `variants` from a contract object or from `contract.json`. The `variants` option of the MongoDB TypeScript contract builder's `discriminator` is unchanged: it still lists `<Model>: { value }`.

```ts
// before
const value = models.Task.variants.Bug.value;
const variantNames = Object.keys(models.Task.variants);

// after
const model = models.Task.variants.bug.model;
const values = Object.keys(models.Task.variants);
const variantNames = Object.values(models.Task.variants).map((variant) => variant.model);
```

To find the value of a known variant model, search the entries for the one whose `model` and `namespace` are that model's.

## A Prisma 7 schema's `@ignore` and `@@ignore` objects stay in the contract

The contract read from a Prisma 7 schema now describes every table and column Prisma 7 created, including those of `@ignore` fields and `@@ignore` models. The ORM still leaves them out of its models. The contract's storage hash therefore changes for a schema that uses `@ignore` or `@@ignore`, and no existing database's signature matches it any more.

### A schema that loaded before can be refused

An ignored field or model now becomes part of the contract, so it meets every rule the reader applies, not only to the fields Prisma 8 maps. `prisma contract emit` can refuse a schema that loaded before only because its ignored objects were dropped. Each diagnostic says what to change in the Prisma 7 schema. Common examples, not every case:

- `PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED`: a `@db.*` column type with no Prisma 8 codec, on an `@ignore` field or in an `@@ignore` model. `PSL.PRISMA7_UNSUPPORTED_TYPE`: an `Unsupported("...")` field in an `@@ignore` model. `@ignore` and `@@ignore` no longer work around a missing codec; the schema cannot be read until Prisma 8 supports the type.
- `PSL.PRISMA7_INDEX_ARGUMENT_UNSUPPORTED`: an index on an `@@ignore` model with `sort`, `length` or `ops` arguments, such as the `sort: Desc` that `prisma db pull` writes.
- `PSL.PRISMA7_REFERENTIAL_ACTION_UNSUPPORTED`: an `@ignore` relation with `onDelete: SetNull` or `SetDefault` over a required field that cannot take it.
- `PSL.PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED`: an ignored `Json` field with `@default("null")`.

### While Prisma 7 still applies the migrations

If you have no `migrations/app` folder of Prisma 8 migrations yet, emit the contract and sign each existing database again:

```bash
prisma contract emit
prisma db sign
```

### After Prisma 8 took over the migrations

Emit the contract, then plan a migration before anything else. The migration creates the ignored objects, which a database rebuilt from `migrations/` needs:

```bash
prisma contract emit
prisma migration plan --name keep-ignored-objects
```

Then bring each existing database (production, staging, every developer's) to the new hash. Either sign it:

```bash
prisma db sign
```

or run your usual deploy step with the `db` ref:

```bash
prisma db migrate --advance-ref db
```

`db migrate` skips each create because the object already exists. Plain `prisma db migrate` also brings the database to the new hash, but leaves the `db` ref behind, so the next `migration plan` would plan the same migration again; run `prisma db sign` afterwards to move the ref.

If you signed before planning, the `db` ref points at a hash that is not in the migration graph, and `prisma migration plan` fails with `MIGRATION.HASH_NOT_IN_GRAPH`. Plan from the hash the database had before, which `prisma migration list` shows as the last migration's destination:

```bash
prisma migration plan --from <previous hash> --name keep-ignored-objects
```

## `mongo-enum-member-written-as-stored`

`contract.json` holds each enum member in the form its codec stores, and `db.enums` reads it back through the codec. Both must give the member as written, so a Mongo contract now refuses a member whose stored form the codec reads back as another value, and says what to write:

```text
CONTRACT.ENUM_INVALID: enumType("Volume"): member "Quiet" is written "quiet", but the field stores "QUIET". Write the member as "QUIET".
```

In a PSL or Prisma 6 schema the same member is reported at the member:

```text
enum "Volume" member "Quiet" is written "quiet", but its codec stores "QUIET". Write the member as "QUIET".
```

In TypeScript, a codec that throws on a member is now reported as `CONTRACT.ENUM_INVALID` naming the member, with the codec's error as the cause.

1. Run `prisma contract emit`. Each refused member is reported with the value to write.
2. If the codec is yours and should store the value as written, fix its `encodeJson` or `decodeJson` so `decodeJson(encodeJson(value))` returns `value`. Otherwise write each refused member as the message says.
3. Re-emit.

## A TypeScript contract's namespaces and rows have precise types

### Namespace keys equal the runtime keys

A contract built with `defineContract` from TypeScript typed `contract.domain.namespaces` as a record with any string key, and every key listed every model. The types now have exactly the keys the built contract has at runtime:

- `contract.domain.namespaces` and `db.orm` have a key for each namespace that holds a model. They also have the default namespace (`public` on Postgres, `__unbound__` on SQLite) when the contract has no models or declares enums. Each namespace lists only its own models.
- `contract.storage.namespaces` has the default namespace, each namespace listed in `namespaces`, and each model's namespace. Each lists only the tables of its own models.

A Postgres contract whose models all have `namespace: 'auth'` has no `public` domain namespace, so `db.orm.public` no longer typechecks. At runtime it was always `undefined`. Code that reads a namespace the contract does not have now fails to typecheck. Use the namespace the model is in:

```diff
  // A Postgres contract built with defineContract, with User in the default namespace
- type User = (typeof contract.domain.namespaces)['__unbound__']['models']['User'];
+ type User = (typeof contract.domain.namespaces)['public']['models']['User'];
```

Indexing `domain.namespaces` with a `string` variable no longer typechecks, because the type has no index signature. Narrow the key to the contract's keys first:

```diff
- const namespace = contract.domain.namespaces[name];
+ const namespace = Object.hasOwn(contract.domain.namespaces, name)
+   ? contract.domain.namespaces[name as keyof typeof contract.domain.namespaces]
+   : undefined;
```

A model is placed in its namespace only when `namespace` is a string literal. When any model's `namespace` comes from a `string` variable, the contract's namespace types fall back to a `string` index, and every namespace lists every model of the contract, as before this change. Access a namespace with brackets and check it for `undefined`, for example `db.orm['billing']?.Invoice`.

On SQLite, `defineContract` no longer accepts `namespaces`. The build always rejected it at runtime; the type now rejects it too. Remove the option.

### Rows have their codec output types

The ORM client of such a contract now types each row field as its codec's output type, narrowed to the enum's values for an enum field. Before, every field was `unknown`. This also applies to `field.column({ codecId, nativeType })` with an inline codec id, which no longer needs `as const`.

A cast that agrees with the codec type still typechecks and can be removed. A cast that disagrees with the codec type now fails with TS2352, and shows a real mismatch: fix the code that expected the other type.

```diff
  const row = await db.orm.Sample.first();
- const when = row.when as string;
+ if (row === null) throw new Error('No sample');
+ const when = row.when.toISOString();
```

`first()` returns `null` when no row matches, which its type now says, so code that read a field of the result without checking for `null` fails to typecheck too.

Rows of an included relation are still typed `unknown`; casts on those still typecheck.

## A model with no fields has no keys

Re-emit the contract. If code reads a property of a row of a model with no fields, it now fails to compile, because the model has no field of that name. With the SQL ORM client, passing a key in the create or update input of such a model fails to compile too. Remove the read or the key, or add a field to the model that maps the column.

## Generic update data uses the update input type

The update methods of the SQL and Mongo ORM clients now take the update input type of the model, which rejects every key for a model with no fields. While the model name is a type parameter, TypeScript cannot tell that `Partial<DefaultModelRow<Contract, M>>` is that type. Use the update input type instead.

SQL ORM client:

```diff
- import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
- function touchAll<M extends 'User' | 'Post'>(rows: Collection<Contract, M>, data: Partial<DefaultModelRow<Contract, M>>) {
+ import type { ScalarUpdateInput } from '@prisma/orm-postgres/orm-client';
+ function touchAll<M extends 'User' | 'Post'>(rows: Collection<Contract, M>, data: ScalarUpdateInput<Contract, M>) {
    return rows.where({}).updateAndCount(data);
  }
```

Mongo ORM: replace `Partial<DefaultModelRow<Contract, M>>` with `UpdateInput<Contract, M>`, imported from `@prisma/orm-mongo/orm`, the same entry point as `DefaultModelRow`.

Where the model name is a concrete name, such as `Partial<DefaultModelRow<Contract, 'User'>>`, nothing changes.

## The SQL ORM client accepts only field names

Every name passed to the SQL ORM client must be the name of a field of the model, or of the variant the collection is narrowed to. A name that is not a field throws `ORM.FIELD_UNKNOWN` with the message `Model "<model>" has no field "<name>"`. A column name is not a field name: pass the field instead.

```diff
- await db.orm.Post.where({ user_id: 1 }).all();
+ await db.orm.Post.where({ userId: 1 }).all();
```

Code that catches the error a `conflictOn` name that is not a field raises (in a create with `onConflict: 'skip'`) matched `ORM.ARGUMENT_INVALID`. Match `ORM.FIELD_UNKNOWN` instead.

```diff
- if (error.code === 'ORM.ARGUMENT_INVALID') {
+ if (error.code === 'ORM.FIELD_UNKNOWN') {
```

Leave other checks of `ORM.ARGUMENT_INVALID` alone; only the `conflictOn` refusal changed code.

## `fragment` is called on the model's root collection

A fragment for one model, made with `collection.fragment(body)`, is built from the model alone. Calls chained before `.fragment(...)`, such as `where`, `orderBy`, `include`, `limit` or `forUpdate`, were ignored without a word. Now `fragment` throws `ORM.ARGUMENT_INVALID` on such a collection, and a `where`, an `orderBy` or an `include` before it is also a compile error. A receiver typed by a type parameter, such as `this` in a custom collection class method or `C` in a generic function, is a compile error too, because it may be a chained collection.

In your code, chain on the collection directly instead of defining a fragment from it. Inside a class method, chain on `this`:

```diff
  titles() {
-   return this.with(this.fragment((posts) => posts.select('id', 'title')));
+   return this.select('id', 'title');
  }
```

If the fragment is shared between places, define it once as a module-level constant on the model's root collection, and move the chained calls that were meant to be part of it into its body:

```diff
- const recentSummary = db.orm.public.Post.orderBy((p) => p.id.desc()).fragment((posts) =>
-   posts.select('id', 'title'),
- );
+ const recentSummary = db.orm.public.Post.fragment((posts) =>
+   posts.orderBy((p) => p.id.desc()).select('id', 'title'),
+ );
```

The detection does not find a `.fragment(` call whose receiver is a variable or a parameter holding a chained collection, such as `const published = db.orm.public.Post.where(...)` followed by `published.fragment(...)`, or a generic receiver. Check those `.fragment(` calls by hand.

Skip a match on the fragment for any model, `fragment(fields, body)`, called on a client returned by a call, such as `orm(...).fragment(fields, body)`, which did not change, and a match in code that uses the MongoDB ORM client, which did not change either.

## `Fragment` is now `QueryFragment`, and `FieldFragment` is now `DeclaredFieldsFragment`

A function from a collection to a collection, run with `collection.with(fn)`, is a query fragment, and its type is now named `QueryFragment<In, Out>`. "Fragment" alone also covers a row fragment, a function of the model accessor that `where` and `orderBy` take, and it is the name of React's `Fragment`. What `db.orm.fragment(fields, body)` returns, a fragment declared over the fields it needs, is now typed `DeclaredFieldsFragment`. The types work as before.

These changes apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

Rename `Fragment` to `QueryFragment` and `FieldFragment` to `DeclaredFieldsFragment`. These are the names 8.0.0-rc.17 exports.

```diff
- import type { FieldFragment, Fragment } from '@prisma/orm-postgres/orm-client';
+ import type { DeclaredFieldsFragment, QueryFragment } from '@prisma/orm-postgres/orm-client';

- const newest: Fragment<PostCollection, Ordered<PostCollection>> = (posts) => posts.newestFirst();
+ const newest: QueryFragment<PostCollection, Ordered<PostCollection>> = (posts) => posts.newestFirst();
```

Code that still uses the 8.0.0-rc.16 names renames them to the new names directly: `Scope` to `QueryFragment`, `FieldScope` to `DeclaredFieldsFragment` and `ScopeFacts` to `FragmentFacts`.

Rename every use of these types in the file, including a re-export such as `export type { Fragment } from '@prisma/orm-postgres/orm-client'`, a qualified name such as `Orm.Fragment` after `import * as Orm from '@prisma/orm-postgres/orm-client'`, and an inline type such as `import('@prisma/orm-postgres/orm-client').Fragment`. After renaming, sort the named imports again, since `QueryFragment` sorts in a different place than `Fragment` or `Scope`, and wrap any line the longer names make too long for the formatter.

Do not rename React's `Fragment`, the SQL builder's `Scope` and `ScopeField` (imported from a `builder` entry), or any `Fragment` or `Scope` that is not imported from the ORM client. Do not rename `FragmentFacts` or `DeclaredField`, which keep their names.

## `unique-criterion-rejects-null`

`UniqueConstraintCriterion<TContract, ModelName>`, exported by the SQL ORM client (`@prisma/orm-postgres/orm-client` and the other facades' `orm-client` entries), is the object that names one row by its primary key or by one of its unique constraints. Each of its values is now the field's type without `null`. A `null` value cannot identify one row: a unique constraint allows any number of rows whose column is `NULL`.

The type is the argument of three calls, and each of them now refuses `null` and a value whose type includes `null`:

- `conflictOn` in `collection.upsert({ create, update, conflictOn })`
- `mutator.connect(criterion)` and `mutator.connect([criterion, ...])` in a relation callback of `create` or `update`
- `mutator.disconnect([criterion, ...])` in a relation callback of `update`

Only a model with a nullable unique column is affected. Given `Account.handle`, a nullable column with a unique constraint, these no longer compile:

```ts
await db.orm.Account.upsert({ create, update, conflictOn: { handle: null } });
await db.orm.Account.upsert({ create, update, conflictOn: { handle: maybeHandle } }); // maybeHandle: string | null

await db.orm.Owner.where({ id }).update({
  accounts: (accounts) => accounts.connect({ handle: maybeHandle }),
});
```

The compiler reports `Type 'null' is not assignable to type 'string'` on the field.

The detection also matches code this change does not affect. Leave as they are: a `.connect(` or `.disconnect(` call on another object, such as `postgres.connect({ url })`; and the `conflictOn` of `createAll` and `createAndCount`, which is an array of field names, such as `conflictOn: ['handle']`.

What to write instead:

- Where the value is known to be present, narrow it before the call, so that its type has no `null`:

  ```ts
  if (maybeHandle === null) {
    throw new Error('an account needs a handle to be connected');
  }
  await db.orm.Owner.where({ id }).update({
    accounts: (accounts) => accounts.connect({ handle: maybeHandle }),
  });
  ```

- Where the value can be absent, decide what that case means and write it as its own branch. For `upsert`, create the row with `create(...)` in that branch, or use a constraint whose columns all have values, such as the primary key: `conflictOn: { id }`. For `connect` and `disconnect`, leave the criterion out of the list in that branch, or name the row by another key.

- To read or write the rows whose column is `NULL`, use `where({ handle: null })`. It can match more than one row.

- Where your own code declares a variable, a parameter or a return value as `UniqueConstraintCriterion<...>`, the same rule applies to the values assigned to it.

## `prepared-all-and-aggregate-need-their-receiver`

`all` and `aggregate` on a collection's `prepared` object now declare the object they are called on. This applies to every collection, not only one filtered with `whereUnique`. A call without that receiver no longer compiles:

```ts
const { all, aggregate } = db.orm.Post.prepared;
all(); // error: The 'this' context of type 'void' is not assignable to method's 'this'
aggregate((a) => ({ posts: a.count() })); // the same error
```

Call the method on the `prepared` object instead:

```ts
const prepared = db.orm.Post.prepared;
prepared.all();
prepared.aggregate((a) => ({ posts: a.count() }));
```

These still compile and need no change: a destructured `first` or `firstOrThrow`, as in `const { first, firstOrThrow } = db.orm.Post.prepared; first(); firstOrThrow()`, and `prepared.all` passed as a callback without being called. What the methods do at run time is unchanged.

## `native-enums-leave-out-domain-enums`

`db.nativeEnums.<namespace>` lists the native Postgres enum types of the namespace, keyed as before by the name in the schema. It no longer lists a domain enum, which is an `enum` block in PSL or an `enumType()` in TypeScript. `db.enums.<namespace>` holds each domain enum, with its values decoded as a query returns them.

For each `db.nativeEnums.<namespace>.<Name>` in the code, check whether `<Name>` is a native enum (`native_enum <Name>` in PSL, `nativeEnum('<Name>', …)` in TypeScript). If it is a domain enum, read it through `db.enums` instead:

```ts
// before
db.nativeEnums.public.Priority.values; // ['1', '10'], the stored text
// after
db.enums.public.Priority.values; // [1n, 10n], the values a query returns
```

A domain enum's values in `db.enums` are the values a query returns, which can differ from the stored text that `db.nativeEnums` held: a `pg/int8` member is a `bigint`, a `pg/timestamptz-temporal` member a `Temporal.Instant`. Change code that compared them with stored text. A member's name is its name in the enum, such as `Low`, where `db.nativeEnums` named each member by its value.

## Middleware hooks are activity hooks

The runtime now runs every statement and every transaction as an **activity**. A middleware observes an activity through three lifecycle events, `activityStarted`, `activityEnded` and `activityFinalized`, and changes or stops a statement through interceptors: `beforeEncode`, `intercept.onQuery`, `intercept.onExecute` and `onRow`. The per-statement hooks are gone.

### Rename the hooks

| Before | After |
|---|---|
| `beforeQuery`, `beforeExecute` | `beforeEncode` |
| `interceptQuery`, `interceptExecute` | `intercept.onQuery`, `intercept.onExecute` |
| `onRow` | `onRow` |
| `afterQuery`, `afterExecute` | `activityEnded` on a statement |
| `afterTransaction` | `activityFinalized` on a statement |
| `beforeCompile` | `beforeCompile` |

`beforeEncode` keeps the arguments of `beforeQuery` and `beforeExecute`: the lowered plan, the context and the parameter mutator. It runs for both `query()` and `execute()`. A middleware that defined both `beforeQuery` and `beforeExecute` with the same body defines `beforeEncode` once. A middleware that must tell them apart reads `activity.returns` (`'rows'` or `'stats'`) in `activityStarted` and keeps it in `ctx.state`.

The interceptors move under one `intercept` object:

```diff
- async interceptQuery(plan, ctx) {
-   return { rows: cached };
- },
+ intercept: {
+   async onQuery(plan, ctx) {
+     return { rows: cached };
+   },
+ },
```

### Read the result from `activityEnded`

`afterQuery(plan, result, ctx)` and `afterExecute(plan, result, ctx)` become one hook, `activityEnded(activity, result, ctx)`. It fires for transactions too, so check the kind first. `result.completed` is replaced by `result.outcome`, which is `'succeeded'`, `'failed'` or `'stopped'` (the caller stopped reading the rows). `latencyMs` and `source` are unchanged; `rowCount` or `stats` is there according to `result.returns`. The plan the caller sent is `activity.plan`; the lowered SQL is not on the activity, so a middleware that logs it keeps it from `beforeEncode` in `ctx.state`:

```diff
- async afterQuery(plan, result, ctx) {
-   if (result.latencyMs > 250) ctx.log.warn({ sql: plan.sql, rowCount: result.rowCount });
- },
+ async beforeEncode(plan, ctx) {
+   ctx.state(statementSql)['sql'] = plan.sql;
+ },
+ async activityEnded(activity, result, ctx) {
+   if (result.kind !== 'statement' || result.latencyMs <= 250) return;
+   ctx.log.warn({
+     sql: ctx.state(statementSql)['sql'],
+     ...(result.returns === 'rows' ? { rowCount: result.rowCount } : {}),
+   });
+ },
```

`statementSql` is a module-level `Symbol('…')`, for example `const statementSql = Symbol('slow-query-warning.sql')`. An error thrown from `activityEnded` after a successful statement still fails it and reaches the caller, as an error from `afterQuery` did; every other middleware still receives `activityEnded`, and the caller receives the first error. A transaction also ends: `succeeded` when its `commit()` or `rollback()` resolved, `failed` when it rejected. So a rolled-back transaction ends `succeeded` and is finalized `rolled-back`. `activityEnded` also fires where `afterQuery` and `afterExecute` did not: for a statement the caller stopped reading, with `result.outcome` `'stopped'`, and for a statement that failed before it ran, in `beforeCompile`, `beforeEncode` or parameter encoding, with `result.outcome` `'failed'`, `latencyMs: 0` and `source: 'driver'`. A middleware that counts statements or latencies checks `result.outcome` if it should skip them.

### Replace `afterTransaction` with `activityFinalized`

`afterTransaction(plan, result, ctx)` becomes `activityFinalized(activity, result, ctx)`. A statement still running when its transaction ends is finalized when it ends, after its `activityEnded`, where `afterTransaction` fired at the transaction's end, before the statement's after-hook. `result.outcome` keeps its three values, `'committed'`, `'rolled-back'` and `'unknown'`, and the same rules decide it. An error thrown from it is still logged and swallowed. It also fires for transactions, after their statements, so a middleware that acts on statements checks `activity.kind === 'statement'`. A statement that fails before it runs, in `beforeCompile`, `beforeEncode` or parameter encoding, is now finalized too: `unknown` outside a transaction, and with the transaction's outcome inside one.

### Rename the context type and the execution id

`RuntimeMiddlewareContext` is now `ActivityContext`, and `SqlMiddlewareContext` and `MongoMiddlewareContext` extend it. A SQL middleware imports `SqlMiddleware` and `SqlMiddlewareContext` from `@prisma/orm-postgres/family-runtime` (or `@prisma/orm-sqlite/family-runtime`), a Mongo middleware imports `MongoMiddleware` and `MongoMiddlewareContext` from `@prisma/orm-mongo/family-runtime`, and a cross-family middleware imports `CrossFamilyMiddleware` and `ActivityContext` from `@prisma/orm-framework/components/runtime`. `ctx.planExecutionId` is removed; use `activity.id`, a fresh id for each activity that every hook of the activity sees. A log detail or field that carried `planExecutionId: ctx.planExecutionId` becomes `activityId: activity.id`. Keep per-statement state in `ctx.state(key)` instead of a `WeakMap` keyed by the plan: each activity has its own state, and middleware that use the same key share the object. `AfterQueryResult`, `AfterExecuteResult` and `AfterTransactionResult` are removed; use `ActivityEndedResult` and `ActivityFinalizedResult`.

### Abort phases and already-aborted calls

A `RUNTIME.ABORTED` error raised during the middleware stage before encoding has `details.phase` `'beforeEncode'`. Code that matches `'beforeQuery'` or `'beforeExecute'` matches `'beforeEncode'` instead. The same holds for the Mongo error `RUNTIME.CONTENT_HASH_REQUIRES_RESOLVED_COMMAND`, raised when a Mongo `beforeEncode` hook calls `ctx.contentHash`: its `details.phase` is `'beforeEncode'`. A call whose signal was aborted before it was made now fires `activityStarted`, then ends `failed`, before it rejects with `RUNTIME.ABORTED`.

### The observed-row budget now runs

`budgets()` now counts the rows each query returns. Before, this check never ran, so a query that returned more than `maxRows` rows succeeded. Now, with the default row severity `'error'` or in `strict` mode, such a query fails with `BUDGET.ROWS_EXCEEDED` once the count passes `maxRows`; with `severities: { rowCount: 'warn' }` in `permissive` mode it logs one warning for the statement and keeps streaming. The `postgres()` client runs its runtime in `strict` mode, where every `budgets()` violation throws whatever its severity, so the warn path does not apply there until the client exposes `mode`. Raise `maxRows` for reads that are expected to return more rows. `tableRows` and `defaultTableRows` only change the estimate checked before a read runs; they do not change the limit on rows a read actually returns.

## Statements decide placeholders and type changes

A Postgres or SQLite project that changes a field's type so that values may not survive, adds a required field to a table with rows, or makes an optional field required, plans differently.

For each script, CI job or documented workflow that runs `prisma migration plan` or `prisma db update` without a terminal:

1. If it changes a field's type, add `--convert <Model.field>` to `migration plan` and write the conversion into the `using: placeholder('<Model.field>:convert')` slot of the written `migration.ts` as SQL text over the column, such as `using: '"age"::integer'` (on SQLite, the column's copy expression in `recreateTable`, such as `copyExpressions: { age: 'CAST("age" AS INTEGER)' }`), then run `node <package dir>/migration.ts`. Or add `--delete <Model.field>` to accept the database's cast. `db update` accepts only `--delete`.
2. If it adds a required field to a table with rows, or makes an optional field required, and relied on the backfill step `migration plan` used to write, add `--backfill <Model.field>`. Without it the existing rows get a temporary value, or, for a field made required, the apply fails when rows hold NULL. A new unique, primary-key or foreign-key field, or one whose values come from a value set, has no temporary value: use `--backfill` when the table has rows. Fill the slots the plan writes, then run `node <package dir>/migration.ts`. On Postgres, `check` returns a query that finds a row still without a value, and `run` is one closure, or an array of closures, each returning one update (not one closure returning an array): `check: () => db.public.user.select('id').where((f, fns) => fns.eq(f.name, null)).limit(1)` and `run: () => db.public.user.update({ name: '' }).where((f, fns) => fns.eq(f.name, null))`, with `db` the `sql` of `postgres<End>({ contractJson: endContract })`. On SQLite there is only `run`, a closure that returns the SQL text of one statement: ``run: () => `UPDATE "User" SET name = 'user ' || id WHERE name IS NULL` ``.
3. If it parses the failure of such an apply, match the new summary, for example `3 rows of "Item" hold NULL in "note", so it cannot become required.`

## `alterColumnType` takes the new type and the conversion directly

A hand-written Postgres migration that changes a column's type called `alterColumnType` with an `options` object that carried internal names:

```ts
this.alterColumnType({
  schema: 'public',
  table: 'user',
  column: 'age',
  options: {
    qualifiedTargetType: 'int4',
    formatTypeExpected: 'integer',
    rawTargetTypeForLabel: 'int4',
    using: '"age"::integer',
  },
}),
```

It now takes the new type and the conversion directly:

```ts
this.alterColumnType({
  schema: 'public',
  table: 'user',
  column: 'age',
  type: 'int4',
  using: '"age"::integer',
}),
```

A `migration.ts` that still passes `options` stops with `MIGRATION.OPERATION_OPTION_REMOVED` when it runs, naming the column and the new shape.

For each `migration.ts` the detection matches:

1. Replace `options: { ... }` with `type: <the value of qualifiedTargetType>`, and `using: <the value of options.using>` when the old call had one.
2. Delete `formatTypeExpected` and `rawTargetTypeForLabel`. The operation now works out the type the database prints from `type`, through the data types of the configured stack. A type it cannot read fails with `MIGRATION.COLUMN_TYPE_UNREADABLE`, which names the call. Write the type as a migration writes it, such as `int4`, `varchar(20)`, or `"Mood"` for an enum, or add the extension that provides it to the configuration.
3. Check `operationClass`. Left out, it is now `data` when the call has a `using`, and `destructive` otherwise. A call with a `using` that said `operationClass: 'destructive'` keeps that class only if you keep the option; delete it to class the conversion as `data`. A call that said `operationClass: 'widening'` keeps it.
4. Check `using`. A semicolon, a SQL comment or dollar quoting outside a quoted literal, or a comma or a keyword such as `FROM` or `UNION` outside parentheses, now fails with `MIGRATION.SQL_EXPRESSION_INVALID`, which names the call. `FROM` directly after `DISTINCT`, as in `IS DISTINCT FROM`, is accepted. Remove a trailing comment. If the expression holds a comma or a keyword such as `FROM` at the top level, wrap it in parentheses.
5. If the migration has not been applied to any database, run it (`node <package dir>/migration.ts`) to write `ops.json` and `migration.json` again. If it has been applied, leave those two files as they are: the operation's label now names the type as written in `type`, so writing them again would change the migration's hash.

## MongoDB carries out `--rename` and `--delete`

### `mongo-rename-statements-carried-out`

`--rename` now works on MongoDB, with the same syntax as on SQL. A field is named by its contract key, which on MongoDB is its stored name: `id @map("_id")` is `User._id`.

```sh
prisma migration plan --name tidy --rename Profile:User --rename User.name:User.fullName
prisma db update --rename Profile:User --rename User.name:User.fullName
```

- A model rename whose collection name changes renames the collection (`renameCollection`), keeping its documents, indexes and validator.
- A field rename renames the field in every document that holds it (`renameField`), skipping validation. A variant's field is renamed only in that variant's documents.
- The planner refuses, with the reason and what to do instead: a variant rename whose discriminator value changes, `_id`, a field whose stored name contains `.` or starts with `$`, a time-series collection, a target collection that already exists or that MongoDB rejects, and a collection whose control policy is not `managed`. A field removed from a model whose collection is not `managed` is not asked about and not removed.

If you renamed a collection or a field by hand in `mongosh` because `--rename` was refused, nothing changes for migrations you already applied. From now on, give the `--rename` statement instead.

A script or test that expects `--rename` on MongoDB to fail with `MIGRATION.PLANNING_FAILED` now gets a plan. A script that reads `meta.unanswered` of `CLI.CONSENT_REQUIRED` for a dropped MongoDB collection now finds `verbs: ['rename', 'delete']` instead of `['delete']`.

### `mongo-removed-field-asks`

Removing a field from a MongoDB model used to update the collection's validator and ask nothing. Documents that still held the field then failed every update with `Document failed validation`. Now the plan removes the field from those documents (`unsetField`, a `destructive` operation) and asks first. Where nobody can answer, the command fails with `CLI.CONSENT_REQUIRED`, whose next actions name `--delete User.nickname` and `--rename 'User.nickname:User.<new name>'`.

In a script or CI job that runs `prisma db update --no-interactive` or `prisma migration plan` after a field was removed, add `--delete <Model>.<field>` for each removed field, or `--rename` if the field was renamed. When `db update` has no snapshot of the contract the database is at, the field is named by its collection: `--delete profiles.nickname`.

### `mongo-preview-get-collection`

A test or a script that compares the preview of a MongoDB plan (`migration plan`, `db update --dry-run`, `migration show`) expects `db.getCollection("<name>")` in place of `db.<name>`, so a collection name such as `my-coll` is valid `mongosh`. Plans and `ops.json` are unchanged.

### `mongo-time-series-update`

A repeated `db update` on a database whose contract declares a time-series collection used to fail with "Cannot change immutable collection option 'timeseries'", because MongoDB adds defaults such as `bucketMaxSpanSeconds` that the contract leaves out. The planner now compares only the options the contract declares, so the command succeeds and plans nothing. A workaround that skipped `db update` for such a database is no longer needed.

### `storage-question-wording`

A test that asserts the text of a data-loss question about data named by its storage name expects `--delete loses that data` where it expected `--delete loses its rows`.

### `migration-ts-finds-its-config`

Without `--config`, `node migration.ts` now picks the config that owns the migration: a config owns it when the migration file is inside that config's `migrations.dir`. It tries the nearest `prisma.config.ts` above the migration's directory first, then the `prisma.config.ts` in the working directory. So the file runs from inside its own directory, from the project directory, or from any other directory, and with `migrations.dir` outside the project, such as `../shared-db/migrations`, when run from the project directory. If neither config owns the migration, it fails with `CLI.MIGRATION_CONFIG_NOT_FOUND`, naming the configs it checked; run it with `--config <path>`. `--config` still overrides the lookup.

A command that ran the file from the project directory keeps working. A script that ran it from a directory whose `prisma.config.ts` belongs to another project, and relied on that config, now fails with `CLI.MIGRATION_CONFIG_NOT_FOUND`; pass `--config`. `migration new` and `migration plan` given `--config` now repeat it in the `node` command they print. Messages that tell you to run a `migration.ts` say to run it with node, without a path or a working directory.

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the extension's embedded `version` moving to `8.0.0-rc.18`; any other difference in the emitted files comes from an earlier entry in this guide.
