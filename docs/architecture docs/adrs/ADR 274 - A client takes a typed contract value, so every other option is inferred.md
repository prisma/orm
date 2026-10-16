# ADR 274 — A client takes a typed contract value, so every other option is inferred

**Status:** Proposed
**Date:** 2026-10-16
**Domain:** Adapters / Targets, Runtime
**Implementation:** Decisions 1, 2 and 4 are implemented. Decisions 3 and 5 are not implemented yet.
**Builds on:** [ADR 159 — Definition-only contracts and type-only codec-operation maps](ADR%20159%20-%20Definition-only%20contracts%20and%20type-only%20codec-operation%20maps.md), [ADR 263 — A serverless Postgres connection has the same query interface as a postgres client](ADR%20263%20-%20A%20serverless%20Postgres%20connection%20has%20the%20same%20query%20interface%20as%20a%20postgres%20client.md), [ADR 265 — A collection keeps its class through the chain](ADR%20265%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md)

---

## At a glance

An application has custom collection classes (ADR 265):

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

It turns its emitted contract into a typed value once, and passes that value and its classes to the client:

```ts
// src/prisma/db.ts
import { contractFromJson } from '@prisma/orm-postgres/static';
import postgres from '@prisma/orm-postgres/runtime';
import { PostCollection } from '../collections';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const db = postgres({
  contract,
  url: process.env['DATABASE_URL']!,
  collections: { Post: PostCollection }, // decision 3, not implemented yet
});
```

The classes are on the client's ORM and on every transaction's ORM, with their types:

```ts
await db.orm.public.Post.published().all();

await db.transaction(async (tx) => {
  const posts = await tx.orm.public.Post.published().forUpdate().all();
  // ...
});
```

A contract written in TypeScript with `defineContract` is already a typed value, so it goes straight to the client: `postgres({ contract, collections })`.

## Decision

1. **Each target offers `contractFromJson<Contract>(json)`.** It validates the emitted JSON and returns the contract as a value of the type the application names. It is the only place an application writes the `Contract` type argument. It is exported from the facade's `/static` entry point, which does not load the database driver.
2. **Every client takes the contract only as a value: `{ contract }`.** `postgres()`, `postgresServerless()`, `sqlite()`, `supabase()`, `mongo()` and the static entries infer the contract type from it. The `contractJson` option is removed. Emitted contracts and contracts written in TypeScript take the same path.
3. **Every SQL client takes `collections`.** The classes reach `db.orm` and the ORM of every transaction (`tx.orm`). On the serverless client they reach every connection that `connect()` opens. On Supabase they reach every role-bound client and its transactions. The types of the classes are inferred from the option.
4. **The contract is validated once.** A value from `contractFromJson` or `defineContract` is not validated again by each client built from it.
5. **Creating a client has no side effects.** It does not connect, does not open a pool, and does not need a URL. The client's static members (ADR 263), and plans built with `db.orm`, `db.sql` and `db.raw`, work without a database. A tool such as a linter can import the application's `db.ts` and read them.

## Why

### The explicit type argument blocks every other inferred option

An emitted contract arrives as JSON. Importing JSON loses its exact types, so the application names the type. Until now it named it on the client:

```ts
const db = postgres<Contract>({ contractJson, collections: { Post: PostCollection } });
```

TypeScript has a rule for calls: once one type argument is written explicitly, it infers none of the others. They take their defaults. So `collections` would be typed with its default, "no classes", and `db.orm.public.Post.published()` would not compile, even though the class is there at run time. Any option whose type should come from its value has the same problem.

Moving the type argument to a call of its own removes the problem. `contractFromJson<Contract>(json)` takes one argument and returns one value. The client call then has no explicit type argument, and TypeScript infers the contract type from `contract` and the class types from `collections`.

### It is the path TypeScript-authored contracts already use

`postgres({ contract })` with a `defineContract` value already infers the contract type. The emitted path was the only one that needed `<Contract>` on the client. After this decision there is one way to give a client its contract, whichever way the contract was written.

### A program-wide record of validated contracts

