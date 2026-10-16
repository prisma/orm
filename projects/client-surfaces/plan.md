# Plan: complete client surfaces

**Spec:** [spec.md](spec.md). **Design:** [ADR 274](../../docs/architecture%20docs/adrs/ADR%20274%20-%20A%20client%20takes%20a%20typed%20contract%20value%2C%20so%20every%20other%20option%20is%20inferred.md), [design-notes.md](design-notes.md).

Four slices, one after another. Every slice changes the same facade files (`packages/3-extensions/{postgres,sqlite,supabase}/src/runtime/`), so running them side by side would mean constant merge conflicts. Each slice is one PR from `main`.

## Slices

### 1. Clients take a typed contract value — TML-3602

- **Delivers:** `contractFromJson<Contract>(json)` on each facade's `/static` entry point. Every client and static entry takes `{ contract }` only. The contract is validated once. Every call site, template, doc and skill moves. Upgrade instructions.
- **Builds on:** nothing.
- **Hands to slice 2:** client calls with no explicit type argument, so any new option is inferred.

### 2. Every SQL client takes custom collection classes — TML-3546

- **Delivers:** a `collections` option on every SQL client. The classes reach `db.orm`, `tx.orm`, serverless connections and Supabase role-bound clients. The client types gain a type parameter for the classes. The examples drop `createOrmClient`.
- **Builds on:** slice 1.
- **Hands to slice 3:** client types that carry the classes, so a transaction's ORM can be typed with them.

### 3. A transaction offers the client's query members — TML-3603

- **Delivers:** `tx` with `orm`, `sql`, `raw`, `prepare`, `query` and `execute` on every SQL client, Supabase included. SQLite's ORM offers `fragment`.
- **Builds on:** slice 2.
- **Hands to slice 4:** one set of query members, the same on a client and a transaction client.

### 4. Loading without a database, SQL text, and running plans — TML-3604

- **Delivers:** a no-database load test for every client. `toSql(plan)` as a static member. `query(plan)` and `execute(plan)` on clients. A `mode` option on SQL clients. Examples move off `db.runtime().query(plan)`.
- **Builds on:** slice 3.

## Dependencies

- **Release:** users get the change in the first release candidate after slice 1 merges. Slice 1 is breaking, so it must ship with its upgrade instructions in the same release.
- **TML-2398** (serverless session helper, another project): if it lands first, slice 2 passes `collections` through it. If slice 2 lands first, TML-2398 must pass them on.

## Close-out

- [ ] Verify the project definition of done in [spec.md](spec.md).
- [ ] ADR 274 to Accepted, matching the shipped code.
- [ ] Final retro.
- [ ] Strip references to `projects/client-surfaces/` and delete the folder.
