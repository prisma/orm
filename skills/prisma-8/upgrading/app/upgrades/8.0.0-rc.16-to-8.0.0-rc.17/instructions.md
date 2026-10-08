---
from: "8.0.0-rc.16"
to: "8.0.0-rc.17"
changes:
  - id: ts-enum-members-written-as-stored
    summary: |
      `defineContract` from the Postgres package now refuses a `pg/numeric@1` enum member written with a leading zero or as negative zero, such as "01.5" or "-0", and a `pg/inet@1` member Postgres prints differently, such as "10.0.0.1/32" or "::FFFF:10.0.0.1", with `CONTRACT.ENUM_INVALID`. The message says the text to write. An inet member that is not an address is refused too. Rewrite each refused member, re-emit, and apply a migration that replaces the enum's CHECK constraint.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\benumType\('
  - id: psl-enum-members-written-as-stored
    summary: |
      A PSL enum block is now refused at `contract emit` with `PSL_EXTENSION_INVALID_VALUE` when a member is not written as its codec stores it. On Postgres this covers `@@type("pg/numeric@1")`, `@@type("pg/inet@1")`, `@@type("pg/int8@1")`, `@@type("pg/int8number@1")` and `@@type("pg/unboundedint@1")`, with members such as "01.5", "-0", "10.0.0.1/32", "::FFFF:10.0.0.1", "007", or an inet member that is not an address. On SQLite it covers `@@type("sqlite/bigint@1")`, `@@type("sqlite/bigintnumber@1")`, `@@type("sqlite/integer@1")` and `@@type("sql/int@1")`, with members such as "007" or "-0". The message says the text to write. Rewrite each refused member and re-emit. A numeric or inet enum's CHECK constraint changes, so apply a migration that replaces it; an integer enum's contract is unchanged.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@@type\(\s*"pg/(?:numeric|inet|int8|int8number|unboundedint)@1"\s*\)'
        - '@@type\(\s*"(?:sqlite/(?:bigint|bigintnumber|integer)|sql/int)@1"\s*\)'
  - id: numeric-inet-defaults-stored-normalised
    summary: |
      A numeric default written with a leading zero or as negative zero in a TypeScript `.default()`, and an inet default written in a form Postgres prints differently, in PSL or in a TypeScript `.default()`, are now stored as Postgres prints them, so emitting the contract again changes its storage hash. An inet default that is not an address is now refused. Earlier versions could not apply most such contracts: the command that applied them failed and changed nothing. Emit the contract again, then run that command again.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '\bInet\b[^\n]*@default\('
        - '@db\.Inet\b[^\n]*@default\(|@default\([^\n]*@db\.Inet\b'
        - '\.default\(\s*[''"`]-?0(?:\d|\.0*[''"`]|[''"`])'
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)[\s\S]*?(?:[''"]pg/inet@1[''"]|\bpgInetColumn\b)'
  - id: enum-codecs-refused
    summary: |
      An enum typed by `pg/timestamp-string@1`, `pg/timestamptz-string@1`, `pg/bytea@1` or `pg/tsquery@1` is now refused: `defineContract` from the Postgres package refuses its `enumType` with `CONTRACT.ENUM_INVALID`, and PSL refuses its `@@type` with `PSL_EXTENSION_INVALID_VALUE`. No value a query reads back can equal a member of such an enum, and a bytea enum column's CHECK constraint refused every member. Type a string timestamp enum with `pg/timestamp-temporal@1` or `pg/timestamptz-temporal@1` and write its members as Temporal values; replace a bytea or tsquery enum with a text enum. On MongoDB, `defineContract` now refuses an `enumType` typed by `mongo/json@1` or `mongo/bson@1` with `CONTRACT.ENUM_INVALID`; type it with `mongo/string@1`.
    detection:
      glob: "**/*.{prisma,ts,tsx,mts,cts}"
      matches:
        - '@@type\(\s*"pg/(?:timestamp(?:tz)?-string|bytea|tsquery)@1"\s*\)'
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)[\s\S]*?(?:[''"]pg/timestamp(?:tz)?-string@1[''"]|\b(?:PG_TIMESTAMP(?:TZ)?_STRING_CODEC_ID|pgTimestamp(?:tz)?StringColumn)\b)'
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)(?=[\s\S]*\benumType\()[\s\S]*?(?:[''"]pg/(?:bytea|tsquery)@1[''"]|\b(?:PG_BYTEA_CODEC_ID|PG_TSQUERY_CODEC_ID|pgByteaColumn)\b)'
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)(?=[\s\S]*\benumType\()[\s\S]*?(?:[''"]mongo/(?:json|bson)@1[''"]|\bMONGO_(?:JSON|BSON)_CODEC_ID\b)'
  - id: enum-json-codec-refused
    summary: |
      An enum typed by `pg/json@1` is now refused: `defineContract` refuses its `enumType` with `CONTRACT.ENUM_INVALID`, and PSL refuses its `@@type("pg/json@1")` with `PSL_EXTENSION_INVALID_VALUE`. The `json` type has no equality operator, so a scalar column never applied and a list column's new CHECK constraint refuses every insert. Type the enum with `pg/jsonb@1` and re-emit.
    detection:
      glob: "**/*.{prisma,ts,tsx,mts,cts}"
      matches:
        - '@@type\(\s*"pg/json@1"\s*\)'
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)(?=[\s\S]*\benumType\()[\s\S]*?(?:[''"]pg/json@1[''"]|\b(?:PG_JSON_CODEC_ID|jsonColumn)\b)'
  - id: enum-list-check-compares-in-column-type
    summary: |
      The CHECK constraint on a Postgres list column typed by an enum now compares each element with the members in the column's own type, not as text, so an inet enum list takes a host address such as "127.0.0.1". The constraint's expression and name change, so re-emit the contract and apply a migration that replaces the constraint.
    detection:
      glob: "**/contract.json"
      matches:
        - '::(?:text|numeric)\[\](?:, NULL\))? <@ ARRAY\['
  - id: integer-text-in-contract-json-refused
    summary: |
      A `contract.json` value on a SQLite integer codec or on `mongo/int64@1` or `mongo/int64Number@1` that is digit text with a leading zero or a minus sign on zero, such as "007" or "-0", now fails to load with `RUNTIME.DECODE_FAILED`, naming the text to write. `contract emit` never wrote such a value, so only a hand-written or edited `contract.json` is affected. Rewrite the value as the message says, or re-emit the contract.
    detection:
      glob: "**/contract.json"
      matches:
        - '(?<![\s\S])(?=[\s\S]*"(?:sqlite/(?:bigint|bigintnumber|integer)|sql/int|mongo/int64(?:Number)?)@1")[\s\S]*"(?:-0|-?0\d+)"'
  - id: db-enums-members-hold-read-values
    summary: |
      `db.enums` now holds each enum member as a query returns it, where it used to hold the member as `contract.json` stores it. A member changes wherever its codec's stored JSON form is not the application value: bigint codecs, codecs that read decimal text as a number, date, time, timestamp and interval codecs, byte codecs, and non-finite float members, written as "NaN", "Infinity" or "-Infinity". `has()`, `nameOf()` and `ordinalOf()` find a value equal to a member, such as a value read from the database, and no longer find the stored form. Remove any conversion your code applied to these members or to values before passing them to `has()`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\benums\s*(?:\.|\[)'
  - id: float-enum-columns-type-non-finite-members-as-number
    summary: |
      On Postgres, a column typed by a float enum (`pg/float4@1`, `pg/float8@1`, `pg/float@1`) that has a NaN, Infinity or -Infinity member is now typed `number` in `contract.d.ts`, where it was a union of the strings "NaN", "Infinity" and "-Infinity". Re-emit the contract and write those members as numbers.
    detection:
      glob: "**/contract.json"
      matches:
        - '"codecId"\s*:\s*"pg/float(?:4|8)?@1"[\s\S]*"(?:NaN|-?Infinity)"'
  - id: psl-enum-bson-types-refused
    summary: |
      A Mongo PSL enum whose codec stores a BSON type that has no JSON value, such as `mongo/int64@1`, `mongo/int64Number@1`, `mongo/date@1`, `mongo/objectId@1`, `mongo/decimal128@1`, `mongo/binary@1` or `mongo/vector@1`, is now refused at `contract emit` with `PSL_EXTENSION_INVALID_VALUE`, and so is a `mongo/double@1` member written as "NaN", "Infinity" or "-Infinity". The collection validator listed such members in their JSON forms and refused every write of those fields. Change the enum to a codec whose BSON type is string, int, double, bool, object or array, or author the enum in a TypeScript contract, which has no collection validator.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@@type\(\s*"mongo/(?:int64|int64Number|date|objectId|decimal128|binary|vector)@1"'
        - '@@type\(\s*"mongo/double@1"\s*\)[^}]*"(?:NaN|-?Infinity)"'
  - id: mongo-orm-takes-enum-accessors
    summary: |
      `mongoOrm()` and `createMongoCollection()` from `@prisma/orm-mongo/orm` now require the contract's enum accessors, which they check a written enum value against. Build them with `buildMongoEnums(contract, context.codecs)` from `@prisma/orm-mongo/family-runtime` and pass them as `enums`: `mongoOrm({ contract, executor, enums })`, and `createMongoCollection(contract, model, executor, enums, mutationDefaults)`, whose accessors come before the optional `mutationDefaults`. Clients built with `mongo()` need no change.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\b(?:mongoOrm|createMongoCollection)\s*(?:<[^>]*>)?\s*\('
  - id: contract-dts-enum-member-types
    summary: |
      An emitted `contract.d.ts` now gives every namespace that declares enums an `enumMemberTypes` entry, which types each member as `db.enums` holds it. Re-emit the contract. `contract.json`, every hash and migration snapshots are unchanged.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - 'readonly enum: \{'
  - id: prisma7-schema-states-constraint-names
    summary: |
      A contract from `prisma7Schema(...)` now states the name of each primary key and foreign key whose Prisma 7 name differs from the name Prisma 8 derives: a `map` on `@id`, `@@id` or `@relation`, the primary key of an implicit many-to-many junction (`_PostToTag_AB_pkey`), and a foreign key name Prisma 7 cut to 63 bytes. A contract with any of these gets a new storage hash. Re-emit, then re-sign, plan a migration, or run `db update`, depending on who manages each database.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma7Schema\s*\('
  - id: foreign-keys-name-their-backing-index
    summary: |
      Each foreign key in `contract.json` now states what backs it in a new `index` field: `{ "name": "<index>" }` for an index, `{ "primaryKey": true }` for the primary key, or `{ "unique": ["<column>", …] }` for a unique constraint by its columns, each one whose first columns are its columns, absent for `index: false`. Every SQL contract with a foreign key gets a new storage hash, and so does the Supabase extension's contract space. Re-emit the contract. When `prisma migration plan` then finds nothing to change in the database, follow its advice: write a migration with no operations with `prisma migration new --from <hash>`, or run `prisma db sign` on a database you manage with `prisma db init` or `prisma db update`.
    detection:
      glob: "**/contract.json"
      matches:
        - '"foreignKeys"\s*:\s*\[\s*\{'
  - id: partial-or-typed-index-no-longer-backs-a-foreign-key
    summary: |
      A relation used to get no backing index when its table had any index on the same columns, including a partial index (`where:`), an index with a non-default `type` such as `hash` or `gin`, or one with `options`. Such an index does not serve every lookup a foreign key needs, so the relation now gets its own backing index, and `prisma migration plan` creates it. An index with `type: "btree"` and no options or predicate still counts as the same index. To keep the database as it is, point the relation at your index with `index: "<name>"`, or opt out with `index: false`.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - '@@index\([^)]*\b(?:where|type|options)\s*:'
        - 'constraints\.index\([^)]*\b(?:where|type|options)\s*:'
  - id: unnamed-index-on-unique-columns-left-out
    summary: |
      An `@@index` without `name` or `map`, with no `where`, `options` or non-default `type`, whose columns are exactly those of a unique constraint, a unique index or the primary key, is now left out of the contract, because the unique one already serves its lookups. `prisma migration plan` drops it from the database. To keep it, give it a `name` or `map`; `prisma contract emit` then warns that it duplicates the unique one.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - '@@index\(\s*\[[^\]]*\]\s*\)'
        - 'constraints\.index\(\s*\[[^\]]*\]\s*\)'
  - id: infer-and-print-write-the-relation-index-argument
    summary: |
      `prisma contract infer` now writes `index: false` on a relation whose only index on its columns is partial, has a non-default type (such as `hash` or `gin`) or has options, where it used to write nothing, and `index: "<name>"` on a relation whose columns lead a named key or a plain index with more columns, where it used to write `index: false`. `prisma contract print` writes `index: "<name>"` on a relation backed by such an index, nothing on a relation backed by its default index or a key, and `index: false` only where nothing backs the foreign key. Re-running either command can change the `@relation` lines it writes; review the diff.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@relation\([^)]*\bindex\s*:'
  - id: mongo-index-sort-function
    summary: Replace MongoDB PSL field sort modifiers with sort(field, direction).
  - id: non-data-drops-are-widening
    summary: |
      Dropping an index, a unique or foreign-key constraint, a check, a row-level-security policy, a default or a native enum type, and disabling row-level security, are now `widening` operations on Postgres and SQLite. They no longer count as data loss, so `prisma db update` and `prisma migration plan` do not ask about them as data loss; `db update` asks about the row-level-security changes as access changes instead. `--confirm` no longer consents to anything; see `db-update-confirm-no-longer-consents` and `migration-plan-refuses-data-loss`.
    detection:
      glob: "**/*.{sh,bash,zsh,yml,yaml,json,toml,mjs,cjs,js,ts,mts,cts}"
      matches:
        - '(?<![\w-])--confirm(?![\w-])'
  - id: rename-statements
    summary: |
      `prisma migration plan` and `prisma db update` accept `--rename <old>:<new>`, repeatable, to rename a model or a field instead of dropping and creating its table or column. Each side is `Model`, `namespace.Model`, `Model.field` or `namespace.Model.field`, and a field's model is named as the new contract names it: `--rename Profile:User --rename User.name:User.fullName`.
  - id: destructive-means-data-loss
    summary: |
      An operation is `destructive` only when it can lose rows or values. Postgres `setNotNull` and the type changes that keep every value (`int2` to `int4` to `int8`, `float4` to `float8`), a SQLite table rebuild that only changes nullability, and MongoDB `dropIndex`, `setValidation`, `collMod` and the planner's validator and change-stream image changes are now `widening`. Running an existing `migration.ts` again writes `widening` for these operations in `ops.json`, and a new `migrationHash`.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\bsetNotNull\('
        - '(?<![\w$.])(?:dropIndex|setValidation|collMod)\('
  - id: migration-plan-refuses-data-loss
    summary: |
      `prisma migration plan` refuses every plan that would lose data, not only an auto-baseline, until each operation that would is answered: `--delete <subject>` lets the data go, `--rename <subject>:<new name>` keeps it. Where nobody can answer it fails with `CLI.CONSENT_REQUIRED`, whose `nextActions` name the flags. `--confirm` answers none of these questions.
    detection:
      glob: "**/*.{sh,bash,zsh,yml,yaml,json,toml,mjs,cjs,js,ts,mts,cts}"
      matches:
        - '(?<![\w-])migration\s+plan(?![\w-])'
  - id: db-update-confirm-no-longer-consents
    summary: |
      `prisma db update --confirm <database>` no longer consents to data loss. An apply asks about each operation that would lose data, answered by `--delete <Model|Model.field>` or `--rename`, and about each that would widen who can read or write a model's rows, answered by `--allow <Model>`. Without them it fails with `CLI.CONSENT_REQUIRED` where nobody can answer.
    detection:
      glob: "**/*.{sh,bash,zsh,yml,yaml,json,toml,mjs,cjs,js,ts,mts,cts}"
      matches:
        - 'db\s+update(?:[^\n\\]|\\\r?\n|\\.)*(?<![\w-])--confirm(?![\w-])'
  - id: db-update-reads-origin-snapshot
    summary: |
      `prisma db update` reads the snapshot of the contract the database is at on every run, to name what an operation would lose. Nothing to change.
  - id: control-api-answer-questions
    summary: |
      In `@prisma/orm-toolchain/cli/control-api`, `executeMigrationPlanCommand` and `executeDbUpdate`, and the control client's `dbUpdate`, require an `answerQuestions` callback; `consent` and `carryEmittedExtensionDirs` are gone. `delete` and `allow` statements in `statements` answer questions without asking, and one that answers none fails with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`. `acceptDataLoss: true` no longer answers access-widening questions; `acceptAccessWidening: true` does.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])(?:executeMigrationPlanCommand|executeDbUpdate)\s*\('
        - '\.dbUpdate\s*\('
        - '(?<![\w$])carryEmittedExtensionDirs(?![\w$])'
  - id: applied-statement-report-verb
    summary: |
      `AppliedStatementReport` from `@prisma/orm-toolchain/cli/control-api` is a union discriminated by `verb` (`rename`, `delete` or `allow`), and `StatementVerb` is `'rename' | 'delete' | 'allow'`. Narrow on `verb === 'rename'` before reading a rename's `statement`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:AppliedStatementReport|StatementVerb)(?![\w$])'
  - id: consent-errors-removed
    summary: |
      `ERROR_CODE_DESTRUCTIVE_CHANGES`, `errorDestructiveChanges`, `ERROR_CODE_CONSENT_PLAN_MISMATCH` and `errorConsentPlanMismatch` are removed from `@prisma/orm-framework/errors/execution`; `DbUpdateFailureCode` loses `'DESTRUCTIVE_CHANGES'` and `'CONSENT_PLAN_MISMATCH'`, and `DbUpdateFailure` loses `destructiveChanges` and `consentPlanMismatch`. The codes `MIGRATION.DESTRUCTIVE_CHANGES`, `MIGRATION.CONSENT_PLAN_MISMATCH`, `CLI.CONSENT_TOKEN_UNRESOLVED` and `CLI.CONSENT_OPERATIONS_MISSING` are no longer raised.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs,sh,bash,zsh,yml,yaml,json}"
      matches:
        - '(?<![\w$])(?:ERROR_CODE_DESTRUCTIVE_CHANGES|errorDestructiveChanges|ERROR_CODE_CONSENT_PLAN_MISMATCH|errorConsentPlanMismatch|destructiveChanges|consentPlanMismatch)(?![\w$])'
        - '(?<![\w])(?:DESTRUCTIVE_CHANGES|CONSENT_PLAN_MISMATCH|CONSENT_TOKEN_UNRESOLVED|CONSENT_OPERATIONS_MISSING)(?![\w])'
  - id: collection-apply-is-now-with
    summary: |
      The collection method `apply(fn)` is renamed to `with(fn)`. Rename every call on a collection of the SQL ORM client, such as `db.orm.public.Post.apply(notDeleted)` or `posts.apply((p) => p.limit(10))`, to `.with(...)`. The detection matches `.apply(` only when its first argument is a name followed by `)`, `(` or `=>`, or an arrow function, because `Function.prototype.apply` (`fn.apply(this, args)`) and `Reflect.apply` share the name; it can still match a `Function.prototype.apply` call with one argument. Rename only where the receiver is a collection.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.apply\s*\(\s*(?:\(|[A-Za-z_$][\w$.]*\s*(?:\)|\(|=>))'
  - id: with-is-a-collection-member
    summary: |
      Every collection now has a `with` method instead of `apply`. A custom collection class that declares its own `with` member with another signature no longer compiles; rename it. An aggregate operation named `with` is refused with `ORM.AGGREGATE_OPERATION_RESERVED`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|private|readonly|static|async|override)\s+)*with\s*[(<:=?]'
  - id: orm-scope-is-now-fragment
    summary: |
      The SQL ORM client's `scope` methods are renamed to `fragment`: `db.orm.scope(fields, body)` is now `db.orm.fragment(fields, body)`, and `collection.scope(body)`, such as `db.orm.public.Post.scope(...)`, is now `collection.fragment(body)`. Rename each use whose receiver is the ORM client or a collection, including `typeof db.orm.scope` and `const { scope } = db.orm`. The detection matches every `.scope(` call; leave calls on other objects as they are.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.scope\s*[(<]'
        - '\btypeof\s+[\w$.]*\.scope\b'
        - '\{[^}]*\bscope\b[^}]*\}\s*=\s*[\w$.]*\borm\b'
  - id: orm-scope-types-are-now-fragment-types
    summary: |
      The types `Scope`, `FieldScope` and `ScopeFacts` exported by the SQL ORM client (`@prisma/orm-postgres/orm-client` and the other facades' `orm-client` entries) are renamed to `Fragment`, `FieldFragment` and `FragmentFacts`. The SQL builder's own `Scope` and `ScopeField` types are a different thing and keep their names; the detection matches `Scope` only in an import or re-export from an `orm-client` entry, or after a namespace import of one.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(?:FieldScope|ScopeFacts)\b'
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\bScope\b[^}]*\}\s*from\s*[''"]@prisma/[\w-]+/orm-client[''"]'
        - 'import\s+(?:type\s+)?\*\s+as\s+([\w$]+)\s+from\s*[''"]@prisma/[\w-]+/orm-client[''"][\s\S]*\b\1\.Scope\b'
  - id: fragment-is-a-collection-member
    summary: |
      Every collection now has a `fragment` method instead of `scope`. A custom collection class that declares its own `fragment` member with another signature no longer compiles; rename it. An aggregate operation named `fragment` is refused with `ORM.AGGREGATE_OPERATION_RESERVED`. The name `scope` is free again. The detection matches a member named `fragment` only in a file that extends `Collection`, and an aggregate operation declared as `operation: 'fragment'`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bextends\s+Collection\b)[\s\S]*\n[ \t]*(?:(?:public|protected|private|readonly|static|async|override|get|set)\s+)*fragment\s*(?:\?\s*)?[(<:=]'
        - '\boperation\s*:\s*[''"]fragment[''"]'
  - id: namespace-named-fragment-hides-the-client-method
    summary: |
      A contract namespace named `fragment` now takes the name of the client's `fragment` method, so `db.orm.fragment` is that namespace and the client has no method to make a fragment for any model; code that called `db.orm.scope(fields, body)` with such a contract must make its fragments another way. A namespace named `scope` no longer hides anything.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?:^|\n)[ \t]*namespace\s+fragment\b'
  - id: fragment-error-texts
    summary: |
      Errors and compile errors about these functions say "fragment" where they said "scope", such as `Cannot define the fragment: the body is not a function` and `Pass the fragment to with on a collection: collection.with(fragment).` Update tests that assert on the old text.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'Cannot (?:define|apply) (?:the|a) scope|Pass the scope to with|Run the scope with apply|A scope (?:passed to with|applied with apply)|The scope was (?:made|declared)|the scope could not read the model|declaration in the scope'
  - id: orm-collections-lock-rows
    summary: "ORM collections gain forUpdate(), forNoKeyUpdate(), forShare() and forKeyShare(), which need the same capability keys as the SQL builder's row-locking methods and also sql.lockOf; a contract emitted before this release does not carry them and the methods are unavailable against it, so re-emit the contract before using them."
    detection:
      glob: "**/contract.json"
      contains:
        - '"distinctOn"'
  - id: contract-artifacts-restamp
    summary: |
      An extension that writes its own package version into the contracts it emits, such as the
      Supabase extension, now writes 8.0.0-rc.17. Run `contract emit` once after upgrading so the
      emitted `contract.json` and `contract.d.ts` match the installed extension.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.16"'
---

# 8.0.0-rc.16 → 8.0.0-rc.17 — User upgrade instructions

## `ts-enum-members-written-as-stored`

A value in a contract now decodes to the value a query returns for it, so where Postgres normalises a value's text, the contract stores the normalised text. Postgres reads `01.5` as a `numeric` and prints `1.5`, and reads `10.0.0.1/32` as an `inet` and prints `10.0.0.1`. An enum member written the first way was stored that way in `contract.json` and in the enum's CHECK constraint, so `db.enums.<namespace>.<Enum>.has(row.value)` was false for every value read back. `defineContract` now refuses such a member and says what to write:

```text
CONTRACT.ENUM_INVALID: enumType("Ratio"): member "Half" is written "01.5", but the column stores "1.5". Write the member as "1.5".
```

Refused members:

- On `pg/numeric@1`, a member with a leading zero (`"01.5"`, `"007"`) or written as negative zero (`"-0"`, `"-0.00"`). Write it without the leading zeros or the minus sign: `"1.5"`, `"7"`, `"0"`, `"0.00"`. Trailing zeros stay, because Postgres keeps them on a `numeric` with no scale.
- On `pg/inet@1`, an IPv4 host address with `/32`, an IPv6 host address with `/128`, IPv6 with an upper-case hex digit, IPv6 with zeros Postgres compresses (`2001:db8:0:0:0:0:0:1` is `2001:db8::1`), or an IPv4-mapped address written in hex (`::ffff:a00:1` is `::ffff:10.0.0.1`). Write it as the message says.
- On `pg/inet@1`, a member that is not an address, refused with `pg/inet@1 JSON value must be an IP address as PostgreSQL writes it`.

1. Run `prisma contract emit`, or run the code that calls `defineContract`. Each refused member is reported with the value to write. The detection for this change looks for calls to `enumType(`; if you import it under another name, search for that name, and look for enums typed by `pg/numeric@1` or `pg/inet@1`.
2. Rewrite each refused member as the message says. Code that reads members through the enum, such as `db.enums.public.Ratio.members.Half`, needs no change. Code that compares a value with the old spelling does.
3. Re-emit. The enum's membership CHECK constraint's expression changes, and its name is derived from its expression, so the storage hash and the constraint's name both change. Plan and apply a migration: it drops the old CHECK constraint and adds the new one. Dropping a CHECK constraint is a `widening` operation, so the plan asks no question about it; see `non-data-drops-are-widening`.

Creating a client from a `contract.json` emitted by an earlier version that still holds such a member fails with `RUNTIME.DECODE_FAILED`, because `db.enums` reads every member through its codec. Re-emit the contract with this version first.

## `psl-enum-members-written-as-stored`

The same rule holds in PSL. An enum block typed by `pg/numeric@1`, `pg/inet@1`, `pg/int8@1`, `pg/int8number@1` or `pg/unboundedint@1` whose member is not written as Postgres prints it is refused at `contract emit`:

```text
PSL_EXTENSION_INVALID_VALUE: enum "Ratio" member "Half" was rejected by codec "pg/numeric@1": pg/numeric@1 JSON value must be "1.5", as PostgreSQL writes this value
```

Rewrite each member as the message says.

- For a numeric or inet enum, the contract held the member as written, so follow steps 2 and 3 of `ts-enum-members-written-as-stored`.
- For an enum typed by `pg/int8@1`, `pg/int8number@1` or `pg/unboundedint@1`, such as a member written `"007"` or `"-0"`, earlier versions stored it as Postgres prints it, `"7"` or `"0"`. Write it that way and re-emit; `contract.json`, the CHECK constraint and every hash are unchanged. The message for these codecs ends `the integer's decimal text without leading zeros or a minus sign on zero`.

On SQLite, the integer codecs store an integer as digit text, and now read only the integer's decimal text: no leading zeros and no minus sign on zero. A PSL enum member written another way is refused:

```text
PSL_EXTENSION_INVALID_VALUE: enum "BigLevel" member "Low" was rejected by codec "sqlite/bigint@1": sqlite/bigint@1 JSON value must be "7", the integer's decimal text without leading zeros or a minus sign on zero
```

Earlier versions stored such a member in that form, so rewrite it as the message says, `"7"` for `"007"` and `"0"` for `"-0"`, and re-emit. `contract.json`, the CHECK constraint and every hash are unchanged.

## `numeric-inet-defaults-stored-normalised`

A default is converted rather than refused, as a uuid default already is:

| Written | Stored |
| --- | --- |
| `.default('01.5')` on `pg/numeric@1` | `"1.5"` |
| `.default('-0')` on `pg/numeric@1` | `"0"` |
| `@default("10.0.0.1/32")` on `Inet`, or `.default('10.0.0.1/32')` on `pg/inet@1` | `"10.0.0.1"` |
| `@default("::FFFF:10.0.0.1")` on `Inet`, or the same `.default()` on `pg/inet@1` | `"::ffff:10.0.0.1"` |
| `@default("not an address")` on `Inet` | refused, `PSL_INVALID_LITERAL` |

A PSL numeric default was already converted: `@default(01.5)` was stored as `"1.5"`.

Earlier versions stored such a default as written, and Postgres stores the converted form, so the check that runs after the change is applied failed: `db init`, `db update` and `db migrate` stopped with `MIGRATION.RUNNER_FAILED` (`MIGRATION.SCHEMA_VERIFY_FAILED`) and rolled the change back. The database has none of the changes that contract adds, and no marker for it. With this version, a `contract.json` that still holds such a default stops `db init`, `db update` and `migration plan` with `CONTRACT.DEFAULT_INVALID`.

Emit the contract again with this version. The stored default changes, and with it the storage hash. Then:

- For a project kept with `db init` or `db update`, run the command that failed again. It applies the contract, and `db verify` then passes.
- For a project with migrations, delete the migration package that never applied: its directory under `migrations/app/`, and its contract snapshot `migrations/snapshots/<hash>/`, where `<hash>` is the `to` hash in the package's `migration.json`. Then run `prisma migration plan` and `prisma db migrate`.

One case did apply: a numeric default with a leading zero or a minus sign on zero, on a column with a precision such as `numeric(10,2)`, because earlier versions compared such a default by value. After you re-emit, the database needs no change but its marker names the old storage hash. Run `prisma db sign` for a project kept with `db init` or `db update`, or plan and apply a migration for a project with migrations.

## `enum-codecs-refused`

An enum compares a value with its members, so a codec whose values read back can never equal a member is now refused when the contract is authored. Four Postgres codecs and two MongoDB codecs are refused this way.

`pg/timestamp-string@1` and `pg/timestamptz-string@1` read a value as the text Postgres prints, such as `2024-01-02 03:04:05` or `2024-01-02 03:04:05+00`, while the contract stores ISO 8601, such as `2024-01-02T03:04:05` or `2024-01-02T03:04:05Z`. The `timestamptz` text also depends on the session's time zone. `defineContract` refuses an `enumType` typed by either codec:

```text
CONTRACT.ENUM_INVALID: enumType("Stamp"): an enum cannot use the codec pg/timestamp-string@1. A query reads each value as the text PostgreSQL prints, such as "2024-01-02 03:04:05", while the contract stores it in ISO 8601, such as "2024-01-02T03:04:05", so no value read back equals a member. Use pg/timestamp-temporal@1, whose members are Temporal values.
```

Type the enum with the Temporal codec of the same column type, `pg/timestamp-temporal@1` or `pg/timestamptz-temporal@1`, and write each member as a `Temporal.PlainDateTime` or a `Temporal.Instant`. `db.enums` then holds Temporal values and finds a value read back. Re-emit the contract; the enum's codec changes, and with it the storage hash. Plan and apply a migration, or run `prisma db sign` for a project kept with `db init` or `db update`.

`pg/bytea@1` stores a value in the contract as base64 text. The enum's CHECK constraint wrote that text as a `bytea` literal, which Postgres reads as the bytes of the text itself, so the constraint refused every member: `db init` applied the column, and every write of a member failed. `pg/tsquery@1` stores a member as written, such as `a & b`, while Postgres prints it normalised, `'a' & 'b'`, so `db.enums` never found a value read back. No enum can use either codec. Replace the enum with a text enum (`pg/text@1`) whose members name the values, and convert at the application boundary.

PSL refuses an enum block typed by any of these codecs with the same reason, as `PSL_EXTENSION_INVALID_VALUE` at its `@@type`; for the string timestamp codecs it used to report the codec as unknown.

On MongoDB, `mongo/json@1` and `mongo/bson@1` declare no equality, so a value read back cannot be compared with a member. Earlier versions accepted an `enumType` typed by either codec with string members; `defineContract` from the MongoDB package now refuses it:

```text
CONTRACT.ENUM_INVALID: enumType("Shape"): an enum cannot use the codec mongo/json@1. The codec does not declare the equality trait, so no value can be compared with a member. Use a codec that declares it.
```

Type the enum with `mongo/string@1` and re-emit the contract. The enum's codec changes, and with it the storage hash, so plan and apply a migration. MongoDB PSL already refused an enum block typed by either codec, because an enum's codec must declare exactly one BSON type, so a PSL contract needs no change.

The TypeScript detection for the bytea, tsquery, `mongo/json@1` and `mongo/bson@1` codecs matches a file that calls `enumType(` and names the codec anywhere, even on a column that is not an enum. Check only the enums.

## `enum-json-codec-refused`

The `json` type has no equality operator, so Postgres cannot compare a `json` value with an enum's members. A scalar column typed by a `pg/json@1` enum never applied: its CHECK constraint failed with `operator does not exist: json = unknown`. A list column applied, but with the CHECK constraint described under `enum-list-check-compares-in-column-type` every insert fails with `could not identify an equality operator for type json`, an empty list included. An enum typed by `pg/json@1` is now refused when the contract is authored:

```text
CONTRACT.ENUM_INVALID: enumType("Payload"): an enum cannot use the codec pg/json@1. The json type has no equality operator, so no CHECK can compare a value with the members. Use pg/jsonb@1, whose type has one.
```

PSL refuses an enum block with `@@type("pg/json@1")` with the same reason, as `PSL_EXTENSION_INVALID_VALUE`.

1. Type the enum with `pg/jsonb@1`: change `@@type("pg/json@1")` to `@@type("pg/jsonb@1")` in PSL, or pass `{ codecId: 'pg/jsonb@1' }` (or `jsonbColumn`) to `enumType` in TypeScript. The members stay as they are.
2. Re-emit the contract. The enum's codec and its columns' type change from `json` to `jsonb`, and with them the storage hash. Plan and apply a migration, which changes each column's type.

The TypeScript detection matches a file that calls `enumType(` and names the json codec anywhere, even on a column that is not an enum. Check only the enums.

## `enum-list-check-compares-in-column-type`

A list column typed by an enum, such as `hosts Host[]` in PSL or `field.namedType(Host).many()` in TypeScript, has a CHECK constraint that every element is a member. Earlier versions cast the column to `text[]` before comparing. 8.0.0-rc.14 wrote:

```sql
"hosts"::text[] <@ ARRAY['127.0.0.1', '10.0.0.0/8']::text[]
```

and 8.0.0-rc.15 wrote:

```sql
array_remove("hosts"::text[], NULL) <@ ARRAY['127.0.0.1', '10.0.0.0/8']::text[]
```

Postgres writes an `inet` value as text with its prefix length, `127.0.0.1/32`, so that constraint refused every host address. The constraint now compares in the column's type:

```sql
array_remove("hosts", NULL) <@ '{"127.0.0.1","10.0.0.0/8"}'
```

1. Re-emit the contract. Every list column typed by an enum gets the new expression, and the constraint's name is derived from its expression, so the name and the storage hash change.
2. Plan and apply a migration: it drops the old CHECK constraint and adds the new one. Dropping a CHECK constraint is a `widening` operation, so the plan asks no question about it; see `non-data-drops-are-widening`.

The detection for this change looks in `contract.json` for the old expression. If you do not keep `contract.json` in the project, look for list fields typed by an enum.

The order of the steps matters when you come from 8.0.0-rc.14, whose upgrade to 8.0.0-rc.15 runs a script and then `prisma db sign`. Run that `db sign` step before you emit the contract with this version. If you already emitted, `db sign` reports the old CHECK constraint as missing:

- In a project with migrations, run `prisma db sign <hash>` with the hash the 8.0.0-rc.15 script printed, then plan and apply a migration as in step 2.
- In a project without migrations, kept with `db init` or `db update`, run `prisma db update`. It drops the old CHECK constraint and adds the new one; `db sign <hash>` fails there, because no migration holds that hash.

The `contract.json` snapshots under `migrations/snapshots/` keep the old expression, so the detection keeps matching them after the upgrade. They record past contracts and need no change.

A numeric enum's CHECK constraint, on a scalar or a list column, compares values as numbers, so the column also takes a value equal to a member but written with another scale, such as `0.50` for the member `0.5`, which reads back as `0.50` and which `db.enums` does not find.

## `integer-text-in-contract-json-refused`

The same rule holds when a contract is loaded. `contract emit` writes these values without leading zeros or a minus sign on zero, so a `contract.json` holds another spelling only when it was written or edited by hand. Loading it fails with `RUNTIME.DECODE_FAILED`, as in `mongo/int64@1 JSON value must be "7", the integer's decimal text without leading zeros or a minus sign on zero`. Rewrite each value the message names, or re-emit the contract from its source.

The detection for this change matches a `contract.json` that names one of these codecs and holds a string such as `"007"` or `"-0"` anywhere, even on another codec. Check only the values typed by these codecs.

## `db-enums-members-hold-read-values`

`db.enums` (`db.enums.<namespace>.<Enum>` on Postgres, `db.enums.<Enum>` on SQLite and Mongo) used to hold each member in the form `contract.json` stores it. Where a codec's stored form is not the value a query returns, a member and a value read from the database never matched:

```ts
// Level is @@type("pg/int8@1") with Low = "1"
db.enums.public.Level.members.Low; // was "1", now 1n
db.enums.public.Level.has(row.level); // was false for row.level === 1n, now true
```

The rule: a member changes when its codec's stored JSON form is not the application value. That covers:

- bigint codecs: `pg/int8@1`, `pg/unboundedint@1`, `sqlite/bigint@1`, `mongo/int64@1` (a bigint, where it was decimal text);
- codecs that read decimal text as a number: `pg/int8number@1`, `sqlite/bigintnumber@1`, `mongo/int64Number@1` (a number, where it was text);
- date, time, timestamp and interval codecs: `pg/timestamptz-date@1`, `pg/date-temporal@1`, `pg/time-temporal@1`, `pg/timestamp-temporal@1`, `pg/timestamptz-temporal@1`, `pg/interval@1`, `sqlite/datetime@1`, `mongo/date@1` (a `Date`, a Temporal value or an interval object, where it was text);
- byte codecs, `sqlite/blob@1` and `mongo/binary@1` (a `Uint8Array`, where it was JSON). An enum can no longer use `pg/bytea@1`; see `enum-codecs-refused`;
- float members written "NaN", "Infinity" or "-Infinity" on `pg/float4@1`, `pg/float8@1`, `pg/float@1` or `mongo/double@1`, and members written "Infinity" or "-Infinity" on `sqlite/real@1`, which refuses NaN (a number, where it was text).

Text, integer, uuid, numeric, boolean and JSON members are unchanged. A mutable member, such as a `Date` or a `Uint8Array`, is a fresh copy on every read, so changing one does not change the enum. An enum's members are decoded when the enum is first read, so a client whose contract has a Temporal enum builds in a runtime without `Temporal` and fails only when that enum is read.

`has()`, `nameOf()` and `ordinalOf()` find a value equal to a member. A string, number or bigint must be the member itself; an object must be of the member's kind and stored as the member is, so a date equal to a member matches although it is a different object. A value of another type, such as `"1"` for an int8 member or an ISO string for a date member, is no member.

1. Find the code that reads `db.enums`. The detection for this change looks for `enums.` and `enums[`; if you hold an enum accessor under another name, search for that name too.
2. For enums whose codec is listed above, remove any conversion that turned a member into the value a query returns, such as `BigInt(db.enums.public.Level.members.Low)` or `new Date(...)` around a member, and any conversion that turned a value back into the stored form before calling `has()`, `nameOf()` or `ordinalOf()`. Pass the value as a query returns it.
3. Code that compared a member with the stored form, for example `members.Low === '1'`, now compares with the value: `members.Low === 1n`. Compare object members by value, for example `members.Launch.getTime() === row.at.getTime()`, not with `===`.

## `float-enum-columns-type-non-finite-members-as-number`

Re-emit the contract. A float enum column that has a NaN or infinite member is typed `number` in `contract.d.ts`, because those members are numbers. Where code wrote the strings `"NaN"`, `"Infinity"` or `"-Infinity"` to such a column, write `NaN`, `Infinity` or `-Infinity`, or the enum's member, such as `db.enums.public.Special.members.Nan`.

## `psl-enum-bson-types-refused`

A Mongo PSL contract derives a collection validator whose `$jsonSchema` lists each enum's members as JSON. A BSON long, date, ObjectId, decimal, binary or vector value is never equal to its JSON form, so the validator refused every write of a field typed by such an enum. `prisma contract emit` now reports the enum at its `@@type` argument, or a double member written as text at the member, instead of emitting a contract no write can satisfy.

For each enum reported, do one of these:

- Store the enum through a codec the validator can list, for example a `mongo/string@1` enum whose members are the values' text, and convert at the application boundary.
- Author the enum and the models that use it in a TypeScript contract (`@internal/mongo/contract-builder`), which carries no collection validator; the ORM checks enum membership on write there.

## `mongo-orm-takes-enum-accessors`

Code that builds the Mongo ORM itself, rather than through `mongo()`, passes the contract's enum accessors, the same ones `db.enums` holds. Built without them, the ORM compared a written enum value with the enum's stored forms and refused every value of an enum whose stored form is not the value, such as a bigint or a date member; it is now a type error.

Before:

```ts
import { createMongoExecutionContext, createMongoRuntime } from '@prisma/orm-mongo/family-runtime';
import { mongoOrm } from '@prisma/orm-mongo/orm';

const context = createMongoExecutionContext({ contract, stack });
const runtime = createMongoRuntime({ context, driver });
const orm = mongoOrm({ contract, executor: runtime });
```

After:

```ts
import {
  buildMongoEnums,
  createMongoExecutionContext,
  createMongoRuntime,
} from '@prisma/orm-mongo/family-runtime';
import { mongoOrm } from '@prisma/orm-mongo/orm';

const context = createMongoExecutionContext({ contract, stack });
const runtime = createMongoRuntime({ context, driver });
const orm = mongoOrm({ contract, executor: runtime, enums: buildMongoEnums(contract, context.codecs) });
```

`buildMongoEnums` refuses a contract whose enum codec the context lacks with `RUNTIME.CODEC_DESCRIPTOR_MISSING`. `createMongoCollection()` takes the accessors as its fourth argument, before the optional `mutationDefaults`: change `createMongoCollection(contract, 'User', executor, mutationDefaults)` to `createMongoCollection(contract, 'User', executor, enums, mutationDefaults)`. `mongoOrm()` refuses `enums` that lack an accessor for an enum the contract declares with `ORM.ARGUMENT_INVALID` when it is called; `createMongoCollection()` refuses a write of an enum field whose accessor is missing from `enums` with the same error.

## `contract-dts-enum-member-types`

Run `prisma contract emit`. Each namespace with enums gains an optional, type-only `enumMemberTypes` entry next to its `enum` entry. The `enum` entry still types each member as `contract.json` stores it; `db.enums` takes its member types from `enumMemberTypes`. Until you re-emit, `db.enums` keeps typing members in their stored form, which no longer matches what it holds.

## `prisma7-schema-states-constraint-names`

For each project whose `prisma.config.ts` uses `prisma7Schema(...)`, run `prisma contract emit`. If the storage hash in the emitted `contract.json` is unchanged, the schema has none of these constraints and nothing else is needed. Otherwise, handle each database the application uses by how it is managed:

1. **Prisma 7 still owns the migrations** (the database was signed before the handover). Run `prisma db sign` against it. Prisma 7 created the database, so it already has the names the contract now states; only the contract changed. Until it is signed, `prisma db verify` reports a mismatch and the application logs a marker warning on its first query; queries still run.

2. **Prisma 8 owns the migrations.** Run `prisma migration plan --name constraint-names` and apply it with `prisma db migrate --advance-ref db`. The migration renames each affected constraint from the name Prisma 8 derived to the name Prisma 7 chose. On a database Prisma 7 built, the constraints already have those names, so each rename is skipped; on a database Prisma 8 built from the migrations, they are renamed.

3. **Prisma 8 created the database with `prisma db init` or `prisma db update`**, as for a test or preview database. Run `prisma db update`. It reads the constraint names from the database and renames each one whose name differs from the contract's, for example `_PostToTag_pkey` to `_PostToTag_AB_pkey`.

## `foreign-keys-name-their-backing-index`

A foreign key in `contract.json` now says what serves its lookups:

```jsonc
// table "Post": a relation on authorId, beside a partial index on the same column
"foreignKeys": [
  { "source": { "columns": ["authorId"], "namespaceId": "public", "tableName": "Post" },
    "target": { "columns": ["id"], "namespaceId": "public", "tableName": "User" },
    "index": { "name": "Post_authorId_idx_e47547ed" } }
]
// table "Profile": a relation on userId, which is @unique
"foreignKeys": [
  { "source": { "columns": ["userId"], … }, "target": { … }, "index": { "unique": ["userId"] } }
]
```

A relation still gets its own backing index unless it says `index: false`. When the table already declares an identical index, or a unique constraint, unique index or primary key on the same columns, the contract keeps one index and the foreign key names it, or names the key by kind. The field is absent only with `index: false`. A `contract.json` from Prisma Next 0.15, which stored `"index": true` or `false` on each foreign key, still loads; the boolean is read as absent.

1. Run `prisma contract emit`. Every contract with a foreign key gets a new storage hash.
2. Run `prisma migration plan`. If nothing else in this upgrade changes your database, it reports that the contract changed but nothing in the database did. Do what it says:
   - If you deploy with migrations, run the `prisma migration new --from <hash>` command it prints, which writes a migration with no operations, then `prisma db migrate`.
   - If you manage a database with `prisma db init` or `prisma db update`, run `prisma db sign` against it.
3. If your project composes the Supabase extension, its contract space also gets a new storage hash: run `prisma db sign` against each database signed with the previous one.

`prisma contract emit` now also warns when two indexes of a table that both carry a `name` or `map` are identical (`PN_INDEX_DUPLICATE`), or when a named plain index has the same columns as a unique constraint, unique index or the primary key (`PN_INDEX_REDUNDANT`). The contract keeps both indexes; remove the one you do not need. Two identical indexes both named with `name:` are refused, because the planner could not tell their wire names apart: remove one, or name one with `map:`.

## `partial-or-typed-index-no-longer-backs-a-foreign-key`

Deleting or updating a referenced row looks up the referencing rows by the foreign key columns. A partial index covers only the rows its predicate selects, and an index with another access method or options may not serve that lookup, so the relation now gets a plain backing index beside it. For example:

```prisma
model Post {
  id         Int       @id
  authorId   Int
  archivedAt DateTime?
  author     User      @relation(fields: [authorId], references: [id])

  @@index([authorId], where: "\"archivedAt\" IS NULL", name: "post_author_live")
}
```

The next `prisma migration plan` creates `Post_authorId_idx_e47547ed`. If that is what you want, apply it. Otherwise choose one:

- To use your index, name it on the relation. No backing index is derived:

  ```prisma
  author User @relation(fields: [authorId], references: [id], index: "post_author_live")
  ```

  In a TypeScript contract, pass the same name: `rel.belongsTo(User, { from: 'authorId', to: 'id' }).sql({ fk: { index: 'post_author_live' } })` or `constraints.foreignKey(cols.authorId, User.refs.id, { index: 'post_author_live' })`.
- To have no backing index at all, write `index: false` on the relation, or `fk: { index: false }` in TypeScript.

The name is the `name` or `map` you gave the index, unique constraint or primary key, or an index's stored name from `contract.json`. The default name of an index you did not name does not count. `prisma contract emit` refuses a name that the table does not have, that an index and a key share, or whose object's first columns are not the foreign key's columns.

## `unnamed-index-on-unique-columns-left-out`

For example, with `email String @unique`, an `@@index([email])` is left out of the contract, and `prisma migration plan` drops the index from the database. The unique constraint keeps serving the lookups. If you want to keep the index, write `@@index([email], name: "user_email_lookup")`; `prisma contract emit` then warns with `PN_INDEX_REDUNDANT` on each emit.

## `infer-and-print-write-the-relation-index-argument`

Nothing to change in your source. If you re-run `prisma contract infer` or `prisma contract print`, expect `@relation` lines to differ from what an earlier release wrote: `index: false` beside a hash, gin, optioned or partial index, `index: "<name>"` for a composite index or named key whose first columns are the relation's, and `index: "<name>"` or no `index` argument where `contract print` used to write `index: false` on every relation. Emitting either result gives the same contract.

A contract emitted from a Prisma 7 schema (`prisma7Schema(...)`) also states what backs each foreign key where the model's own indexes or keys serve it, such as the unique index of a one-to-one relation or the primary key of an implicit many-to-many junction. Prisma 7 created no other backing index, and the contract still adds none; only the storage hash changes, which `foreign-keys-name-their-backing-index` covers.

## `mongo-index-sort-function`

In MongoDB PSL schemas, replace `field(sort: Asc)` with `sort(field, Asc)` and `field(sort: Desc)` with `sort(field, Desc)` in `@@index`, `@@unique`, and `@@textIndex` field lists. The old syntax is no longer accepted.

For example, change `@@index([createdAt(sort: Desc), authorId])` to `@@index([sort(createdAt, Desc), authorId])`. Keep field order, direction, and the attribute's other arguments unchanged. Use the model field name, not its mapped database name.

Apply this translation to current schema files, PSL schema snapshots stored in migration directories, and documentation examples. When documentation describes the old spelling as a "per-field form", call the new spelling a "function form" instead.

Plain field references and `wildcard()` / `wildcard(field)` remain unchanged. There is no null-ordering option. Do not change SQL schemas, generated contracts, or migration operations: this is a MongoDB PSL syntax change, not a database index change.

## `non-data-drops-are-widening`

A plan that only drops an index, a unique or foreign-key constraint, a check, a default or a native enum type no longer asks anything. A plan that drops a table or a column, or changes a type in a way that can lose data, asks about each subject, and `--confirm` no longer answers it: replace each `--confirm` as `db-update-confirm-no-longer-consents` and `migration-plan-refuses-data-loss` describe. Dropping a row-level-security policy or disabling row-level security is `widening` too, but `db update` still asks about it as an access change, answered with `--allow <Model>`.

## `rename-statements`

When a contract change renames a model or a field and the plan drops and creates its table or column, state the rename instead of editing the migration by hand: `prisma migration plan --rename <old>:<new>` or `prisma db update --rename <old>:<new>`. The planner then renames the table or column, and the constraints and indexes named after it, and keeps the rows. `db update` resolves the old names against the contract snapshot of the database's last update, which it stores when it advances a ref; with `--db <url>`, pass `--advance-ref <name>` on the run before the rename so the snapshot exists. Nothing in an existing project needs to change.

## `destructive-means-data-loss`

The planner and the migration factories now class an operation as `destructive` only when it can lose rows or values. An operation that fails rather than losing a value is `widening`: `SET NOT NULL` fails on a NULL, and a MongoDB validator applies only to later writes. `prisma migration show` marks fewer operations with ⚠, `prisma migration plan` and `prisma db update` print the data-loss warning less often, and `prisma db update` asks for consent less often.

A migration that is already applied needs nothing: `prisma db migrate` applies its `ops.json` as written, and the database ledger records the migration by its hash.

For each migration package that no database has applied yet and whose `migration.ts` calls `setNotNull` (Postgres), or `dropIndex`, `setValidation` or `collMod` without an `operationClass` (MongoDB), run its `migration.ts` again (`node migration.ts`) so that `ops.json` records the new class. This rewrites `ops.json` and the `migrationHash` in `migration.json`. Do not run it again for a package a database has applied: its new hash would no longer match the hash the database's ledger recorded for it.

## `migration-plan-refuses-data-loss`

`prisma migration plan` used to ask for consent only before an auto-baseline that would lose data. It now asks about every operation of every plan that would lose data: dropping a table, a column or a collection, or a type change that can change values. It asks one question per model, field or storage name, before it writes anything. A rename on the command line is planned from the start, so the drop it replaces is never asked about.

Detection lists every script and CI file that runs `migration plan`; it cannot tell which of them plan a drop. For each one that runs non-interactively, run it once against a contract change that drops something, or read the failure when it next happens. The failure is `CLI.CONSENT_REQUIRED`; its `meta.unanswered[]` names each subject and the verbs that answer it, and its `nextActions` give the flags, for example `--delete Legacy` or `--rename 'Legacy:<new name>'` (a value with characters a shell would read is single-quoted). Add the flags you mean to that run. A subject no model of the starting contract stores is named by its storage name and can only be deleted. `--rename` is offered only for a model or field the new contract no longer has, so a field whose type changes is answered with `--delete`, and on MongoDB, whose planner refuses renames in this release, only `--delete` is offered; the question then says how to keep the documents by renaming the collection in `mongosh` before a plan that drops it is applied, and that a migration written by `migration plan` still drops it. A field of a model the plan renames is named through the model's new name: `--rename Profile:User --delete User.nickname`. Do not keep a `--confirm <directory>` for this: it answers nothing.

## `db-update-confirm-no-longer-consents`

Detection finds `--confirm` on the same command line as `db update`, including a command continued over several lines with `\`. For each `prisma db update ... --confirm <database>`, replace `--confirm <database>` with one statement per operation it was there to allow:

- `--delete <Model>` or `--delete <Model.field>` for each model or field whose data the update may lose, or `--rename <Model>:<New>` / `--rename <Model.field>:<Model.newField>` if it was renamed.
- `--delete <storage name>` for data no model stores, such as a table or column added by hand; on Postgres the name is schema-qualified (`public.audit_log`).
- `--allow <Model>` before each operation that changes who can read or write that model's rows, such as dropping its row-level-security policy or disabling row-level security; each operation is its own question, so both on one model take `--allow User --allow User`.

To find the subjects, run the same command with `--no-interactive --json` and read `meta.unanswered[]`, or `--dry-run --json` and read `dataLoss` and `accessWidening`. A `--delete` or `--allow` that answers no question fails the run with `CLI.CONSENT_UNUSED`; on `--dry-run`, which asks nothing, it fails with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`, so the exact command you will apply can be previewed with `--dry-run` first.

## `db-update-reads-origin-snapshot`

`prisma db update` now reads the snapshot of the contract the database's marker names on every run, not only when `--rename` is given, so it can name what an operation would lose by model and field. Without a snapshot (a database last updated with `--db <url>` and no `--advance-ref`), each subject is its storage name, and the question says so. The planned operations are the same either way.

## `control-api-answer-questions`

These come from `@prisma/orm-toolchain/cli/control-api`.

- `executeDbUpdate(options)` and the control client's `dbUpdate(options)` require `answerQuestions`, typed `AnswerPlanQuestions` (with `PlanQuestion`, `PlanAnswer` and `PlanQuestionVerb`, all exported from `@prisma/orm-toolchain/cli/control-api`). Before an apply it is called with every question no statement answered, at least once, with an empty list when nothing is in question, and also under `acceptDataLoss: true`. Return one `{ verb, text }` per question, in order, with a verb from `question.verbs` and `question.subject` as the text (or `<subject>:<new name>` for a rename); throw to refuse. A callback that returns too few answers, or an answer its question rejects, throws an `InternalError`. To keep a script that refuses every data loss, write `answerQuestions: async (questions) => { if (questions.length > 0) throw new Error('db update would lose data or widen access'); return []; }`.
- `acceptDataLoss: true` answers every data-loss question, and `acceptAccessWidening: true` every access-widening question. A caller that passed `acceptDataLoss: true` to apply whatever the plan holds passes both.
- `delete` and `allow` statements in `statements` (`{ verb: 'delete', text: 'Legacy' }`) answer their questions without asking. A `delete` answers every loss of its subject; an `allow` answers one operation, in order, so two access changes on one model take two `allow` statements. One that answers no question fails with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`, in plan mode as in apply mode.
- `consent` is gone from `executeDbUpdate`'s and `dbUpdate`'s options: the plan-hash binding it carried no longer exists. Remove it.
- `executeMigrationPlanCommand(options)` requires `answerQuestions`, with the same contract, and loses `consent` and `carryEmittedExtensionDirs`. Remove both.
- `DbUpdateSuccess` gains `dataLoss` and `accessWidening`, the operations of the plan that lose data or widen access, by position, each an `AskedSubject` with the subject's `text` as the question writes it. `AskedSubject`, `MigrationSubject`, `MigrationOperationSubject` and `MigrationPlanSubjects` are exported from `@prisma/orm-toolchain/cli/control-api`.

## `applied-statement-report-verb`

`AppliedStatementReport` is now a union on `verb`. A `rename` entry keeps its `statement` as before; a `delete` or `allow` entry's `statement` is `{ kind: 'delete' | 'allow', subject }`, where `subject` is a model, a field, or `{ kind: 'storage', name }`. Code that reads `report.statement.from` or `.to` narrows on `report.verb === 'rename'` first. An exhaustive `switch` over `StatementVerb` gains `case 'delete':` and `case 'allow':`.

## `consent-errors-removed`

Remove imports of `ERROR_CODE_DESTRUCTIVE_CHANGES`, `errorDestructiveChanges`, `ERROR_CODE_CONSENT_PLAN_MISMATCH` and `errorConsentPlanMismatch` from `@prisma/orm-framework/errors/execution`; nothing raises those errors any more. Code that checks a `db update` failure for `code === 'DESTRUCTIVE_CHANGES'` or `'CONSENT_PLAN_MISMATCH'`, or reads `failure.destructiveChanges` or `failure.consentPlanMismatch`, handles `CLI.CONSENT_REQUIRED` from the CLI instead, or, through the control API, the refusal its own `answerQuestions` throws. A script that matches `MIGRATION.DESTRUCTIVE_CHANGES`, `MIGRATION.CONSENT_PLAN_MISMATCH`, `CLI.CONSENT_TOKEN_UNRESOLVED` or `CLI.CONSENT_OPERATIONS_MISSING` in CLI output matches `CLI.CONSENT_REQUIRED` instead.

## `apply` is now `with`

The collection method that runs a function on a collection is now `with`. A pure filter is still written `where(rowFragment)`; `with` runs a query fragment, a function from a collection to a collection, for what `where` cannot express, such as a shared `select` and `include`, an order, a limit or offset, or a variant.

These changes apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

### Rename `apply` to `with`

Rename each call on a collection:

```diff
- const posts = await db.orm.public.Post.apply(notDeleted).apply(postSummary).all();
+ const posts = await db.orm.public.Post.with(notDeleted).with(postSummary).all();
```

The same holds inside an include refinement and inside a fragment's body:

```diff
- db.orm.public.User.include('posts', (posts) => posts.apply(postSummary));
+ db.orm.public.User.include('posts', (posts) => posts.with(postSummary));
```

Do not rename `Function.prototype.apply` or `Reflect.apply`. A call such as `fn.apply(this, args)`, `fragment.apply(undefined, [collection])` or `Reflect.apply(fn, target, args)` calls a function, not a collection; leave it as it is. When a match is unclear, rename it only if its receiver's type is a collection: `db.orm.<namespace>.<Model>`, a chain on one, a custom class that extends `Collection`, or the collection an include refinement or a fragment's body receives.

Also rename `apply` to `with` in comments and documentation that name it as the collection method, such as "run with `apply` on any collection of posts". The next section renames `scope` to `fragment` in the same places.

`with` is a reserved word in JavaScript, but a valid method name. `collection.with(fragment)` works; destructuring it as `const { with } = collection` does not.

The error texts that named `apply` change as well; the final texts are under "Error texts" in the next section.

### `with` is a member of every collection

A custom collection class that declares its own `with` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   with(term: string) { return this.where((post) => post.title.ilike(`%${term}%`)); }
+   withTitle(term: string) { return this.where((post) => post.title.ilike(`%${term}%`)); }
  }
```

A class that declared its own `apply` because the name was reserved may keep it under that name or rename it back.

An aggregate operation named `with` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation. An aggregate operation may now be named `apply`.

## The `scope` methods and types are renamed to `fragment`

The general term for a function from a collection to a collection, run with `collection.with(fn)`, is **query fragment**, or **fragment** for short. A **scope** is a fragment that only imposes conditions on the query, such as a soft-delete filter. The methods and types that make fragments were named `scope`, although they also make fragments that select, include or order, so they are renamed to `fragment`. What they do has not changed.

These changes apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

### Rename `scope` to `fragment`

Rename the client's method and the collection method:

```diff
- const notDeleted = db.orm.scope(
+ const notDeleted = db.orm.fragment(
    { deletedAt: field.temporal.timestamptz().optional() },
    (rows) => rows.where((r) => r.deletedAt.isNull()),
  );
- const postSummary = db.orm.public.Post.scope((posts) => posts.select('id', 'title').include('user'));
+ const postSummary = db.orm.public.Post.fragment((posts) => posts.select('id', 'title').include('user'));
```

The same holds on a chained collection, a custom collection class and `this` inside one, and in a type such as `typeof db.orm.scope` or a destructuring such as `const { scope } = db.orm`. Rename a use only when its receiver is the ORM client (`db.orm`, or the client `orm()` returns) or a collection. Leave `.scope(` calls on other objects as they are.

### Rename the types

```diff
- import type { FieldScope, Scope, ScopeFacts } from '@prisma/orm-postgres/orm-client';
+ import type { FieldFragment, Fragment, FragmentFacts } from '@prisma/orm-postgres/orm-client';
```

Rename every use of these types in the file, including a re-export such as `export type { Scope } from '@prisma/orm-postgres/orm-client'` and a qualified name such as `Orm.Scope` after `import * as Orm from '@prisma/orm-postgres/orm-client'`. Do not rename the SQL builder's `Scope` or `ScopeField`, which describe the tables and columns a builder query can see; they are imported from a `builder` entry, not from `orm-client`.

### Rename what you named after scopes

Code that calls a fragment a "scope" still compiles, but rename it to match the new words. Name a module, a variable or a comment for a fragment that selects, includes, orders or limits a fragment, and keep "scope" for a fragment that only imposes conditions on the query. For example, a module `scopes.ts` that holds both a filter and a shared `select` becomes `fragments.ts`, with its imports updated, while a comment that describes a filter in it as a scope stays. Update documentation the same way, such as a README that names `db.orm.scope`, `.scope(...)` or a module you renamed.

### `fragment` is a member of every collection

A custom collection class that declares its own `fragment` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   fragment(text: string) { return this.where((post) => post.body.ilike(`%${text}%`)); }
+   containing(text: string) { return this.where((post) => post.body.ilike(`%${text}%`)); }
  }
```

A class may now declare a method named `scope`.

An aggregate operation named `fragment` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation. An aggregate operation may now be named `scope`.

### A namespace named `fragment`

A contract namespace takes its name on the client even when the client has a method of that name. If your contract has a namespace named `fragment`, `db.orm.fragment` is that namespace, and the client has no method to make a fragment for any model. If code calls `db.orm.scope(fields, body)` with such a contract, replace each call: a fragment for one model with `collection.fragment(body)` on each model it serves, or a filter with a function of the model accessor (a row fragment) whose parameter is typed with `CodecField`, passed to `where`. A namespace named `scope` no longer hides a method, and `db.orm.scope` still reaches it.

### Error texts

Errors and compile errors about fragments say "fragment" where they said "scope". Before this change, after `apply` was renamed to `with`, they read `Cannot define the scope: the body is not a function`, `Pass the scope to with on a collection: collection.with(scope).` and, for the refused bulk writes, `A scope passed to with can add one without showing it at the call site.` They now read `Cannot define the fragment: the body is not a function`, `Pass the fragment to with on a collection: collection.with(fragment).` and `A fragment passed to with can add one without showing it at the call site.` Every other text that said "the scope" or "a scope" says "the fragment" or "a fragment" in the same place. The compile error for a model that lacks a declared field names the property `the model has no field that matches the declaration in the fragment`. Update tests that assert on the old text.

## `orm-collections-lock-rows`

The ORM client's collections gain four methods that lock the rows a read selects: `forUpdate()`, `forNoKeyUpdate()`, `forShare()` and `forKeyShare()`. Each takes an optional `{ nowait, skipLocked }`, which exclude each other. There is no `of` option, because the ORM always locks only the model's own table. A lock lasts until the transaction ends, so use it inside `db.transaction(...)`:

```ts
await db.transaction(async (tx) => {
  const job = await tx.orm.public.Job.where({ state: 'queued' })
    .orderBy((j) => j.createdAt.asc())
    .forUpdate({ skipLocked: true })
    .first();
});
```

A lock cannot be combined with `include`, `groupBy`, `aggregate`, `distinct`, `distinctOn` or a mutation terminal, and a lock method cannot be called inside an `include()` refinement callback. Each of these throws `ORM.LOCK_INCOMPATIBLE`.

Each method needs `sql.forUpdate`, `postgres.forNoKeyUpdate`, `sql.forShare` or `postgres.forKeyShare`, and also `sql.lockOf`, because the ORM always renders `OF` the model's table. The `nowait` and `skipLocked` options need `sql.lockNowait` and `sql.lockSkipLocked`. A `contract.json` emitted before this release carries none of them, so the methods do not exist on its collections. Re-emit your contract to pick up the keys:

```console
prisma contract emit
```

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the extension's embedded `version` moving to `8.0.0-rc.17`; any other difference in the emitted files comes from an earlier entry in this guide.
