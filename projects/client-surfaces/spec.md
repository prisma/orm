# Complete client surfaces: typed contracts and custom collections

Linear project: [Complete client surfaces: typed contracts and custom collections](https://linear.app/prisma-company/project/complete-client-surfaces-typed-contracts-and-custom-collections-c04871fd5c48). Decision record: [ADR 274](../../docs/architecture%20docs/adrs/ADR%20274%20-%20A%20client%20takes%20a%20typed%20contract%20value%2C%20so%20every%20other%20option%20is%20inferred.md).

## Terms

- **Client:** the object an application creates to query its database: `postgres()`, `postgresServerless()` and the connections its `connect()` opens, `sqlite()`, `supabase()` and its role-bound clients, and `mongo()`. These names match the types in the code (ADR 263).
- **Static entry:** `postgresStatic()`, `sqliteStatic()` and `mongoStatic()`, from each facade's `/static` entry point. They need no database and do not load the driver.
- **Custom collection class:** an application's subclass of `Collection`, such as `class PostCollection extends Collection<Contract, 'Post'>` (ADR 265).
- **Transaction client:** the `tx` that `db.transaction((tx) => …)` passes to its callback.
- **Plan:** what the query builders produce before anything runs: an abstract syntax tree and its parameters.

## Purpose

An application's client must give it everything Prisma 8 offers, without hand-built workarounds. Today custom collection classes, the main feature of the collection scopes project, work only on a second ORM client that the application builds itself. A transaction offers less than the client outside it. Tools cannot rely on loading an application's client without a database. This project makes the client the one complete object an application needs.

## At a glance

```ts
// src/prisma/db.ts
import { contractFromJson } from '@prisma/orm-postgres/static';
import postgres from '@prisma/orm-postgres/runtime';
import { PostCollection, UserCollection } from '../collections';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const db = postgres({
  contract,
  url: process.env['DATABASE_URL']!,
  collections: { Post: PostCollection, User: UserCollection },
});
```

```ts
await db.orm.public.Post.published().all();

await db.transaction(async (tx) => {
  const posts = await tx.orm.public.Post.published().forUpdate().all();
  const published = await tx.prepare({}, () => tx.orm.public.Post.published().prepared.all());
  await tx.execute(tx.raw.sql`UPDATE post SET pinned = false`.build());
});

const plan = db.orm.public.Post.published().prepared.all().plan;
db.toSql(plan); // { sql: 'SELECT … WHERE "post"."published" = $1', params: [true] }, no database needed
await db.query(plan); // runs it
```

The same holds for the serverless client and its connections, for SQLite, and for Supabase.

## Non-goals

- **MongoDB transactions.** They need session support in the MongoDB runtime first. The existing Linear project "SQLite & MongoDB transactions" owns them (TML-2875).
- **Custom collection classes for MongoDB.** The MongoDB ORM has no custom classes at all. That is a new feature with its own design. MongoDB clients do take `{ contract }` in this project.
- **An ORM on the static entries or on the serverless client.** ADR 263 keeps the serverless client to members that are safe at module scope, and an ORM whose queries fail when run is not safe there. Tools reach the ORM by loading the application's client, which creates nothing until the first query.
- **A linter.** This project makes the client loadable by one. Building it is separate work.
- **Plans for writes.** `create`, `update` and `delete` have no plan form, so a tool can only inspect reads. Giving writes a plan form is separate work.
- **Smaller option gaps:** pool options on the serverless `connect()`, and `cursor` on SQLite and Supabase. They are recorded in [`deferred.md`](deferred.md).

## Place in the larger world

- **Collection scopes** (closed): shipped custom collection classes (ADR 265), query fragments (ADR 259) and contributed methods (ADR 272). This project makes them reachable from the client applications actually create.
- **ADR 263:** defines the client, the serverless client and the connection, and splits their members into static, runtime-bound and lifecycle groups. This project keeps that split. `toSql` is a static member, and `query` and `execute` are runtime-bound members.
- **ADR 159:** contracts written in TypeScript already enter clients as typed values (`postgres({ contract })`). This project makes emitted contracts enter the same way.
- **Public npm surface (ADR 242):** an application depends on one facade package. `contractFromJson` is exported from that package's `/static` entry point.
- **TML-2398** (serverless session helper, in progress elsewhere): it adds a helper that returns `{ orm, sql }`. That helper must pass `collections` on. The two projects coordinate when either lands.

## Cross-cutting requirements

1. **One way to give a client its contract.** Every client and static entry takes `{ contract }`. No client takes `contractJson`. An application writes the `Contract` type argument only at `contractFromJson`.
2. **Every option is inferred.** No client call needs an explicit type argument. A type test proves that `collections` keeps its class types through `postgres()`, `postgresServerless().connect()`, `sqlite()` and `supabase()`.
3. **A transaction offers what the client offers.** A transaction client has the client's query members, `orm` (with the custom classes), `sql`, `raw`, `prepare`, `query` and `execute`, on every SQL client, Supabase included. It does not have the lifecycle members or `transaction`.
4. **The custom classes are everywhere the ORM is.** `db.orm`, `tx.orm`, every serverless connection's `orm`, and every Supabase role-bound client's `orm` use the classes. A test through each published client, not through a hand-built `orm()`, calls a custom class method outside and inside a transaction.
5. **Creating a client has no side effects.** Creating any client does not connect, open a pool, or require a URL. Its static members, `toSql`, and plans from `orm`, `sql` and `raw` work with no database. A test for each client creates it with no URL and builds and renders a plan, including one from a custom class method.
6. **The contract is validated once.** A value from `contractFromJson` or `defineContract` is not validated again by each client built from it. The serverless client and its connections, and the two clients in the Cloudflare Worker example, validate once in total.
7. **`contractFromJson` loads without the driver.** Importing the `/static` entry point does not load `pg`, `node:sqlite` or `mongodb`. A test checks the module graph.
8. **No hand-built ORM clients remain in user-facing code.** No example, README, doc, skill or template calls `orm({ runtime, context, ... })` to reach custom classes, or calls `db.runtime().query(plan)` where `db.query(plan)` would do.

## Contract impact

No change to the contract IR, the emitted `contract.json`, `contract.d.ts`, or the contract hash. `contractFromJson` uses each target's existing contract serializer.

## Adapter impact

No change to adapters or drivers. `toSql` uses the existing adapter `lower` method. The facades in `packages/3-extensions/{postgres,sqlite,supabase,mongo}` change.

## Transitional-shape constraints

- **The `contractJson` option is removed in one slice,** together with every call site, the `orm init` templates, the docs and skills, and upgrade instructions. No release ships with both options.
- **The `AGENTS.md` rule "name the `contract.d.ts` type where the JSON enters"** changes in the same slice to name `contractFromJson`. The test rules (`.agents/rules/typed-contract-in-tests.mdc`) keep `validateSqlContractFully<Contract>(json)` for tests that need a contract without a client.

## Project definition of done

- An application created with `prisma-next orm init` gets a `db.ts` that uses `contractFromJson` and passes `{ contract }`, and type-checks with no explicit type argument on the client.
- `examples/prisma-8-demo`, `examples/prisma-8-demo-sqlite`, `examples/paradedb-demo`, `examples/prisma-8-cloudflare-worker` and `examples/supabase` use custom classes through `db.orm` and inside a transaction, with no `createOrmClient` and no hand-built `orm()`.
- A script that imports the demo's `db.ts` with no `DATABASE_URL` and no database prints the SQL text of a custom class method's query.
- Upgrade instructions for applications move a `db.ts` from `postgres<Contract>({ contractJson })` to the new form, and a consumer's agent can apply them.
- ADR 274 is Accepted and matches the shipped code.
- TML-3546 is closed.

## Open questions

None. The design was settled with Will on 2026-10-16. Details that belong to one slice are settled in that slice's spec.

## References

- ADR 159, ADR 242, ADR 259, ADR 263, ADR 265, ADR 272, ADR 274.
- [Design notes](design-notes.md): the reasoning, the usage survey, and the alternatives.
- TML-3546: inside a transaction, the client has no custom collection classes.
