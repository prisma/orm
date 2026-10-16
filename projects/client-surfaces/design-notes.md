# Design notes: complete client surfaces

These notes record how the design in [ADR 274](../../docs/architecture%20docs/adrs/ADR%20274%20-%20A%20client%20takes%20a%20typed%20contract%20value%2C%20so%20every%20other%20option%20is%20inferred.md) was reached. Read the ADR first for the decision itself.

## The problem, as found

The collection scopes project shipped custom collection classes (ADR 265): an application subclasses `Collection`, and its methods survive every chained call. During its close-out we found that no client an application creates accepts the classes:

```ts
const db = postgres<Contract>({ contractJson, url });
db.orm.public.Post.published(); // type error, and undefined at run time

await db.transaction(async (tx) => {
  tx.orm.public.Post.published(); // same
});
```

`postgres()` builds its ORM in `packages/3-extensions/postgres/src/runtime/postgres-members.ts` with `orm({ runtime, context })` and no `collections`. `tx.orm` is built the same way. SQLite and Supabase do the same. The examples get their classes by building a second ORM client by hand:

```ts
export function createOrmClient(runtime: Runtime) {
  return orm({ runtime, context: db.context, collections: { Post: PostCollection } }).public;
}
```

Every query function in the demo calls `createOrmClient(runtime)`. Inside a transaction no documented way exists. On Supabase none is possible, because its role-bound runtime is private. Every test of the classes went through the hand-built client, so the gap stayed hidden.

An audit of all the clients found more of the same kind:

| Gap | Where |
| --- | --- |
| No client passes `collections` to its ORM | Postgres, serverless, SQLite, Supabase |
| A transaction has no `raw` and no `prepare` | Postgres, serverless, SQLite |
| A Supabase transaction has no `sql` and no `orm` | Supabase |
| `db.orm` has no `fragment` | SQLite, which exposes only one namespace of the ORM client |
| No `query(plan)` or `execute(plan)` on the client, so about 60 places in the examples write `db.runtime().query(plan)` | every SQL client |
| The runtime `mode` option cannot be set, so `budgets` cannot be told to warn instead of block | every SQL client; MongoDB has it |

## Why a `collections` option did not just work

An emitted contract arrives as JSON, and importing JSON loses its exact types, so the application writes the type: `postgres<Contract>({ contractJson })`. TypeScript infers no type argument once any is written explicitly. A `collections` option on the same call takes its default type, "no classes".

A spike on the collection scopes project hit the same rule when it tried to pass contributed methods through the client call. That is why contributed methods (ADR 272) are typed through a registry filled by declaration merging instead.

## How applications use the client

We surveyed every example, README, skill, doc and the `orm init` template:

- **One `db.ts`, one call.** Every application creates its client in one place, `postgres<Contract>({ contractJson, url, extensions, middleware })`, exports `db`, and uses `db.orm`, `db.sql` and `db.transaction` everywhere.
- **The serverless client** is created at module scope with no connection. Each request opens a connection with `connect({ url })`.
- **The static entry is almost unused.** `examples/retail-store/src/enums.ts` reads enums with `mongoStatic`. No example uses `postgresStatic` or `sqliteStatic`. The static entry was built so browser code can read enums without loading the driver.
- **No linter exists.** The ESLint plugin was removed long ago. The language server does not load a client.

So a design that makes every application split its client into a static definition and a runtime client would charge everyone for a split almost nobody uses.

## Loading a client without a database

The requirement from the design discussion: a tool such as a linter must be able to load the application's client and read its static parts.

We checked this by importing the demo's real `src/prisma/db.ts` with `DATABASE_URL` unset and no database running:

- The client loaded. `postgres()` creates its pool on the first query, not when it is created.
- `db.contract`, `db.enums`, `db.context` and `db.sql` were available.
- `db.orm.public.Post.where(...).select(...).limit(5).prepared.all()` returned a plan.
- A custom class method built a plan, using an ORM built over `db.context`.
- The plan became SQL text through the adapter: `SELECT "post"."id" AS "id", "post"."title" AS "title" FROM "public"."post" WHERE "post"."title" = $1 LIMIT 5`.

Two parts of that are not supported surfaces today. Nothing tests that creating a client stays free of side effects, and turning a plan into SQL text means reaching into `db.stack`. The project makes both supported: a test per client, and a `toSql(plan)` static member.

Loading `/runtime` still loads the driver (`pg`, `node:sqlite`, `mongodb`). That is fine for a tool that runs in Node. Browser code keeps using `/static`.

## How the design was reached

1. **A chained `withCollections` on the client.** This was the first proposal. It works with the explicit `<Contract>`, because the second call has none. It was dropped once we saw it only works around the explicit type argument.
2. **Register once on the static entry, and build the client from it:** `postgres(postgresStatic<Contract>({...}).withCollections({...}), { url })`. This gives one source of truth for the static and runtime halves. It was dropped after the usage survey, because applications do not split their client.
3. **Frame the static part as the contract.** Will proposed `const contract = postgresContract<Contract>({ json, collections }); const db = postgres(contract, ...)`. The key insight is that the type argument gets a call of its own. Two adjustments made it the decision:
   - The classes cannot go into that call, because it still has an explicit type argument and they would lose their types there. They go on the client call, which has none.
   - The value holds only the contract, because "the contract" in this codebase means the emitted, hashed data description. The client already infers its contract type from `{ contract }` for TypeScript-authored contracts, so emitted contracts take that same path.

## Decisions for the team to review

- **The name and place of the function.** `contractFromJson<Contract>(json)`, exported from each facade's `/static` entry point. `/static` already validates contract JSON and does not load the driver. The alternative was `postgresContract`, which repeats the target name that the import path already says. `defineContract` (in `/contract-builder`) builds a contract from code; `contractFromJson` builds one from JSON.
- **Removing `contractJson` from every client in one release.** This is a breaking change during the release candidates, with upgrade instructions. Keeping both options would leave two ways to do the same thing, and the old one could not carry `collections`.
- **No ORM on the static entries or the serverless client.** ADR 263 keeps the serverless client to members that are safe at module scope. A tool gets the ORM by loading the application's client.
- **`toSql(plan)` as a static member.** It returns `{ sql, params }` and needs only the adapter. It is a static member under ADR 263, so the serverless client has it too.

## Alternatives

The ADR lists the alternatives and why each was rejected:

- the chained `withCollections`;
- registering the classes on the static entry;
- putting the classes inside the contract value;
- inferring the contract from the classes;
- typing the JSON import with `allowArbitraryExtensions`;
- a program-wide registry filled by declaration merging.
