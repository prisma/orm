# Better Auth works with Prisma 8

Linear project: [P-TML-1174](https://linear.app/prisma-company/project/better-auth-works-with-prisma-8-6d06f95f118b).

## Purpose

An application on Prisma 8 can use Better Auth. Today it cannot: Better Auth's own Prisma adapter calls the Prisma 7 client (`prisma.user.findFirst(...)`, `$transaction`, error code `P2025`), and Prisma 8 has none of that. Better Auth's docs tell users to pin Prisma 7 (better-auth/better-auth#9636).

## At a glance

```ts
// src/lib/auth.ts
import { betterAuth } from 'better-auth';
import { prismaAdapter } from '@prisma/orm-better-auth';
import { db } from './db'; // the application's ordinary Prisma 8 client

export const auth = betterAuth({
  database: prismaAdapter(db),
  emailAndPassword: { enabled: true },
});
```

The auth models live in the application's own contract, beside its other models. When the contract lacks something the auth configuration needs, `auth generate` says what to add and writes no file. The output below is abbreviated; the two-factor plugin has more fields than shown.

```text
$ npx auth@latest generate
Your Prisma contract is missing models or fields that Better Auth needs.

Add to your contract:

model User {
  twoFactorEnabled Boolean?
  twoFactors       TwoFactor[]
}

model TwoFactor {
  id          String @id
  secret      String
  backupCodes String
  userId      String
  user        User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([secret])
  @@index([userId])
  @@map("twoFactor")
}

Then run `prisma contract emit` and update your database.
```

The same text is raised on the application's first request when its contract is incomplete, and by `auth check`.

## How Better Auth and Prisma 8 fit together

Better Auth is a library inside the application server. It reaches storage only through the `database` option, an adapter object with a fixed set of methods (`create`, `findOne`, `findMany`, `count`, `update`, `updateMany`, `delete`, `deleteMany`, `transaction`, and optional `consumeOne`, `incrementOne`, `createSchema`). Each call names a model and its fields as strings. Better Auth derives the tables it needs from its configuration: four core tables (`user`, `session`, `account`, `verification`), plus tables and columns that plugins add, plus `additionalFields`, with optional renames.

A Prisma 8 client is built from a contract and exposes an ORM client (`db.orm`) whose models are looked up by name at run time and checked against the contract. The adapter translates each Better Auth call into ORM client calls.

## Decisions

Each decision gives its reason. The implementation follows these exactly. Where a decision cannot be followed as written, the implementer stops and reports; they do not choose an alternative.

### Package

1. **One published package, `@prisma/orm-better-auth`, at `packages/9-public/@prisma/orm-better-auth/`.** It is versioned in lockstep with the other published packages, with `"license": "Apache-2.0"` and the `repository` field the other published packages have (`directory` set to its own path). It is developed in this repository for now and is built to be moved out: it holds its own source and tests, no package under `packages/` depends on it, and it is not a framework extension (no pack, no contract space, no entry in any extension list or in the published-shells table). Its name follows the rule for library integrations, `@prisma/orm-<library>`. Its manifest lists the `prisma-orm-extension` keyword, which marks every Prisma 8 package of any kind so that a search finds it. One command reads that keyword: `prisma orm init --target @prisma/orm-better-auth` installs the package and then refuses it because it has no `/init` entrypoint, as it does for the extension packages.
2. **It imports only published entrypoints.** No `@internal/*` import or manifest entry. No `@repo/*` name except `@repo/tsconfig` and `@repo/tsdown` in `devDependencies`. Two checks enforce this:
   - `scripts/lint-consumer-internal-imports.mjs` gains `packages/9-public/@prisma/orm-better-auth` in `CONSUMER_SCOPES`, with a comment saying the adapter is held to the consumer rule because it must work outside this repository. `scripts/lint-consumer-internal-imports.test.mjs` is updated. That lint covers `@internal/*`.
   - A test in the package reads its own `package.json` and every file under `src/` and `test/` except the test's own file, and fails on any other `@repo/*` name.

   Reason: the package must keep working when it leaves this repository, and it shows that an outside library can be integrated through the public interface alone.
3. **Hand-written source in `src/`, unlike the other published packages**, which are generated shells over private packages. Consequences, each part of this project:
   - `architecture.config.json` gains the glob `packages/9-public/@prisma/orm-better-auth/**` with domain `extensions`, layer `integrations`, plane `runtime`.
   - `tsdown.config.ts` uses the base `defineConfig` from `@repo/tsdown`, not `defineShellConfig`.
   - The package has a `README.md` with a `## Responsibilities` heading, a `coverage.config.json` covering `src/**/*.ts` with thresholds of 90 for lines, branches, functions and statements, a `vitest.config.ts`, `biome.jsonc`, `tsconfig.json` and `tsconfig.prod.json`, and the `build`, `test`, `typecheck` and `lint` scripts a private package such as `packages/3-extensions/middleware-cache` has.
   - `docs/reference/Package Naming Conventions.md` gains a kind for library integrations, and its count of `@prisma` packages changes.
   - Tests take their timeouts from a `test/timeouts.ts` with named constants that apply `TEST_TIMEOUT_MULTIPLIER`, because the shared timeouts helper is a `@repo` package.
4. **Dependencies.**
   - `peerDependencies`: `@prisma/orm-family-sql` and `@prisma/orm-framework` at the exact workspace version; `@better-auth/core` `>=1.7.6 <1.8.0` (1.7.6 is the first release with both `registerSchemaCheck` and the `auth check` command); `typescript` `>=5.9`, optional in `peerDependenciesMeta`.
   - `dependencies`: none.
   - `devDependencies`: the two Prisma peers; `better-auth`, `@better-auth/core` and `@better-auth/test-utils` pinned to one exact 1.7 version; the first-party Better Auth plugin packages the PSL test needs (`@better-auth/api-key`, `passkey`, `sso`, `oauth-provider`, `scim`) at the same version; `@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/dev`, `pg`, `@types/pg`, `temporal-polyfill`, `pathe`; and the build and test tooling every package has (`vitest`, `typescript`, `tsdown`, `@types/node`, `@repo/tsconfig`, `@repo/tsdown`).

   Reasons. The application's database package always installs the family and framework packages, so exact peers give one copy of the ORM client's filter functions, and a version skew is reported by the package manager (as an error under strict peers, as a warning otherwise) instead of silently loading a second copy; the extension packages hold their target the same way. The Better Auth range stops below 1.8 because the adapter uses an entrypoint Better Auth labels internal (decision 37); widening the range is a change that first runs the conformance suites against the new minor. `src/` never imports a database package (`@prisma/orm-postgres` and the like).
5. **One export, `.`**, with `prismaAdapter` and the `PrismaAdapterOptions` type. ESM only.
6. **Code style follows this repository** (no `any`, no bare `as`: the cast helpers from `@prisma/orm-framework/utils/casts`; no comments that restate code). It also follows two Better Auth rules that cost nothing here, because the code may later be offered to their repository: no classes, and no Node-only API in `src/`.
7. **Errors the adapter raises are Better Auth errors, not Prisma error envelopes.** Each is a `BetterAuthError` from `@better-auth/core/error`. Reason: Better Auth and its CLI recognise that class and its `code` property. Errors from the ORM client pass through unchanged.

### The adapter function

8. **Signature.** `prismaAdapter(db, options?)` returns the function Better Auth expects, `(betterAuthOptions) => DBAdapter`. It is built with `createAdapterFactory` from `@better-auth/core/db/adapter`. Better Auth's options are captured on each call of the returned function, not once per `prismaAdapter` call.
9. **`db` is a Prisma 8 Postgres or SQLite client.** The parameter type is structural: an object with `contract` (a SQL contract), `orm` and `transaction(fn)`. No database-specific type is named, because no shared client type is published. There is no `provider` option. `prismaAdapter` throws a `BetterAuthError` when:
   - `db` has no `contract`: ``prismaAdapter needs the Prisma client, not a transaction.``
   - `db.contract.target` is neither `"postgres"` nor `"sqlite"`: ``@prisma/orm-better-auth supports Postgres and SQLite. This client's database is "<target>".``

   - the `namespace` option names a namespace that `db.contract.domain.namespaces` does not have: ``Namespace "<name>" is not in your Prisma contract.`` This covers SQLite, whose contract has no named namespaces.

   Reason for refusing other databases: on MySQL the filters of decision 21 give wrong answers (`length()` counts bytes, and the default collation ignores case). Refusing is honest until that is fixed and proven.
10. **Options.**

    | Option | Type | Default | Meaning |
    | --- | --- | --- | --- |
    | `namespace` | `string` | none | The contract namespace (a Postgres schema name) that holds the auth models. Needed only when the same model name exists in more than one namespace. |
    | `usePlural` | `boolean` | `false` | Better Auth's model names gain an `s`. |
    | `transaction` | `boolean` | `false` | When `true`, Better Auth's `transaction(cb)` runs in a database transaction. |
    | `debugLogs` | Better Auth's `debugLogs` type | none | Passed to the factory. |

    `transaction` defaults to `false` because Better Auth's own Prisma and Drizzle adapters do, so an upgrading application behaves as before, and because of the SQLite limit in decision 29.
11. **Factory configuration.** `adapterId: "prisma-8"`, `adapterName: "Prisma 8"`, `usePlural` and `debugLogs` from the options, `supportsDates: true`, `supportsBooleans: true`, `supportsNumericIds: true`, `supportsJSON: false`, `supportsArrays: false`, `supportsUUIDs: false`. No key or value transform hooks. Reasons: dates and booleans pass through as JavaScript values on both databases. JSON and list fields are stored as text (decision 34). With `supportsUUIDs: false` Better Auth generates UUID strings itself, so the id column needs no database default. The id is not `"prisma"`, which is Better Auth's Prisma 7 adapter: `auth migrate` and other code treat that id as Prisma 7.
12. **The inside is untyped.** No type parameter ties the client's contract to Better Auth's models; no published mechanism can express "a client whose contract contains these models". Correctness comes from the contract at run time, the contract check (decision 37) and the tests.

### Finding models and fields

13. **Better Auth's names are matched to the contract's model and field names, not to table and column names.** Better Auth passes a physical model name (after its `modelName` rename and `usePlural`) and database field names (after its `fields` rename). A field name must equal a contract field name. Table and column names come from the contract's `@@map` and `@map`. Reason: this is what Better Auth's Prisma 7 adapter does, so an application that upgrades keeps its auth configuration and its Prisma model names.
14. **Model lookup.** The adapter reads `db.contract.domain.namespaces`.
    - Which namespaces are searched: with the `namespace` option, only that one. Without it, all of them.
    - Step one looks for a model whose name equals the physical model name. Only if no searched namespace has one, step two looks for the name with its first letter upper-cased (`user` finds `User`).
    - In either step, a name found in more than one namespace raises a `BetterAuthError`: ``Model "<name>" is in more than one namespace of your Prisma contract (<a>, <b>). Set the adapter's "namespace" option.``
    - The model's collection is `db.orm[Model]` when the contract's only namespace id is `UNBOUND_DOMAIN_NAMESPACE_ID` (from `@prisma/orm-framework/contract/default-namespace`; SQLite), and `db.orm[namespaceId][Model]` otherwise.
15. **A model the contract lacks** raises a `BetterAuthError`: ``Model "<name>" is not in your Prisma contract. Run `npx auth@latest generate` to see what to add.`` The ORM client returns `undefined` for an unknown model, so the adapter must raise this itself. A field the contract lacks raises the ORM client's own `ORM.FIELD_UNKNOWN` error, unchanged.
16. **A Better Auth model or field name that is not a valid PSL identifier** (letters, digits and `_`, not starting with a digit) raises a `BetterAuthError` naming it and the Better Auth option that renames it (`modelName` or `fields`): ``Better Auth's model name "<name>" is not a valid Prisma model name: use letters, digits and "_", not starting with a digit. Rename the model with Better Auth's "modelName" option.``, and the same for a field, naming the model and the `fields` option. When the contract check or `createSchema` meets such a name, the error carries `code: "SCHEMA_MISMATCH"` like the error of decision 40, so `auth check` and `auth generate` print the message and exit 1. It can neither be matched nor printed.
    - **Two Better Auth model names that differ only in the case of the first letter** (a core `user` and a plugin model with `modelName: "User"`) are refused the same way. The lookup and the printed PSL would give both one model name, and SQLite table names ignore case. The collision is found over every model of Better Auth's table description (`betterAuthModels`), the same list for the contract check, `createSchema` and calls. The check reports it as the only problem for the configuration, and every call raises the error of decision 40: ``Better Auth's models "user" and "User" have names that differ only in the case of the first letter. Prisma matches both to the model "User", and SQLite cannot hold both tables. Set a different "modelName" on one of them in your Better Auth configuration.``
17. **Lookups are computed once per adapter instance** and kept, since the contract does not change. An adapter instance is one `DBAdapter` produced by one call of the function `prismaAdapter` returns; its lookups depend on that call's Better Auth options. The adapter built for a transaction (decision 28) reuses them.

### Calls

The inner adapter receives database field names and already-converted values from the factory. `select` and `sortBy.field` arrive as Better Auth field names and are mapped with the factory's `getFieldName`.

18. **Every call applies a filter first.** For an empty or absent Better Auth `where`, the filter is `where(() => all())`. Reason: without `where`, the ORM client's `update()` and `delete()` act on one arbitrary row.

    | Better Auth call | ORM client call | Returns |
    | --- | --- | --- |
    | `create` | `create(data)` | the created row |
    | `findOne` | `where(f).select(...).first()` | the row or `null` |
    | `findMany` | `where(f).select(...).orderBy(...).limit(n).offset(n).all()` | the rows |
    | `count` | `where(f).aggregate(a => ({ n: a.count() }))` | `n` |
    | `update` | `where(f).update(data)` | the updated row or `null` |
    | `updateMany` | `where(f).updateAndCount(data)` | the number of rows matched |
    | `delete` | `where(f).deleteAndCount()` | nothing; every matching row is deleted, as Better Auth's own adapters do |
    | `deleteMany` | `where(f).deleteAndCount()` | the number of rows deleted |

    - `select`: when Better Auth passes one, those fields. When it passes none, `findOne` and `findMany` select `id` and every field of Better Auth's table description for the model. Reason: Better Auth's fallback of decision 20 compares every column a read returns, so columns the application added to an auth model must not be returned. With `validateSchema: false` and a contract that lacks one of those fields, the read raises the ORM client's `ORM.FIELD_UNKNOWN`; the README says that turning the check off does not make an incomplete contract work.
    - `orderBy` only when `sortBy` is given, as `field.asc()` or `field.desc()`. `offset` only when given. `limit` always (Better Auth always passes one to `findMany`).
19. **A filter or sort the field's type does not support is refused with a clear error.** The ORM client leaves a comparison or ordering method off a field whose codec lacks the trait, and calling it would throw a bare `TypeError`. Before calling a method on a field, the adapter checks it exists; when it does not, it throws a `BetterAuthError`: ``Field "<Model>.<field>" (<codec id>) does not support <operator>.``, with `sorting` as the operator for `sortBy`. A `Boolean` field cannot be sorted on in Prisma 8; the README says so. The pattern operators and `mode: "insensitive"` are refused the same way on a field that is not a single scalar, and on a field whose codec decision 32's table gives a kind other than `string`, `enum` included, because Postgres has no `lower`, `substr` or `replace` for an enum; a field with an unknown codec is tried.
20. **`consumeOne` and `incrementOne` are not implemented.** The factory then uses its own fallback: it reads the row, then deletes or updates it with a filter on the row's id and on every value it read, and succeeds only when exactly one row was affected. Reason: the ORM client has no single statement that deletes one row and returns it, and no `x = x + 1` update. The fallback needs exact matched-row counts, which `updateAndCount` and `deleteAndCount` give in one statement. This keeps every call in the ORM client.
21. **Filters.** Better Auth's `where` is a flat list. Clauses whose `connector` is `OR` form one `or(...)` group; every other clause is an `AND` clause. The filter is `and(...andClauses)` when there is no `OR` clause, `or(...orClauses)` when there is no `AND` clause, and `and(...andClauses, or(...orClauses))` otherwise. This is how every Better Auth SQL adapter reads the list.

    | Operator | Filter |
    | --- | --- |
    | `eq` | `field.eq(value)`; with `null`, `field.isNull()` |
    | `ne` | `field.neq(value)`; with `null`, `field.isNotNull()` |
    | `lt`, `lte`, `gt`, `gte` | the same-named method |
    | `in` | `field.in(values)` after dropping `null` entries; an empty list matches no row (`or()`) |
    | `not_in` | `field.notIn(values)` after dropping `null` entries; an empty list matches every row (`and()`) |
    | `starts_with` | `substr(field, 1, length(value)) = value` |
    | `ends_with` | `substr(field, length(field) - length(value) + 1) = value` |
    | `contains` | `replace(field, value, '') <> field` |

    For the three pattern operators, an empty string value becomes `field.isNotNull()`, in sensitive and insensitive mode alike.
22. **Pattern operators do not use `LIKE`.** Each side of the comparison is a raw expression built with the `fns.raw` tool of the ORM client's `where` callback, returning the field's own codec id, and the two sides are compared with `fns.eq` or `fns.ne`. Values are bound parameters. Reasons: Prisma 8's `like` has no escape clause, so `%` and `_` in a value would act as wildcards; SQLite's `LIKE` ignores ASCII case, so a case-sensitive `contains` would match the wrong rows; and this form is the same SQL on both databases with no table of codec ids.
23. **`mode: "insensitive"`** applies to `eq`, `ne`, `in`, `not_in` and the three pattern operators, and only when the value is a string or, after `null` entries are dropped, a non-empty list of strings. For any other operator or value the mode is ignored. Both sides are lower-cased in SQL, never in JavaScript, so a value always matches itself. With `F` = `lower(field)` and `V` = `lower(value)`, the value bound as given:

    | Operator | Filter |
    | --- | --- |
    | `eq` | `F = V` |
    | `ne` | `F <> V` |
    | `in` | `or(...)` of `F = V`, one per value |
    | `not_in` | `and(...)` of `F <> V`, one per value |
    | `starts_with` | `substr(F, 1, length(V)) = V` |
    | `ends_with` | `substr(F, length(F) - length(V) + 1) = V` |
    | `contains` | `replace(F, V, '') <> F` |

    Every occurrence of the field is `F`. On SQLite, `lower()` folds ASCII letters only, so non-ASCII letters match only in the same case; the README says so.

### Joins

24. **Without `advanced.database.joins`, the adapter never sees a join**; Better Auth runs separate queries. With it, the adapter receives a join description per joined model: the joined table's physical model name, the two join columns, a row limit and whether it is one-to-one.
25. **A join is served by `include` when the base model declares a matching relation**: a relation whose target model and namespace are the joined model's (found by decision 14), and whose local and target fields are the two join columns. To-many relations use `include(relation, r => r.limit(limit))`; to-one relations use `include(relation)`. The included rows are moved from the relation's name to the join description's key. The contract's cardinality decides the form; Better Auth accepts an array or an object for either kind of join, so the adapter does not compare cardinalities.
26. **When no matching relation is declared, the adapter leaves that key out**, and Better Auth fetches the joined rows itself with one query per row. The adapter writes a debug log line through the factory's `debugLog` saying which join fell back. Reason: relations are optional in a Prisma 8 contract, and Better Auth documents this behaviour for adapters. The README says that joins need the relations.

### Transactions

27. **With `transaction: false` (the default), the factory runs Better Auth's `transaction(cb)` without a database transaction.** The adapter passes `transaction: false` to the factory.
28. **With `transaction: true`, `transaction(cb)` runs `cb` inside `db.transaction`**, with an adapter built over `tx.orm`. That inner adapter is the same code with the factory's `transaction` set to `false`, bound to the Better Auth options of the outer instance. It reuses the outer instance's lookups and registers no contract check. The contract is read from `db`, because the transaction object does not carry it.
29. **SQLite limits, stated in the README.** A SQLite client needs a file path: with `:memory:`, each transaction gets its own empty database. With `transaction: true` on SQLite, a write from another request while a transaction is open blocks the whole process for up to five seconds and then fails with `database is locked`, because Prisma 8's SQLite driver waits synchronously for a locked database. The README recommends leaving `transaction` off on SQLite for an application that serves concurrent requests. The adapter does not queue or serialise calls.

### What the contract must hold

30. **One comparison, used by the contract check and by `auth generate`.** It takes the contract, Better Auth's table description (`getAuthTables(options)`) and the adapter options, and returns a list of problems.
    - A table's physical model name is its `modelName`, followed by `s` when `usePlural` is `true`.
    - Tables with `disableMigrations: true` are left out, as Better Auth's own check and generators do.
    - The `session` table is left out when `secondaryStorage` is set and `session.storeSessionInDatabase` is not, as Better Auth's factory does for schema generation.
    - Tables that share a physical model name are merged into one expected model.
    - Models are found exactly as calls find them (decisions 13 and 14), with the same `namespace` option. Models in namespaces the lookup does not reach are ignored.
31. **Problems reported.**

    | Problem | When |
    | --- | --- |
    | Missing model | no contract model matches |
    | Model in several namespaces | decision 14's error case; the problem carries that error's text |
    | Missing field | the model exists and has no field with the Better Auth field name, or no `id` field |
    | Wrong type | the field exists and decision 32 rejects its type |
    | Id has no default | Better Auth will not send an id (`advanced.database.generateId` is `"serial"` or `false`) and the id column has neither a database default nor an `onCreate` generator |
    | Optional field not nullable | a Better Auth field with `required: false` and no `defaultValue` exists and is not nullable. Better Auth writes `null` to such a field (an admin unban clears `banReason`, `updateUser` passes `image: null`), so a database default or an `onCreate` generator does not satisfy it. The message asks for the field's type with `?` |
    | Required field Better Auth never writes | the model has a field that is not `id` and not in Better Auth's description, that is not nullable, with neither a database default nor an `onCreate` generator |

    - A database default is a `default` on the storage column. An `onCreate` generator is an entry in `execution.mutations.defaults` for that table and column with an `onCreate` part.
    - A `generateId` function is treated as always sending an id. The README says a function that returns `false` needs an id column with a default.
    - The comparison does not look at uniqueness, indexes, foreign keys, relations or the primary key. Better Auth's own check has the same limits, and Better Auth generates unique ids.
32. **Type check by known codecs.** The adapter holds this table from codec id to kind. Nothing published tells a codec's JavaScript type at run time.

    | Kind | Codec ids |
    | --- | --- |
    | `string` | `pg/text@1`, `sql/varchar@1`, `sql/char@1`, `sqlite/text@1` |
    | `enum` | `pg/enum@1` |
    | `uuid` | `pg/uuid@1` |
    | `date` | `pg/timestamptz-date@1`, `pg/timestamp-date@1`, `sqlite/datetime@1` |
    | `number` | `pg/int2@1`, `pg/int4@1`, `pg/int8number@1`, `pg/float4@1`, `pg/float8@1`, `sqlite/integer@1`, `sqlite/real@1` |
    | `boolean` | `pg/bool@1`, `sqlite/boolean@1` |
    | `other` | every other codec id that `docs/reference/scalar-types.md` lists for Postgres and SQLite |

    The implementer copies the `other` ids from that page, and confirms each id above against it; an id above that the page does not list under that JavaScript type is a stop-and-report.

    | Better Auth field | Accepted kinds |
    | --- | --- |
    | `string`, a list of allowed strings | `string` or `enum` |
    | `number`, with or without `bigint: true` | `number` |
    | `boolean` | `boolean` |
    | `date` | `date` |
    | `json`, `string[]`, `number[]` | `string` |
    | `id`, and a field that references an `id` | when `generateId` is `"serial"`: `number` only. When it is `"uuid"`: `string` or `uuid`. Otherwise: `string` |

    - A field whose codec id is in the table and whose kind is not accepted is a wrong type.
    - A field whose codec id is not in the table passes. Reason: a wrong report would block a working application on every request.
    - A field the contract declares as a list (`many`), or whose type is not a scalar (a value object or a union), is a wrong type for every Better Auth type.
33. **Dates are JavaScript `Date` values.** A bare `DateTime` reads as a `Date` on both databases. So does `DateTime(storage: timestamp)`, which is what a Postgres column created by Prisma 7 infers to and what the Prisma 7 schema reader produces. A field declared to read as Temporal or as a string is a wrong type. The README says auth date columns must have a precision of three digits or fewer, because Better Auth's fallback (decision 20) compares dates it has read.
34. **JSON and list fields are stored as text in this version.** Better Auth serialises them itself when the adapter says it has no native support. This is the same on both databases and keeps equality filters working. A contract that declares such a field as `Json` or as a list is a wrong type. The README gives upgraders the SQL to convert a Postgres `jsonb` or array column to text.

### Contract check

35. **The check is the comparison, run once per adapter instance on first use, with its result kept.**
36. **On problems it rejects with the error of decision 40.** With none it resolves.
37. **It is registered with Better Auth's own schema check mechanism**, `registerSchemaCheck` from `@better-auth/core/db/internal`, on the object the factory returns, inside the function `prismaAdapter` returns. Better Auth then awaits it at the start of each request, each server-side API call and each outermost transaction, and runs it for `auth check`.
    - The module is imported as a namespace (`import * as`), and the check is registered only when `registerSchemaCheck` is a function. Otherwise the adapter runs without a check. Reason: Better Auth labels the entrypoint internal, and a named import of a removed name would stop the whole adapter from loading.
    - `runtimeEnabled` is `options.advanced?.database?.validateSchema !== false`, read by the adapter itself.
    - The check function sets no `source`. After its first run it returns `undefined` when there were no problems, and a rejected promise with the same error on every call when there were.
    - The adapter does not use `createSchemaCheck` or `SchemaMismatchError`; neither can carry the adapter's message.
    - The README says `@better-auth/core` must be the copy `better-auth` itself uses, because Better Auth keeps registered checks in module state.

### `auth generate`

38. **The adapter implements `createSchema`.** Better Auth's CLI calls it for `auth generate`, ahead of its built-in generators. The comparison runs on the `tables` it is given, with the omissions of decision 30.
39. **It writes no file.** With no problems it returns `{ code: "", path: file ?? "prisma/contract.prisma" }`, and the CLI prints "Your schema is already up to date." and exits 0. With problems it throws the error of decision 40; the CLI prints the message alone and exits 1. Because the command edits nothing, no failure can leave a project half-changed. The commands read the contract through the application's client, so they report against the last `prisma contract emit`; the README says so.
40. **The error.** One function builds it for the check and for `createSchema`: `Object.assign(new BetterAuthError(message), { code: "SCHEMA_MISMATCH" })`. The `code` makes `auth check` print the message and exit 1, and makes `auth generate` print the message alone even when the CLI runs its own copy of `@better-auth/core`.
41. **The message.** Sections appear only when they have entries, in this order.

    ```text
    Your Prisma contract is missing models or fields that Better Auth needs.

    Add to your contract:

    <PSL of decision 42>

    Change in your contract:

      <Model>.<field>: must be `<PSL type>` (found <what the contract has>)
      <Model>.id: must be `<id line of decision 42>`
      <Model>.<field>: must be `<PSL type>?`, because Better Auth writes null to it
      <text of a several-namespaces problem>

    Fields Better Auth does not write:

      <Model>.<field>: make it optional or give it a default

    Notes:

      <Model>.<field>: Better Auth asks for onDelete <action>, which needs <an optional field | a default>; NoAction is printed instead

    Then run `prisma contract emit` and update your database.
    ```

    - When the first section has no entries, the first line reads "Your Prisma contract does not match what Better Auth needs."
    - `<what the contract has>` is the codec id, followed by ` list` for a list field; for a non-scalar field it is `a value object` or `a union`.
    - When an id has both no default and a wrong type, only the id line is printed.
    - "Notes" alone is not a problem: the check passes and `createSchema` returns empty `code` when only notes would be printed.
42. **PSL the adapter prints.**

    - One block per model, in Better Auth's table order. A missing model is printed whole. An existing model's block holds only its missing fields and any back-relation fields added for missing models.
    - With the `namespace` option set, missing models are printed inside `namespace <name> { ... }`. Without it they are printed bare, which puts them in `public` on Postgres. A model type in a relation or back-relation field is written `<namespace>.<Model>` when that model is in a different namespace from the model holding the field, and bare otherwise.
    - Model name: for a missing model, the physical model name with its first letter upper-cased, and the block ends with `@@map("<physical model name>")`. For an existing model, the contract's model name.
    - Field name: Better Auth's database field name (`fieldName`, or the key when unset). No `@map`.
    - Types: `string` and lists of allowed strings are `String`; `number` is `Int`; `number` with `bigint: true` is `BigInt(as: number)`; `boolean` is `Boolean`; `date` is `DateTime`; `json`, `string[]` and `number[]` are `String`. A field with `required: false` gets `?`. The README says that `Int` holds whole numbers up to about two billion, so a number field that holds fractions or larger values (for example an interval in milliseconds) should be declared `Float` or `BigInt(as: number)` by hand; both are accepted by decision 32.
    - Id line: `id String @id`. With `generateId: "serial"`: `id Int @id @default(autoincrement())`, and fields that reference an id are `Int`. With `generateId: false`: `id String @id @onCreate(uuid())`.
    - With `generateId: "uuid"`, a field that references a contract model whose `id` is a `Uuid` is printed `Uuid`, because PostgreSQL refuses a `text` foreign key to a `uuid` key. The other id types the comparison accepts (`varchar`, `char`, and the integer and float types) take a `String` or `Int` foreign key.
    - `unique: true` gives `@unique`. `index: true` on a field that is not unique gives `@@index([field])`. Table-level indexes give `@@index([...])` or `@@unique([...])` without names, each field printed as its database field name.
    - No `@default` and no `@onUpdate` on other fields: Better Auth supplies default and on-update values itself.
    - Relation field. A field with `references` gives, directly after it, `<name> <Model> @relation(fields: [<fk>], references: [<field>], onDelete: <Action>)`, with `?` on the type when the foreign key is optional. `<Model>` is the referenced model's name as printed or as found in the contract. `<field>` is the referenced field's database field name.
    - `<Action>` comes from Better Auth's `onDelete`, `cascade` when unset: `Cascade`, `NoAction`, `Restrict`, `SetNull`, `SetDefault`. Two cases Prisma 8 refuses print `NoAction` and add a note (decision 41): `set null` on a required foreign key, and `set default`.
    - Relation field name: the foreign key's name without a trailing `Id` (`userId` gives `user`). When that is empty, equals the foreign key's name, or is taken, the name is the foreign key's name followed by `Relation`. When that is taken too, `_` is appended until the name is free.
    - Back-relation field. The referenced model gets, after its last scalar field, `<name> <ReferencingModel>[]`, or `<name> <ReferencingModel>?` when the foreign key is unique. Its name is the referencing model's name with the first letter lower-cased, plus `s` for the list form. When that name is taken, or the referencing model has more than one foreign key to the referenced model, the name is followed by `By` and the foreign key's name with its first letter upper-cased, and both sides carry the relation name `"<ReferencingModel>_<fk>"` as the first argument of `@relation`. When that name is taken too, `_` is appended until it is free.
    - "Taken" means a name among the model's Better Auth fields, the keys of its contract `fields` and `relations` when the model exists, and every relation and back-relation name already assigned to it in this message. Names are assigned in Better Auth's table order, then field order.
    - A foreign key may reference a model that is not one of Better Auth's tables but is in the contract; the relation then uses that contract model's name and the back-relation is added to it.
    - Identical `@@index` lines are printed once.
    - Relation and back-relation fields are printed only for a model reported as missing. The comparison never reports a relation as missing on a model that exists.
    - Fields are aligned in columns; blocks are separated by a blank line.
43. **A contract written in TypeScript gets the same message.** The adapter does not know how the contract was authored. The README says to add the equivalent models and fields by hand.

## Non-goals

- **`auth generate` editing the contract file.** That needs a published way to read and write PSL, which is being decided separately. Until then the command prints what to add.
- **MySQL and MariaDB.** Refused (decision 9). Supporting them needs filters that are right there, and proof.
- **MongoDB.** It has a separate ORM client. Better Auth's own MongoDB adapter covers those users.
- **Native JSON and list columns.**
- **Hand-written atomic `consumeOne` and `incrementOne`.** They wait for the ORM client to gain a delete-and-return and an expression update.
- **Sorting on `Boolean` fields.** Prisma 8's boolean type has no ordering.
- **Serialising SQLite transactions inside the adapter.** The wait belongs to the SQLite driver.
- **`auth migrate`.** Better Auth's CLI refuses it for any adapter but its own Kysely one. Users migrate with Prisma.
- **Where the package lives after it leaves this repository**, and offering the code to Better Auth's repository.
- **Changes to the framework, the SQL family, the targets or the ORM client.** The project adds a package, an example and tests, and touches repository tooling.

## Place in the larger world

- **Better Auth's maintainers** have said on better-auth/better-auth#9636 that Prisma 8 support is planned for their 1.8. No such code is in their repository yet. They are told about this package when its pull request is open; that message is the operator's to send.
- **A community adapter** (`better-auth-prisma-orm`) exists for Postgres. It was read for this design. It deletes at most one row in `delete`, has no schema generation or contract check, and does not run Better Auth's test suite.
- **Publishing needs one manual step before the pull request merges.** The release workflow publishes every non-private package on each push to `main`, authenticates per package through npm trusted publishing, and fails as a whole when one package fails. npm configures a trusted publisher on a package that already exists. So before the pull request merges, someone with rights on the `@prisma` npm scope creates `@prisma/orm-better-auth` and configures the trusted publisher for this repository's publish workflow. The pull request stays a draft until the operator confirms that is done.
- **Better Auth 1.8.** The peer range excludes it. When it is released, the conformance suites are run against it and the range is widened.
- **vitest.** The workspace pins a vitest 5 release candidate, which `@better-auth/test-utils` does not list as a supported peer. The suites run on it. The mismatch ends when the workspace moves to vitest 5.0.0.
- **Two limits of Prisma 8 found by this work** are recorded as tickets, outside this project: the SQLite driver blocks the process while it waits for a locked database, and a `Boolean` field cannot be ordered on.

## Cross-cutting requirements

- **Public entrypoints only**, enforced as decision 2 says.
- **No change under `packages/1-framework`, `packages/2-*`, `packages/3-*`.**
- **Better Auth's published conformance suites pass unmodified, with no test disabled**, on Postgres and SQLite: `normalTestSuite`, `transactionsTestSuite`, `authFlowTestSuite`, `numberIdTestSuite`, `joinsTestSuite`, `uuidTestSuite`, `caseInsensitiveTestSuite` from `@better-auth/test-utils/adapter`, with the adapter's `transaction` option `true`.
- **The PSL the adapter prints is the PSL the tests migrate with.** The conformance harness builds each test database from the comparison's output against an empty contract, so every option combination the suites use proves the printed PSL emits and applies.
- **Errors a user can cause carry a message that names the fix.**

## Contract impact

None. No contract entity, kind, field or hash changes. The adapter reads contracts.

## Adapter and target impact

None. No target, adapter or driver package changes.

## Failure states of `auth generate`

The adapter's `createSchema` writes nothing and changes nothing, on success or failure. Better Auth's CLI writes a file only when `createSchema` returns non-empty `code`, which this adapter never does.

## ADR

The project's durable decision is that a library outside Prisma is integrated through published entrypoints alone, with its models in the application's contract and not in an extension-owned contract space. An ADR recording this is written at close-out.

## How it is tested

- **Conformance harness**, in the package's tests, run by `pnpm test:packages`. Better Auth's suites change the auth configuration about 140 times per run and expect the database to follow. For each change the harness renders PSL for the configuration (the comparison against an empty contract), emits a contract in memory with the control client, applies it to a fresh database with `dbInit`, and opens a new runtime client that the next adapter instance uses.
  - SQLite uses a new file each time.
  - Postgres uses one `@prisma/dev` server per test file, which allows one connection at a time. Between migrations the harness closes the runtime client, drops every schema except `pg_*`, `information_schema` and `_prisma_dev*`, and recreates `public`.
  - One migration runs before `testAdapter` is called, because `testAdapter` asks for the adapter first.
  - `afterAll` waits at most `timeouts.devServerClose` (ten seconds before the multiplier) for the `@prisma/dev` server to close and then returns; closing took over two minutes in the prototype. The implementer proves that the test file's process still exits promptly after `afterAll` returns; if it does not, they stop and report.
  - PSL files and SQLite files go in one directory under the operating system's temporary directory, removed in `afterAll`. No test writes inside the repository.
- **The adapter's own tests**, on both databases unless a row names one:

  | Decision | Test |
  | --- | --- |
  | 2 | the package's manifest and files name no `@repo/*` package but the two allowed |
  | 9 | a contract with target `mysql` or `mongo` is refused; an object with no `contract` is refused |
  | 14 | the `namespace` option finds a model in a second Postgres schema; the same name in two schemas without the option raises the error; exact name wins over the upper-cased name |
  | 15, 16 | the missing-model error; a model name that is not an identifier |
  | 18 | `delete` removes every matching row; `updateMany` setting equal values returns the matched count; a read without `select` does not return a column the application added |
  | 19 | sorting by a boolean, `lt` on a boolean and `eq` on a Postgres `Json` field each raise the adapter's error |
  | 20 | through Better Auth's fallback: a verification row with dates is consumed once by four concurrent `consumeOne` calls; rate limiting's `bigint` field increments; a guarded update that sets a date to `null` |
  | 21, 22 | case-sensitive `contains`, `starts_with`, `ends_with` do not match another case on SQLite; values holding `%`, `_` and `!` match literally; the empty pattern; a value longer than the field; a `NULL` field; an AND-only, an OR-only and a mixed `where` |
  | 23 | insensitive pattern operators with a value no row contains return no rows from rows holding upper-case letters; insensitive `eq` of a stored `École` and `ΟΔΟΣ` matches that row; insensitive `ne` and `not_in` |
  | 26 | with `joins` on and a contract with no relations, the joined rows are returned |
  | 28 | a failing transaction rolls back with `transaction: true`; with the default, `transaction(cb)` runs `cb` without one |
  | 30 | `usePlural`; a `disableMigrations` table is ignored; the session table is ignored under `secondaryStorage`; the `namespace` option |
  | 31 | each problem kind, including a required field with a database default, with an `onCreate` generator and with an `onUpdate`-only generator |
  | 32 | one case per row of the accepted-kinds table, plus `Uuid`, `Decimal`, an enum, a list field, a value object, `DateTime(storage: timestamp)`, `DateTime(as: temporal)` and `BigInt` |
  | 37 | the check rejects on the first API call of a real `betterAuth()` instance and is skipped with `validateSchema: false` |
  | 38–41 | `createSchema` in both outcomes; the error carries `code`; each message section |
  | 42 | printed PSL emits and applies for: the default configuration; every first-party plugin schema at once (organization with teams, two-factor, username, admin, anonymous, phone number, siwe, jwt, device authorization, last login method, api-key, passkey, sso, oauth-provider, scim); a table with two foreign keys to one model; a self-reference; a foreign key named `user`; serial ids; `generateId: false`, where the comparison over the emitted contract then reports no problem; renamed models and fields; `usePlural`; the `namespace` option; existing auth models in a Postgres schema other than `public` with no `namespace` option, where the printed model references `<namespace>.<Model>`; missing fields and a back-relation added to an existing model |

  PSL tests emit and apply what was printed; a text snapshot alone is not enough.
- **Which Better Auth versions the tests run at.** The packaging test installs `better-auth`, `auth` and `@better-auth/core` at the floor of the peer range (1.7.6) and runs the sign-up flow, `auth generate` and `auth check` there. The conformance suites and every other test of the package run at the version the package's `devDependencies` pin (1.7.27).
- **A packaging test** in `test/integration/test/packaging/`, modelled on the extension tarball test: it packs the adapter and a database package, installs them in a scratch project with Better Auth from the registry at the floor of the peer range, asserts the installed `better-auth`, `auth` and `@better-auth/core` versions, runs the sign-up flow, runs `auth generate` and `auth check`, asserts one copy of `@prisma/orm-family-sql`, and asserts that a skewed version fails to install under strict peers. Packaging tests run in the merge queue, not on pull requests, so the implementer also runs this one file locally before the pull request opens.
- **An example application**, `examples/better-auth/`: a Next.js application (App Router) on Postgres that a user can copy. It has a contract with the auth models, a committed emitted contract with an `emit` script, `betterAuth()` with email and password, Better Auth's route handler at `app/api/auth/[...all]/route.ts`, a sign-up page, a sign-in page, and a home page that shows the signed-in user and a sign-out button. It carries no test machinery of its own. It has one smoke test, in the style of `examples/react-router-demo`: start a development database, create the tables, start the application, then sign up, sign in, read the session and sign out over HTTP through the route handler, and check the home page shows the user. CI typechecks and builds it. The pull request adds a no-op application declaration under `upgrade-instructions/pending/`, because it adds an example and changes no existing application.
- **A command-line check inside the packaging test.** The packaging test's scratch project already holds the packed adapter, the packed SQLite database package and Better Auth from the registry, installed outside the workspace, so it is where another library's program can run against the adapter as a user has it. The test adds Better Auth's `auth` program from the registry, writes an auth configuration with the two-factor plugin and a client over a contract that lacks its model and fields, and runs the real `auth generate` and `auth check`: it checks the message of decision 41, exit code 1 and an unchanged contract file. It then adds the printed models and fields, emits again through the control client, which produces the same contract JSON as `prisma contract emit`, and checks both commands exit 0 with "Your schema is already up to date." and `Schema check passed against adapter "prisma-8".`. Packaging tests run in the merge queue, not on pull requests, so the implementer also runs this one file locally.

## Evidence the design rests on

A throwaway prototype of the adapter's calls, joins, transactions and a PSL renderer passed all 468 tests of the seven suites on SQLite and on Postgres with no test disabled. It differed from this spec in the pattern operators (it kept `LIKE` with an extra check), relation names, adapter id and namespace handling, and it had no `createSchema` or contract check. The filters, atomic fallbacks and PSL constructs of this spec were then run on both databases by a reviewer's scripts; the cases they proved are the tests above.

## Transitional-shape constraints

None. The project is one pull request, because its first merge publishes the package.

## Project definition of done

- [ ] The seven conformance suites pass on Postgres and SQLite in CI with no test disabled.
- [ ] Every test in "How it is tested" exists and passes in CI.
- [ ] The example's smoke test passes in CI, and the example typechecks and builds there.
- [ ] The `auth generate` and `auth check` check in the packaging test passes in the merge queue: the message of decision 41 and exit 1 for the incomplete contract, "Your schema is already up to date." and exit 0 for the complete one.
- [ ] `pnpm lint:consumer-internal-imports`, `pnpm lint:deps`, `pnpm lint:manifests`, `pnpm lint:docs`, `pnpm lint:publishability`, `pnpm check:upgrade-coverage` and `pnpm fixtures:check` pass with the package and example present.
- [ ] The diff against `main` has no file under `packages/1-framework`, `packages/2-*` or `packages/3-*`.
- [ ] The package README covers installation at the same version as the database package, setup on Postgres and SQLite, the `auth generate` flow, the options, and every limit this spec assigns to the README.
- [ ] The npm package name exists with a trusted publisher configured, confirmed by the operator, before the pull request leaves draft.
- [ ] The ADR is in `docs/architecture docs/adrs/`.

## Open questions

None.

## References

- better-auth/better-auth#9636, "Support Prisma ORM 8".
- Better Auth's adapter guide (`docs/content/docs/guides/create-a-db-adapter.mdx` in their repository) and adapter factory (`packages/core/src/db/adapter/`).
- [Project intent](../../docs/design/00-purpose/project-intent.md) and [vision](../../docs/design/00-purpose/vision.md): features that can be built outside the core are built outside it, through the same public interface.
- The contract spaces decision record: an extension-owned contract space is fixed and cannot take the columns Better Auth's plugins add to `user`, which is why the auth models live in the application's contract.
- The public npm packages decision record: published packages live under `packages/9-public/` in the `@prisma` scope, and packages that build on the platform hold it as an exact peer.
- [Scalar types reference](../../docs/reference/scalar-types.md), the source of the codec table.
- The two spec reviews in [reviews/](reviews/).
