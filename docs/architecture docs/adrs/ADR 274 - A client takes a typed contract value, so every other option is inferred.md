# ADR 274 — A client takes a typed contract value, so every other option is inferred

**Status:** Accepted
**Date:** 2026-10-16
**Domain:** Adapters / Targets, Runtime
**Builds on:** [ADR 159 — Definition-only contracts and type-only codec-operation maps](ADR%20159%20-%20Definition-only%20contracts%20and%20type-only%20codec-operation%20maps.md), [ADR 263 — A serverless Postgres connection has the same query interface as a postgres client](ADR%20263%20-%20A%20serverless%20Postgres%20connection%20has%20the%20same%20query%20interface%20as%20a%20postgres%20client.md), [ADR 265 — A collection keeps its class through the chain](ADR%20265%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md)

---

## At a glance

An application adds its own query methods to a model by subclassing `Collection` (ADR 265):

```ts
// src/collections.ts
import { Collection } from '@prisma/orm-postgres/orm-client';
import type { Contract } from './prisma/contract.d';

export class PostCollection extends Collection<Contract, 'Post'> {
  published() {
    return this.where({ published: true });
  }
}
```

It creates its client from a typed contract value and its classes:

```ts
// src/prisma/db.ts
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import { PostCollection } from '../collections';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const db = postgres({
  contract,
  url: process.env['DATABASE_URL']!,
  collections: { Post: PostCollection },
});
```

Its methods are then available, with their types, on the client's ORM and inside every transaction:

```ts
await db.orm.public.Post.published().all();

await db.transaction(async (tx) => {
  const posts = await tx.orm.public.Post.published().forUpdate().all();
});
```

The `postgres(...)` call names no type. TypeScript infers the contract's type from `contract` and the classes' types from `collections`.

## Decision

1. **A client receives its contract as a typed value, `{ contract }`.** For an emitted contract, the application makes that value with `contractFromJson<Contract>(json)`, which validates the JSON and returns it typed as the `Contract` the application names. A contract written in TypeScript with `defineContract` is already such a value. Every client takes the contract this way: `postgres()`, `postgresServerless()`, `sqlite()`, `supabase()` and `mongo()`, as do the static entries `postgresStatic()`, `sqliteStatic()` and `mongoStatic()`, which build queries without loading the database driver.
2. **No client call names a type, so every option is typed from its value.** The first such option is `collections`, the application's custom collection classes. Every SQL client takes it, and the classes are used everywhere that client offers an ORM: on `db.orm`, on the ORM a transaction receives (`tx.orm`), on every connection a serverless client opens, and on every client that Supabase binds to a database role.
3. **A contract value is validated once,** however many clients and static entries are built from it.
4. **Creating a client has no side effects.** It does not connect, open a pool or require a URL. The contract, the query builders and plans built from them all work without a database.

## Why

### An emitted contract needs its type named somewhere

The emitter writes a contract as `contract.json`, the data, and `contract.d.ts`, its type. When TypeScript imports the JSON, it keeps the shape but widens every literal type, so the precise types the query builders depend on are lost. The application restores them by naming `Contract`. [ADR 277](ADR%20277%20-%20An%20emitted%20contract%20gets%20its%20type%20from%20contractFromJson%2C%20not%20from%20a%20declaration%20file%20next%20to%20the%20JSON.md) explains why it does so in its own code rather than through a generated declaration file.

### Naming it on the client call would stop inference

The obvious place to name the type is the client call itself:

```ts
const db = postgres<Contract>({ contract: contractJson, collections: { Post: PostCollection } });
```

TypeScript has a rule for calls: once one type argument is written explicitly, it infers none of the others, which take their defaults instead. Here the classes' type would fall back to "no classes", and `db.orm.public.Post.published()` would not compile even though the class is there at run time. Every option whose type should come from its value would have the same problem.

### So the type gets a call of its own