Decision 4 needs a record of which contracts were already validated. The record is a `WeakMap` on `globalThis` under a `Symbol.for` key, so the separate bundles of a facade (`/static`, `/runtime`, `/serverless`) and separate copies of its code in one program share it. A variable local to one module would not be shared across those bundles. The record holds no behaviour. It only remembers that a given validator already validated a given object, and the object stays collectable. It is keyed by the validator's identity: the target id and the version of the facade package, which is the version of every Prisma 8 package because they are all released together. Another version therefore validates the same object again. The validated contract's top level is frozen and its nested objects are not, so neither the JSON passed to `contractFromJson` nor the value it returns may be changed afterwards: a client built from them later does not validate again.

### The classes belong to the client, not to the contract

The contract is the data description that the emitter writes, that is hashed, and that migrations compare. Custom collection classes are application code. Putting them inside the contract value would make "contract" mean two things, and would raise the question of whether the classes affect the hash. They are a client option, beside `extensions` and `middleware`.

### Loading the client must stay free of side effects

Query building needs no database. The ORM builds a plan from the execution context and uses the runtime only when the query runs. A client that connects or validates its URL when created would break this for every tool that imports the application's `db.ts`. Postgres, SQLite and MongoDB clients already create their pool or driver on the first query. This decision makes that a requirement for every client, with a test for each.

## Consequences

- **Every application's `db.ts` changes,** from `postgres<Contract>({ contractJson })` to `contractFromJson<Contract>(contractJson)` plus `postgres({ contract })`. The `orm init` templates, the examples, the docs and the skills change with it, and the release carries upgrade instructions.
- **The rule "name the `contract.d.ts` type where the JSON enters" still holds.** The JSON now enters at `contractFromJson`.
- **The hand-built ORM client goes away.** Applications no longer call `orm({ runtime, context, collections })` to get their classes. `orm()` stays as the function the clients are built on.
- **ADR 263 still holds.** It lists `orm` among the members that need a database connection, because running an ORM query needs one. Building a plan with `orm` does not.
- **The client types gain a type parameter for the classes,** for example `PostgresClient<Contract, Collections>`. It defaults to no classes, so a type written as `PostgresClient<Contract>` still describes a client without classes.

## Alternatives considered

### A chained call: `postgres<Contract>({ ... }).withCollections({ ... })`

A second call has no explicit type argument, so inference works, and existing `db.ts` files keep working. It was rejected because it works around the explicit type argument instead of removing it. Every later option whose type comes from its value would need another chained call, and the client would have two ways to receive options.

### Register the classes on the static entry and build the client from it

```ts
const app = postgresStatic<Contract>({ contractJson }).withCollections({ Post: PostCollection });
const db = postgres(app, { url });
```

This gives the static entry and the client one source of truth. It was rejected because almost no application uses the static entry: it exists so browser code can read enums without loading the driver. Every application would have to write two definitions to get its classes.

### Put the classes inside the contract value

`contractFromJson<Contract>({ json, collections })` still has an explicit type argument, so the classes lose their types there too. It would also make the contract hold application code (see "The classes belong to the client, not to the contract").

### Infer the contract from the classes

`postgres({ contractJson, collections: { Post: PostCollection } })` could infer the contract type from `PostCollection`, which carries it. It was rejected because the application would write `<Contract>` without classes and leave it out with them, and an application that kept `<Contract>` by habit would silently lose the class types.

### Type the JSON import itself

TypeScript can type a JSON import through a `contract.d.json.ts` file, with `allowArbitraryExtensions` set in the application's `tsconfig.json`. Then `postgres({ contractJson, collections })` would infer everything with no function call. It was rejected because it depends on a compiler setting every application would have to turn on, and on every bundler resolving the declaration file the same way.

### A program-wide registry filled by declaration merging

Contributed collection methods (ADR 272) are typed through a registry that packages extend by declaration merging. Doing the same for application classes would apply them to every client in the program, including a client meant to have none, and to clients of other contracts. That objection does not apply to the program-wide record of validated contracts: it changes no client's behaviour, it only saves a validator from checking an object it already accepted.
