---
from: "8.0.0-rc.19"
to: "8.0.0-rc.20"
changes:
  - id: stored-contracts-expand-type-aliases
    summary: |
      A stored SQL contract whose columns name a type alias in `typeRef` no longer loads. Run `scripts/expand-type-aliases/expand-type-aliases.ts` from the project root, then re-emit the contract, then run `prisma db sign` against every database. Sign a database that has not applied every migration with `prisma db sign --contract <the last migration it applied>`, then run `prisma db migrate`. The script writes each alias's parameters into the columns typed by it, in every stored contract, migration snapshots and the emitted `contract.json` included, and refreshes every hash and reference that changes.
    detection:
      glob: "**/contract.json"
      matches:
        - '"typeRef"\s*:'
    script: scripts/expand-type-aliases/expand-type-aliases.ts
  - id: psl-alias-attributes
    summary: |
      No action is needed. A `types {}` alias in PSL may now carry `@default`, `@onCreate` and `@onUpdate`, and the targets contribute `temporal.CreatedAt` and `temporal.UpdatedAt`. Aliases are still valid PSL, so a `contract.prisma` that uses them does not change.
  - id: ts-types-key-removed
    summary: |
      The TypeScript contract builder no longer takes a `types` key, and `field.namedType(...)` accepts only an enum. Replace `types: { X: type.Y(...) }` and each `field.namedType(types.X)` with a constant `const X = field.column(type.Y(...))` used as the field, and remove `types` from the object the contract returns. A `types` entry written `{ kind: 'codec-instance', codecId, typeParams }` becomes such a constant too if a field uses it; delete it if no field uses it. No `types` key stays in the contract. Re-emit the contract. The detection matches TypeScript files that call `field.namedType` with an alias or a string, or that return a `types` key from `defineContract`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])field\.namedType\(\s*(?:types\b|[\x27"`])'
        - '(?<![\s\S])(?=[\s\S]*\bdefineContract\()[\s\S]*(?<![\w$.\x27"])types\s*(?::(?!\s*(?:field\.|\{\s*codecTypes\b))|,|\})'
  - id: supabase-contract-expanded
    summary: |
      The `@prisma/orm-extension-supabase` contract no longer stores its nine type aliases, so the Supabase space's storage hash changes. Run `prisma db sign` against every database after upgrading.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/orm-extension-supabase"'
  - id: engine-pin-moves-to-0-9-0
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.9.0` (up from 0.7.0). A project whose Prisma config, tests or tooling load `@prisma/cli-engine` alongside the Prisma toolchain must move it to `0.9.0`, in `package.json` or in a `pnpm-workspace.yaml` catalog. A separate CLI that the project builds on the engine is not affected. The detection matches an engine version below 0.9 in either file.
    detection:
      glob: "**/{package.json,pnpm-workspace.yaml}"
      matches:
        - '[\x27"]@prisma/cli-engine[\x27"]\s*:\s*[\x27"]?[^\x27"\n#]*(?<![\d.])0\.[0-8](?!\d)'
  - id: piped-output-needs-json
    summary: |
      A piped Prisma ORM command no longer prints JSON. Without `--json`, stdout receives the command's plain data lines, such as one tab-separated line per migration. A script that reads JSON from `prisma contract …`, `prisma db …`, `prisma migration …` or `prisma orm init` must pass `--json`.
  - id: access-changes-rename
    summary: |
      `accessWidening` is renamed `accessChanges`, because it also lists changes that do not widen access. The `db update --dry-run --json` output key and `DbUpdateSuccess.accessWidening` become `accessChanges`, and the `executeDbUpdate` and control client `dbUpdate` option `acceptAccessWidening` becomes `acceptAccessChanges`. There is no alias for the old names.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs,sh,bash,yml,yaml}"
      matches:
        - '(?<![\w$])(?:acceptAccessWidening|accessWidening)(?![\w$])'
  - id: removed-namespace-questions
    summary: |
      On Postgres, when the contract no longer declares a namespace the database's contract declared, `migration plan` and `db update` plan to drop its tables, asking about each model, and then the schema. Before, those tables were left in place without a word. If the namespace was renamed, say so with `--rename <old namespace>:<new namespace>`, which renames the schema and keeps every row. Answer with `--delete <namespace>` to let the tables go, or keep a model by moving it with `--rename <namespace>.<Model>:<other namespace>.<Model>`.
  - id: schema-verification-failed-schema-issues
    summary: |
      The `CONTRACT.SCHEMA_VERIFICATION_FAILED` diagnostic of `db verify --json` and `db sign --json` carries the schema differences in `meta.schemaIssues`, as issue objects, instead of `meta.issues`, as label strings. Code that reads `meta.issues` from that diagnostic reads `meta.schemaIssues` instead.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*(?:\bdb (?:verify|sign)\b|SCHEMA_VERIFICATION_FAILED))[\s\S]*\bmeta(?:\?\.|\.|\?\.\[|\[)(?:issues\b|[''"]issues[''"]\])'
  - id: check-expectation
    summary: |
      A migration check that expects one object to be absent or present can now say so in an optional `expectation` field, and a failed precheck's message then names the object: `That check failed: the database already has index "Item_state_idx".` instead of `That check failed on this database.` Checks written without it keep working and keep the generic sentence.
    detection:
      glob: "**/ops.json"
      matches:
        - '(?:\{\s*"description": "(?:[^"\\]|\\.)*",\s*"sql": "(?:SELECT (?:NOT )?EXISTS \(SELECT 1 AS \\"one\\" FROM \\"(?:information_schema\\"\.\\"columns|pg_extension|pg_constraint|pg_class|pg_policies|pg_type|pg_enum|pg_indexes|pg_namespace)\\"(?: AS \\"\w+\\")?(?: INNER JOIN \\"pg_(?:namespace|type|class)\\" AS \\"\w+\\" ON \\"\w+\\"\.\\"\w+\\" = \\"\w+\\"\.\\"\w+\\")* WHERE (?:[^"\\]|\\"(?:table_schema|table_name|column_name|extname|conname|connamespace|conrelid|nspname|schemaname|tablename|policyname|indexname|typname|typnamespace|enumlabel|enumtypid|relname|relkind|oid|type|name|c|n|t|e|i|p)\\")*?\) AS \\"result\\"|SELECT \(to_regclass\(\$\d+\)\) IS (?:NOT )?NULL AS \\"result\\"|SELECT COUNT\(\*\) (?:= 0|> 0) AS \\"result\\" FROM (?:\\"sqlite_master\\"|pragma_table_info\([^)"]*\)|pragma_index_list\([^)"]*\)) WHERE (?:[^"\\]|\\"(?:table_schema|table_name|column_name|extname|conname|connamespace|conrelid|nspname|schemaname|tablename|policyname|indexname|typname|typnamespace|enumlabel|enumtypid|relname|relkind|oid|type|name|c|n|t|e|i|p)\\")*?)"(?:,\s*"params": \[[^\]]*\])?\s*\}|"source": \{\s*"kind": "list(?:Indexes|Collections)"(?:,\s*"collection": "(?:[^"\\]|\\.)*")?\s*\},\s*"filter": \{\s*"kind": "field",(?:[^{}]|\{[^{}]*\})*\},\s*"expect": "(?:exists|notExists)"\s*\})'
  - id: check-expectation-raw-sql
    summary: |
      A precheck or postcheck you write by hand in a `rawSql` operation of a `migration.ts` can carry `expectation`, `{ expects: 'absent' | 'present', object }`, so a failure of it names the object. Add it where the check asks whether one object exists, then run `node migration.ts` for a migration no database has applied yet.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\brawSql\(\{[\s\S]*?\b(?:precheck|postcheck):\s*\[(?:\s*\{(?:[^{}]|\{[^{}]*\})*\},)*?\s*\{[^{}]*\}'
  - id: mongo-quoted-enum-members
    summary: |
      A MongoDB PSL `enum` member is now read in the syntax of its codec's data type, as on SQL, and a quoted member is text. A quoted member on a type that does not take text is refused with `PSL_VALUE_TYPE_INCOMPATIBLE` at the member: write a Double's `"NaN"`, `"Infinity"` and `"-Infinity"` and an Int64's or Decimal128's number unquoted (`Unknown = NaN`, `Big = 9007199254740993`, `Half = 0.5`), a Date member as `` date`2024-01-01T00:00:00Z` `` and a Binary member as `` binary`aGVsbG8=` ``. A Decimal128 `"-0"` cannot be written in PSL any more, because `-0` is an int32 zero: write `0`, or declare the enum in TypeScript. The detection matches an enum on one of those codecs with a quoted member.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'enum\s+\w+\s*\{(?=[^{}]*@@type\(\s*"mongo/(?:double|int64|int64Number|decimal128|date|binary)@1"\s*\))[^{}]*\n\s*\w+\s*=\s*"'
  - id: mongo-integer-enum-members-with-a-fraction
    summary: |
      A MongoDB PSL number with a fraction, such as `1.0`, is now a Decimal128 value, and no integer type casts from Decimal128, so an Int32 or Int64 member written with a fraction is refused with `PSL_VALUE_TYPE_INCOMPATIBLE` (`Expected a number that mongo/int32 can hold; got mongo/decimal128`). Write the whole number, `One = 1`. The detection matches an Int32 or Int64 enum with a member written with a fraction.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'enum\s+\w+\s*\{(?=[^{}]*@@type\(\s*"mongo/(?:int32|int64|int64Number)@1"\s*\))[^{}]*\n\s*\w+\s*=\s*-?\d+\.\d'
  - id: discriminator-optional-or-list
    summary: |
      A `@@discriminator` field must be required and hold one value, in SQL and MongoDB schemas alike. An optional field is refused with `Discriminator field "<field>" on model "<Model>" must be required, but it is optional. Remove the "?"`, and a list with `... must hold one value, but it is a list. Remove the "[]"`, both `PSL_INVALID_ATTRIBUTE_ARGUMENT`. Make the field required and single: a document or row without the value has no variant. The detection matches a model whose `@@discriminator` names a field declared with `?` or `[]`.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'model\s+\w+\s*\{(?=[^}]*@@discriminator\(\s*(\w+)\s*\))[^}]*\n\s*\1\s+[\w.]+(?:\?|\[\])'
  - id: discriminator-base-value-not-a-member
    summary: |
      When an enum types a `@@discriminator` field, each `@@base` value must be one of the enum's members, as the field stores them. A value that is not is refused at the value with `PSL_INVALID_ATTRIBUTE_ARGUMENT`: `Model "<Variant>" declares @@base value "<value>", which is not a member of enum "<Enum>", the type of discriminator field "<Model>.<field>". Write one of: ...`. Write a member's stored value, or add the value to the enum. The detection matches a schema that declares both a `@@discriminator` and an `enum`; check each `@@base` value of a discriminator typed by an enum.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@@discriminator\()(?=[\s\S]*(?:^|\n)\s*enum\s+\w+\s*\{)[\s\S]*@@base\('
  - id: psl-value-refused-code
    summary: |
      An enum member or `@@base` value that the receiving data type or codec refuses now reports `PSL_VALUE_REFUSED`, in SQL and MongoDB schemas. SQL reported `PSL_INVALID_DEFAULT_LITERAL` for these, and MongoDB reported `PSL_EXTENSION_INVALID_VALUE` (`was rejected by codec`) for a member. A member written in a form its type does not take reports `PSL_VALUE_TYPE_INCOMPATIBLE`, and text an entry or a cast cannot read reports `PSL_INVALID_LITERAL`. Update code or tests that match these codes or messages. A MongoDB discriminator that is not text now says `must be text, such as String`, as SQL does, in place of `must be of type String`, and a type alias of `String` is accepted as a discriminator. The detection matches code that names the old member code or messages.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - 'was rejected by codec \\?"mongo/'
        - 'must be of type String'
        - '(?<![\s\S])(?=[\s\S]*@@base\()[\s\S]*PSL_INVALID_DEFAULT_LITERAL'
  - id: decimal128-spelling
    summary: |
      `mongo/decimal128` stores its values as MongoDB writes them: without leading zeros, keeping negative zero, and only a value a Decimal128 holds exactly. A `contract.json` that stores a Decimal128 value with leading zeros, such as `"007.5"`, is refused when it is loaded with `RUNTIME.DECODE_FAILED`, which names the value to store; emit the contract again. A TypeScript enum member such as `member('Half', '007.5')` is stored as `7.5`, so its contract gets a new hash on the next emit. A value with more than 34 significant digits, counting zeros after the decimal point, such as `1.000000000000000000000000000000000000`, is refused in PSL, TypeScript and `contract.json` instead of being rounded; write a value with at most 34 significant digits. The detection matches a Decimal128 value with leading zeros or more than 34 digits.
    detection:
      glob: "**/*.{json,ts,mts,cts,tsx,prisma}"
      matches:
        - '(?<![\s\S])(?=([\s\S]*?mongo/decimal128@1))\1[\s\S]*?(?:[=,(:]\s*["\x27`]?-?0\d(?![0-9a-f]{62}["\x27`])|[=,(:]\s*["\x27`]?-?\d[\d.]{35,})'
  - id: sql-builder-insert-required-columns
    summary: |
      A SQL builder insert, `db.sql.<namespace>.<table>.insert(rows)`, must now include every column that is not nullable and has no default. Leaving one out is a type error that names the column, and so is a value typed `T | undefined` for such a column. Add a real value, narrowed to `T`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.insert\('
  - id: orm-create-on-update-only-field
    summary: |
      In ORM `create` and `upsert`, a field that is not nullable, has no default and generates a value only on update is now required. That is a field with `@onUpdate(...)` and no `@onCreate(...)`, a temporal preset with only its update phase such as `temporal.timestamptz(onUpdate: now)` or `field.temporal.timestamptz(undefined, undefined, 'now')`, or a TypeScript field with `.onUpdate(...)` and no `.onCreate(...)`. Pass a value for it on create, or make it generate on create too.
    detection:
      glob: "**/*.{prisma,ts}"
      matches:
        - '@onUpdate\('
        - 'onUpdate:\s*now'
        - '\.onUpdate\('
        - '\.temporal\.\w+\([^)]*,\s*[''"]now[''"]'
  - id: supabase-for-role-replaces-with-role-methods
    summary: |
      `SupabaseRuntime` no longer has `queryWithRole`, `executeWithRole`, `preparedQueryWithRole` or `preparedExecuteWithRole`, and `SupabaseRuntimeImpl` no longer has `roleActivitySource`. Call `runtime.forRole(binding)` once and use its members: `runtime.queryWithRole(plan, binding, options)` becomes `runtime.forRole(binding).query(plan, options)`, `executeWithRole` becomes `forRole(binding).execute`, and a prepared statement runs on the role with `statement.query(runtime.forRole(binding), params)` or `statement.execute(runtime.forRole(binding), params)`. The detection matches files that call one of the removed methods.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\.(?:queryWithRole|executeWithRole|preparedQueryWithRole|preparedExecuteWithRole|roleActivitySource)\('
  - id: supabase-role-types-gain-members
    summary: |
      Three public Supabase types require new members, so a test double or hand-built object typed with them stops compiling. `RoleBoundDb` and `ServiceRoleDb` gain `enums` and `nativeEnums`. `SupabaseTransactionContext` is now `PostgresTransactionContext`, so it gains `enums` and `nativeEnums` too. `SupabaseRuntime` requires `forRole(binding)`, which returns a `SupabaseRoleScope` (`query`, `execute`, the prepared-statement operations and `connection`), in place of the four removed `*WithRole` methods. Add the members to each double: take `enums` and `nativeEnums` from `postgresStatic({ contract })` of `@prisma/orm-postgres/static`, or from a role-bound client. The detection matches files that name one of these types.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:RoleBoundDb|ServiceRoleDb|SupabaseTransactionContext|SupabaseRuntime)(?![\w$])'
  - id: supabase-pg-takes-a-pool
    summary: |
      The `pg` option of `supabase()` takes a `pg.Pool` only. A `pg.Client` is a type error and fails at `supabase()` with `SUPABASE.CONFIG_INVALID`. Replace `pg: new Client(...)` with `pg: new Pool(...)` built from the same settings, or pass `url`. The detection matches every `supabase()` call that passes `pg`; leave a call that already passes a `pg.Pool` as it is.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\w$.])supabase(?:<[^>]*>)?\(\s*\{(?:[^{}]|\{[^{}]*\})*?(?<![\w$.])pg\s*[:,}]'
  - id: supabase-close-waits-for-work
    summary: |
      `db.close()` on a Supabase client now refuses new work at once on every role-bound client and on `.supabase`, with `DRIVER.NOT_CONNECTED` "Runtime is closed", and waits for work already running, open role transactions included, before it ends the pool. With a pool you passed as `pg`, a query after `close()` used to throw at the call; its promise now rejects instead. Await every role transaction before `close()`, or `close()` waits for it.
  - id: contract-artifacts-restamp
    summary: |
      An extension that writes its own package version into the contracts it emits, such as the Supabase extension, now writes 8.0.0-rc.20. Run `contract emit` once after upgrading so the emitted `contract.json` and `contract.d.ts` match the installed extension.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.19"'
---

# 8.0.0-rc.19 → 8.0.0-rc.20 — User upgrade instructions

## Order of the steps

Two changes in this release change storage hashes: the type-alias change (`stored-contracts-expand-type-aliases`) and the re-emitted Supabase contract (`supabase-contract-expanded`). Do the steps in this order, and skip a step that does not apply to the project:

1. Commit your work, so the script's changes can be reviewed and undone with git. Then upgrade the Prisma packages. If the project's Prisma config, tests or tooling load `@prisma/cli-engine` alongside the Prisma toolchain, move it to `0.9.0` (`engine-pin-moves-to-0-9-0`).
2. Rewrite the stored contracts, from the project root, with `scripts/expand-type-aliases/expand-type-aliases.ts` (`stored-contracts-expand-type-aliases`). It leaves a project without type aliases unchanged and says so.
3. Change the contract source as the entries below say: a TypeScript contract drops its `types` key (`ts-types-key-removed`), and a MongoDB schema rewrites the enum members and discriminators the MongoDB entries name.
4. Run `prisma contract emit` (this also covers `contract-artifacts-restamp`).
5. Run `prisma db sign` against every database when step 2 changed a storage hash, or when the project uses the Supabase extension. A database that has not applied every migration needs `--contract`, as `stored-contracts-expand-type-aliases` describes.
6. For each migration that is not applied yet and that `check-expectation` or `check-expectation-raw-sql` matches, run its `migration.ts` again. This is optional.
7. Change the application code and scripts: add `--json` where a script parses a command's output (`piped-output-needs-json`), rename `accessWidening` (`access-changes-rename`), read `meta.schemaIssues` (`schema-verification-failed-schema-issues`), complete SQL builder inserts and ORM creates (`sql-builder-insert-required-columns`, `orm-create-on-update-only-field`), and move Supabase code to `forRole` (`supabase-for-role-replaces-with-role-methods` and the entries after it).

The script path is relative to the directory that holds this guide, which the commands below call `<guide>`.

## Type aliases are written into each column

A type alias is now authoring shorthand only. In PSL, `types { Slug = VarChar(64) }` still works, but the contract no longer stores `Slug` in `storage.types` with a `typeRef` on each column that uses it. Each column stores the alias's codec and parameters itself. In TypeScript, an alias is a constant field builder.

Do the steps in this order: run the script that rewrites the stored contracts (`stored-contracts-expand-type-aliases`), change the TypeScript contract source if you have one (`ts-types-key-removed`), re-emit the contract, and then sign every database.

### `stored-contracts-expand-type-aliases`

Migration snapshots, the emitted `contract.json` and any other stored contract written by an earlier release may have a column with a `typeRef`. This release refuses such a contract and says to re-emit it or run this script. A historical snapshot cannot be re-emitted from today's source, so run the script. Commit your work first so the script's changes can be reviewed and undone with git. Run it from the project root:

```sh
node <guide>/scripts/expand-type-aliases/expand-type-aliases.ts
```

`<guide>` is the directory that holds this guide. Node 24 or later runs the TypeScript script directly; it needs no `tsx`. The script reads and writes files only and needs no database. It rewrites every SQL contract under the root, skipping `node_modules`, `dist`, `build` and every directory whose name starts with `.`, such as `.git` and the worktrees under `.claude/worktrees/`. That includes a test fixture of an old contract: if you keep one on purpose, restore it with git afterwards.

In each contract it replaces every column's `typeRef` with the parameters of the `storage.types` entry it names, and removes each entry a column named. In a contract of your app's own contract space it also removes every entry that no column names. Your app's contract never needs such an entry: it is an alias that the source declares but no field uses, which a re-emit drops as well, or, in a TypeScript source, a `codec-instance` entry that no field uses, which `ts-types-key-removed` tells you to delete. Only an extension's contract space registers a database type. So in a contract of an extension's contract space, such as the copy of pgvector's space in `migrations/snapshots/`, the script keeps an entry that no column names, such as `vector`, and lists it. It makes the same change in the `contract.d.ts` next to the contract. The script tells the spaces apart by the migrations directory: a snapshot that a migration or ref under `migrations/app/` names is your app's, and one that a migration or ref under any other `migrations/<space>/` names is an extension's. A snapshot that no migration or ref names may be either, so the script keeps its unused entries and lists them. The emitted `contract.json` is your app's.

The storage hash changes, so the script renames each changed snapshot directory to its new hash. It rewrites every `migration.json`, ref, `migration.ts` and `contract.d.ts` that names an old hash, and gives each changed migration a new `migrationHash`. When it finishes, it prints how many files it rewrote, how many snapshot directories it renamed, each storage hash it replaced (`<old> -> <new>`), each `storage.types` entry it removed, per contract, and each entry it kept. A project with no `typeRef` is left unchanged, and the script says so. The script replaces the hashes in the import paths of `migration.ts` where they are, so if your project sorts imports with a linter, run its fix command afterwards.

It changes no file and exits 1 in these cases, and names the file:

- a `contract.json`, `migration.json`, `ops.json` or ref is not valid JSON;
- a contract's stored storage hash, or the name of its snapshot directory, does not match its content;
- a column names an alias that `storage.types` does not declare, stores both `typeRef` and `typeParams`, or has a codec or data type other than its alias's;
- a migration goes between two snapshots that become the same snapshot once their aliases are written into their columns, and has no data operation;
- a renamed snapshot directory already exists with different content.

For the first three cases, restore that file from version control, or re-emit it, and run the script again. Two snapshots become the same one when the only change between them was an alias: a migration that replaced `slug VarChar(64)` with `types { Slug = VarChar(64) }` and `slug Slug`, or that renamed an alias. After the upgrade such a migration goes from a snapshot to itself, which only a migration with a data operation may do. The script names each such migration that has no data operation. Delete its directory and run the script again. When that migration is your latest, nothing else names its target snapshot, so the script names that snapshot directory too; delete it as well. The script then writes the hash of the merged snapshot into every `migration.json`, ref and `migration.ts` that names either old hash, and gives each changed migration a new `migrationHash`. A migration with a data operation keeps its operations and goes from the merged snapshot to itself. If it stops partway, for example on a full disk, it says so; run it again to finish.

If you upgrade from a release before 8.0.0-rc.19 and also run `remove-nocheck.ts` from the 8.0.0-rc.18 to 8.0.0-rc.19 guide, the two scripts may run in either order: each checks the hash of the content it reads.

Then re-emit the contract with `prisma contract emit`. A contract written in PSL gives the contract the script wrote, so the latest snapshot, the head ref and the emitted contract keep one storage hash. A contract written in TypeScript needs `ts-types-key-removed` first.

Each database's marker still holds the old storage hash, so `prisma db verify` and `prisma db migrate` refuse it until you sign it. The database itself does not change. After the re-emit, run `prisma db sign` against every database (development, staging, production):

```sh
prisma db sign --db "$DATABASE_URL"
```

A plain `prisma db sign` signs the database against the emitted contract, so it signs only a database that has applied every migration. A database that has not, such as production while the latest migrations wait for review, is refused: `db sign` says its schema does not satisfy the contract, and `prisma db migrate` stops with `MIGRATION.MARKER_MISMATCH`, because the marker holds an old hash that no migration names any more. Sign such a database with the contract of the last migration it applied, then migrate it:

```sh
prisma db sign --contract <the last migration it applied> --db "$DATABASE_URL"
prisma db migrate --db "$DATABASE_URL"
```

`--contract` takes the migration's directory name, such as `20260917T0818_add_post_expires_at`, or the new hash that migration goes to. To find it, run `prisma migration status` against the database. It prints the start of the old hash the marker holds: `Database marker <hash> is not in the on-disk migration graph`. The error of `prisma db migrate` prints the whole hash: `The database's marker names <hash>`, or `DB marker is <hash>` before 8.0.0-rc.21. Recover with `db sign --contract` as this section says, not with the error's next actions: the marker is outside the migration graph only because the upgrade gave the migrations new hashes. Find the line of the script's `<old> -> <new>` list whose old hash is that one. The new hash on that line is the one to sign with, and the migration that goes to it is the last one the database applied.

The script has already written the new hash into each ref, so when `db sign` advances a ref, such as `migrations/app/refs/db.json`, it prints the new hash twice: `Advanced ref "db" → <new hash> (was <new hash>)`. This is expected, and the database is signed.

The script also gives each rewritten migration a new hash, and the database's migration history keeps the old ones. After the upgrade, `prisma migration status` therefore no longer marks the migrations applied before it as applied, although it still reports the database as up to date. `prisma db migrate` runs none of them again, and `prisma db verify` passes.

### `psl-alias-attributes`

There is nothing to change. PSL gains two things:

```prisma
types {
  Slug      = VarChar(64)
  UpdatedAt = TimestampString(3) @onCreate(now()) @onUpdate(now())
}

model Post {
  id        String             @id @onCreate(uuid())
  slug      Slug
  createdAt temporal.CreatedAt
  updatedAt UpdatedAt          @default(now())
}
```

- An alias may carry `@default`, `@onCreate` and `@onUpdate`. Each field typed by it gets them. A field may add an attribute its alias does not set, but writing one the alias already sets is the error `PSL_DUPLICATE_ATTRIBUTE`. `@id` and `@unique` belong on the field, not the alias.
- Postgres, SQLite and MongoDB contribute `temporal.CreatedAt` and `temporal.UpdatedAt`, written bare as a field type. Each stores exactly what the field presets `temporal.createdAt()` and `temporal.updatedAt()` stored. 8.0.0-rc.21 removes field presets, and its upgrade guide gives the replacement of every preset. Postgres also has `temporal.CreatedAtString`, `temporal.UpdatedAtString`, `temporal.CreatedAtJsDate` and `temporal.UpdatedAtJsDate`.

### `ts-types-key-removed`

Write an alias as a constant field builder and use it as the field:

```ts
// Before
({ field, model, type }) => {
  const types = { Embedding1536: type.pgvector.Vector(1536) } as const;
  const Post = model('Post', {
    fields: {
      embedding: field.namedType(types.Embedding1536).optional(),
    },
  });
  return { types, models: { Post } };
}

// After
({ field, model, type }) => {
  const Embedding1536 = field.column(type.pgvector.Vector(1536));
  const Post = model('Post', {
    fields: {
      embedding: Embedding1536.optional(),
    },
  });
  return { models: { Post } };
}
```

A field builder is immutable, so one constant serves every model. `type.*` now has a helper for every PSL type constructor of the stack, such as `type.VarChar(64)` and `type.TimestampString(3)`, and for the contributed aliases, such as `field.column(type.temporal.UpdatedAt())`. A string such as `field.namedType('Slug')` named an alias the same way; replace it with the alias's constant.

`field.namedType(...)` still takes an enum handle, such as `field.namedType(Priority)`; leave those calls alone.

A `types` key left in the definition fails with `CONTRACT.TYPES_KEY_REMOVED`. An entry may also be written `{ kind: 'codec-instance', codecId: ..., typeParams: ... }`. If a field uses it, through `field.namedType(types.X)` or `field.namedType('X')`, replace it with a constant `field.column(type.Y(...))` of the same type and parameters, as above. If no field uses it, delete it. Your app's contract space never needs a registered database type: only an extension's contract space registers one, under `databaseTypes`. The script removed such an entry from your stored contracts and listed it in its summary, so the re-emit gives the storage hash the script wrote.

Two calls that set the same thing on one builder now fail instead of the second one winning. `.default()` on a builder that already has a default throws `CONTRACT.DEFAULT_INVALID` with reason `default-set-twice`, and `.onCreate()` or `.onUpdate()` on a builder that already sets that phase throws, as before.

Re-emit the contract. If you ran `stored-contracts-expand-type-aliases`, the column gets the same type and parameters it had, so there is nothing more to sign or migrate.

### `supabase-contract-expanded`

The `@prisma/orm-extension-supabase` contract is re-emitted from its PSL, which keeps its nine aliases. The contract no longer stores them in `storage.types`, and each column stores its own type. The Supabase space's storage hash changes from `292489649ae6d6928de98a32b544bd9caf6b7d49718c10fe2720b83545a4b5a2` to `110ad99e1e466691bdb0a4349a17365561e76ad017f58beb272f4496b05b8e9e`.

A contract that composes the Supabase space references it by id, so this change does not touch your own `contract.json` and `contract.d.ts`. Only the extension version stamped in them moves, which `contract-artifacts-restamp` covers. A database that was signed against the previous Supabase contract no longer matches the new hash, so run `prisma db sign` against it after upgrading. The Supabase database itself does not change.

## The CLI engine is 0.9.0, and piped output needs `--json`

### `engine-pin-moves-to-0-9-0`

This applies to a project whose Prisma config, tests or tooling load `@prisma/cli-engine` alongside the Prisma toolchain. A separate CLI that the project builds on the engine runs its own engine, so it does not have to move with this upgrade.

For every `package.json` or `pnpm-workspace.yaml` catalog matched by `detection`, change the `@prisma/cli-engine` version (`0.7.0`, `^0.7.0` or any other 0.x below 0.9) to `0.9.0` and reinstall. Projects assembled by the `prisma` CLI resolve the engine automatically.

### `piped-output-needs-json`

Engine 0.9.0 chooses the output format from flags only. Before, a command whose stdout was not a terminal (a pipe, a file, `$(…)`, a CI log or an agent) printed JSON frames. Now it prints the human card on stderr and the command's data lines on stdout. JSON needs `--json`.

Find every place that runs a Prisma ORM command and parses its stdout as JSON: `package.json` scripts and shell scripts that pipe into `jq`, CI steps, and code that spawns `prisma` and calls `JSON.parse` on its output. Add `--json` to each such command. For example, `prisma migration status | jq '.envelope.result'` becomes `prisma migration status --json | jq '.envelope.result'`.

A script that only needs a list or a value can read the data lines instead. Fields are separated by a tab and come in the order below. A field whose JSON value is null or absent is an empty field. A backslash, tab, newline or carriage return inside a value is written as `\\`, `\t`, `\n` or `\r`. Paths are relative to the working directory. New fields are only ever added at the end of a line.

- `migration list`: space, name, from, to and operation count, one line per migration.
- `migration status`: space, name, from, to, operation count and status (`applied`, `pending`, or empty when the JSON status is null), one line per migration.
- `migration log`: applied at, space, name, from, to and operation count, one line per applied migration.
- `migration graph`: space, name, from and to, one line per migration; with `--dot`, the DOT text.
- `migration show`: `key<TAB>value` lines, then one `operation` line per operation.
- `migration check`: space, code and where (the path the failure is about), one line per failure.
- `migration new` and `migration plan`: the directories written.
- `migration ref list`: name, hash and comma-separated invariants, one line per ref. `migration ref set`: the hash the ref points at.
- `db migrate`: space, name, from, to and operations run, one line per applied migration; with `--show`, space, name, from and to per migration that will run.
- `db sign`: space, status and contract storage hash, one line per space.
- `orm init`: the paths of the files written.
- `contract emit`: the paths of `contract.json` and `contract.d.ts`. `contract infer`: the path written. `contract format`: the paths formatted. `contract print`: the PSL.

`db init`, `db update`, `db verify`, `db schema` and `migration ref delete` print nothing on stdout; their exit code is the result, and `--json` carries the document. An error in a pipe is now human text on stderr, with the same exit code.

## `accessWidening` is renamed `accessChanges`

`db update` asks about each operation that changes who can read or write a model's data. Such an operation does not always widen access, so the list of them is now `accessChanges`, and the option that answers all of them is `acceptAccessChanges`. Rename each use:

```ts
// Before
const result = await client.dbUpdate({ contract, mode: 'apply', migrationsDir, acceptAccessWidening: true, answerQuestions });
if (result.ok) console.log(result.value.accessWidening);

// After
const result = await client.dbUpdate({ contract, mode: 'apply', migrationsDir, acceptAccessChanges: true, answerQuestions });
if (result.ok) console.log(result.value.accessChanges);
```

A script that reads `prisma db update --dry-run --json` reads `accessChanges` in place of `accessWidening`. The output is one JSON object per line, and the result is in the last one:

```bash
prisma db update --dry-run --json | jq -s 'last | .envelope.result.accessChanges'
```

The question `db update` asks now ends with "who can read and write its data" in place of "who can read and write its rows". A script that matches the question text changes the same way.

## A removed namespace is asked about

If your contract removes a `namespace` block on Postgres, the next `migration plan` or `db update` asks about each model that namespace held, as it asks about any model you remove.

If you renamed the block, for example from `billing` to `finance`, give the rename and nothing is dropped:

```bash
prisma db update --rename billing:finance
```

Otherwise the namespace is removed. A script that runs without a terminal fails with `CLI.CONSENT_REQUIRED`, listing each model. To drop them all and the schema, add `--delete <namespace>`:

```bash
prisma db update --delete billing
```

To keep a model's data, move it to a namespace the contract keeps in the same run, for example `--rename billing.Invoice:public.Invoice`, or put the namespace back in the contract.

A table in that schema that no contract declared, such as one created by hand, is asked about too, by its storage name: `--delete billing.audit_log`. `--delete billing` does not answer it. Another object no contract declared, such as a view or a function, makes the run fail and changes nothing: a view on one of the tables stops that table's drop, and any other object stops the schema drop. The failure names each object; drop or move it yourself, then run the command again.

A namespace that only another contract space declares, and a schema no contract ever declared, such as Supabase's `auth`, are still left alone.

## The schema check's differences are in `meta.schemaIssues`

When `db verify` or `db sign` finds that the database schema does not match the contract, its `--json` output has a diagnostic with the code `CONTRACT.SCHEMA_VERIFICATION_FAILED`. Its `meta.issues` was a list of label strings, such as `"missing: public/users/email"`. It is now `meta.schemaIssues`, a list of issue objects, the same key and shape the `MIGRATION.SCHEMA_VERIFY_FAILED` failure of `db init`, `db update` and `db migrate` already uses. `meta.space` and `meta.code` are unchanged, and so is `schema.issues` in the result of a check that passed.

Each issue has a `path`, the location of the difference as a list of names, and `expected` and `actual`, the contract's and the database's side, one of which is absent for a missing or an extra object. It has an `explanation` with a `text` when the CLI can say more.

In code that reads the diagnostic, read `meta.schemaIssues` where it read `meta.issues`. Where it used the label strings, build them from the issue. A label was the outcome, then the path: `missing` when only `expected` is set, `extra` when only `actual` is set, and `mismatch` when both are:

```typescript
// before
const labels: string[] = diagnostic.meta.issues;
// after
const labels = diagnostic.meta.schemaIssues.map((issue) => {
  const outcome = issue.actual === undefined ? 'missing' : issue.expected === undefined ? 'extra' : 'mismatch';
  return `${outcome}: ${issue.path.join('/')}`;
});
```

The `why` of the diagnostic still lists every difference as text.

## Checks say which object they expect absent or present

Before an operation runs, the migration runner runs its prechecks. When one fails, the error's `why` named the check and said only that it failed on this database. A check that expects one object to be absent or present can now carry that as data, in `expectation`, and the `why` then says what the database already has or lacks. On MongoDB, a check carries the object's name in `object`, and its `expect` says whether it should exist.

Nothing breaks without it. An `ops.json` that has no `expectation` reads, verifies its hash and runs as before.

### Migrations Prisma writes

The PostgreSQL, SQLite and MongoDB operations now write it on every check that asks only whether one object exists. A matched `ops.json`, or a MongoDB `ops.json` written before this change, gains it when you write it again: run its `migration.ts` (`node migration.ts`). Writing it again changes its hash, so do this only for a migration that no database has applied yet. Leave an applied migration as it is.

### Checks you write yourself

In your app's migrations, a check you write in a `rawSql` operation can carry it too. Add `expectation` to the precheck or postcheck step, with `expects: 'absent'` or `'present'` and the object as a reader would name it, then run `node migration.ts`:

```typescript
rawSql({
  // ...
  precheck: [
    {
      description: 'verify extension "vector" is not already enabled',
      sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
      expectation: { expects: 'absent', object: 'extension "vector"' },
    },
  ],
})
```

Leave it out of a check about data or about several objects at once, such as a check that a column holds no NULL values.

## MongoDB values are written in the syntax of their data type

MongoDB PSL now reads every enum member the way SQL PSL does: by the syntax it is written in, then the casts of the enum codec's data type, then the codec. The MongoDB target has an authoring entry or a cast for every data type except `mongo/bson`:

- a quoted string is `mongo/string`, and `true` and `false` are `mongo/bool`;
- a number is the smallest type that holds it: `mongo/int32`, `mongo/int64`, `mongo/decimal128` when a Decimal128 holds it exactly, `NaN` and the infinities included, and `mongo/double` otherwise;
- the `date`, `binary` and `json` tags write `mongo/date`, `mongo/binary` and `mongo/json`.

A member that was quoted to get a number through the JSON reader is now text, and a member that was written with a fraction on an integer enum is now a Decimal128 value. Rewrite each as the change entries above say:

```prisma
enum Ratio {
  @@type("mongo/double@1")
  Unknown = NaN
  Half    = 0.5
}

enum Level {
  @@type("mongo/int32@1")
  One = 1
}
```

Discriminators follow one rule in both families: the field must be required, hold one value, and have one of the stack's text data types, and when an enum types it, each `@@base` value must be one of its members. A field is text by its data type, so on MongoDB a type alias of `String` is now a discriminator.

An enum on an Int64, Date, Decimal128, Binary or ObjectId codec, or a Double enum with a `NaN` or infinite member, is still refused when a collection the contract manages uses it, because a collection validator cannot list those members.

## Inserts must include the columns the database requires

The SQL builder's `insert` used to accept a row that left out any column. A row without a value for a column that is not nullable and has no default compiled, and then the database rejected it with a not-null error. The row type now requires those columns:

```typescript
// User.displayName is `String` with no default
db.sql.public.user.insert([{ email: 'admin@example.com', kind: 'admin' }]);
// error: Property 'displayName' is missing

db.sql.public.user.insert([{ email: 'admin@example.com', kind: 'admin', displayName: 'Admin' }]);
```

A column is still optional when it is nullable, when it has a default (`@default(...)`, including `now()` and `autoincrement()`), or when the client generates its value on create with `@onCreate(...)` or a preset that generates on create. Rows in one `insert` call are checked one by one, so they may set different optional columns.

For each insert that stops compiling, add a real value for each column the error names. Do not cast the row. A required property does not accept `undefined`, so a value typed `T | undefined` for one of these columns is now an error too: check it before the insert. Rows built in a variable and passed as `insert(rows)` get the same check, so give the variable the row type or build each row with every required column.

### ORM create for fields that generate only on update

A field generates its value on update only when it has `@onUpdate(...)` without `@onCreate(...)`, or when a temporal preset sets only its update phase: `temporal.timestamptz(onUpdate: now)` and `temporal.timestamp(3, onUpdate: now)` in PSL, `field.temporal.timestamptz(undefined, undefined, 'now')` in TypeScript. Such a field that is not nullable and has no default was optional in ORM `create` input, and the create then failed in the database. It is now required. Pass a value for it on create, or make it generate on create too: add `@onCreate(...)`, or set the preset's create phase (`temporal.timestamptz(onCreate: now, onUpdate: now)`).

## Supabase runs every role operation through one object

`SupabaseRuntime.forRole(binding)` returns a `SupabaseRoleScope`, the runtime operations under one role: `query`, `execute`, the prepared-statement operations and `connection`. Run a transaction under the role with `withTransaction(runtime.forRole(binding), fn)`.

| Type | New required members |
| --- | --- |
| `RoleBoundDb`, `ServiceRoleDb` | `enums`, `nativeEnums` |
| `SupabaseTransactionContext` | `enums`, `nativeEnums` (it is now `PostgresTransactionContext`) |
| `SupabaseRuntime` | `forRole(binding)`, in place of the four `*WithRole` methods |

```ts
// Before
const rows = await runtime.queryWithRole(plan, { role: 'anon' }).toArray();
const stats = await runtime.executeWithRole(plan, { role: 'anon' });
const named = await runtime.preparedQueryWithRole(statement, params, { role: 'anon' }).toArray();

// After
const anon = runtime.forRole({ role: 'anon' });
const rows = await anon.query(plan).toArray();
const stats = await anon.execute(plan);
const named = await statement.query(anon, params).toArray();
```

The `pg` option takes a `pg.Pool`:

```ts
// Before
const db = await supabase({ contract, pg: new Client({ connectionString }), jwtSecret });

// After: close() does not end a pool you pass in, so keep it and end it at shutdown
const pool = new Pool({ connectionString });
const db = await supabase({ contract, pg: pool, jwtSecret });
// ...
await db.close();
await pool.end();

// Or let Supabase create and end the pool
const db = await supabase({ contract, url: connectionString, jwtSecret });
```

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the extension's embedded `version` moving to `8.0.0-rc.20`; any other difference in the emitted files comes from an earlier entry in this guide.