`contractFromJson<Contract>(json)` takes one argument and returns one value, so naming the type there costs nothing. The client call that follows names no type, and TypeScript infers everything from the values passed to it. One rule then covers both kinds of contract: a `defineContract` value and a `contractFromJson` value are passed to a client the same way.

### The classes are a client option, not part of the contract

The contract is the data description the emitter writes, that is hashed, and that migrations compare. Custom collection classes are application code. They are passed beside `extensions` and `middleware`, not inside the contract, so that "contract" keeps one meaning and nothing suggests the classes affect its hash.

## How the rules are kept

### Validated once

A client built from a contract value checks a record of contracts that have already been validated, and skips validation if the value is there. The record must be shared by every bundle of a facade (`/static`, `/runtime` and `/serverless` are built separately) and by any second copy of the code in one program, so it lives on `globalThis` under a `Symbol.for` key rather than in a module variable. It is a `WeakMap`, so it keeps no contract alive.

The record is keyed by the validator: the target and the facade's version, which is the version of every Prisma 8 package because they are released together. A second installed version therefore validates the same object again.

The validated value's top level is frozen; its nested objects are not. Neither the JSON passed to `contractFromJson` nor the value it returns may be changed afterwards, because a client built from them later does not validate again.

The record changes no client's behaviour. It only saves a validator from checking an object it has already accepted.

### No side effects on creation

Tools such as linters need to import an application's `db.ts` and read its client without a database. The ORM builds a plan from the contract alone and uses the database only when the query runs, so this works as long as creating the client does nothing else. Creating a client therefore does not touch the database: every client creates its pool or driver on the first query, and each has a test that creates it with no URL and builds a plan. Opening a serverless connection is a separate, deliberate step: `postgresServerless().connect({ url })` connects before it returns (ADR 263), and the serverless client itself creates nothing. Each SQL client's test also renders the plan with `toSql(plan)`, which needs only the adapter and the contract, so it is a static member. `mongo()` has no `toSql`.

ADR 263 lists `orm` among the members that need a database connection. That is about running an ORM query. Building one does not need a connection.

## Consequences

- **An application writes `<Contract>` once,** in `contractFromJson`, and nowhere else.
- **The client types carry the classes,** for example `PostgresClient<Contract, Collections>`. `Collections` defaults to no classes, so `PostgresClient<Contract>` describes a client without them.
- **`orm({ runtime, context, collections })` stays** as the lower-level function the clients are built on. Applications have no reason to call it.

## Alternatives considered

### A chained call: `postgres<Contract>({ ... }).withCollections({ ... })`

A second call has no explicit type argument, so inference works. It was rejected because it works around the explicit type argument instead of removing it. Every later option typed from its value would need another chained call, and a client would have two ways to receive options.

### Register the classes on the static entry and build the client from it

```ts
const app = postgresStatic<Contract>({ contractJson }).withCollections({ Post: PostCollection });
const db = postgres(app, { url });
```

This gives the static entry and the client one source of truth. It was rejected because the static entry exists for code that must not load the database driver, such as browser code reading enums, and almost no application uses it. Every application would have to write two definitions to get its classes.

### Put the classes inside the contract value

`contractFromJson<Contract>({ json, collections })` still names a type explicitly, so the classes would lose their types there too, and the contract would hold application code.

### Infer the contract from the classes

`postgres({ contractJson, collections: { Post: PostCollection } })` could infer the contract's type from `PostCollection`, which carries it. It was rejected because an application without classes would still have to name the type, and one that kept naming it by habit would silently lose the classes' types.

### Type the JSON import itself

A declaration file next to `contract.json` could give the import its type, so the application would need no call. ADR 277 records why this was rejected: every application would need the `allowArbitraryExtensions` compiler setting.

### A program-wide registry filled by declaration merging

Contributed collection methods (ADR 272) are typed through a registry that packages extend by declaration merging. Doing the same for application classes would apply them to every client in the program, including clients meant to have none and clients of other contracts.
