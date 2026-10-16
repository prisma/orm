# ADR 230 — Runtime target layer: session-coupled connections

**Status:** Accepted

A Supabase app wants every query to run *as the user who made the request*, so that Postgres Row-Level Security filters rows automatically:

```ts
const db = await supabase({ contract, url, jwtSecret });
const rows = await db.asUser(jwt).orm.public.Profile.find(/* … */);
// runs as the authenticated user; RLS returns only the rows that user may see
```

For this to be safe, the database session state that identifies the user — the Postgres `role` and the `request.jwt.claims` GUC — must be set on the *exact connection the query runs on*, and **no application code may be able to run a query without it set**. That second clause is the whole problem. If any code path can reach the connection with the role unset, RLS silently returns rows the user should never see — a security failure that fails open.

The runtime had nowhere to enforce this. Its class hierarchy stopped at a single internal SQL implementation; connections were acquired deep inside the runtime, beneath the user-middleware chain; and the only extension point was that middleware — which is exactly the layer that must *not* be able to touch session state.

## Decision

Three moves, top to bottom:

1. **Give the runtime a layered class hierarchy with a clean interface/implementation split.** An abstract family base (`SqlRuntimeBase`) that targets extend; concrete per-target implementations (`PostgresRuntimeImpl`, `SqliteRuntimeImpl`); and bare-named interfaces (`Runtime`, `PostgresRuntime`, `SqliteRuntime`, `SupabaseRuntime`) as the only types callers depend on. Construction happens through target factories (`postgres()`, `sqlite()`, `supabase()`), which return interfaces — a concrete class never escapes into application code as a value.

2. **Let the family base hand a subclass a raw connection it can run setup SQL on, below the middleware chain.** `SqlRuntimeBase` exposes two protected seams, deliberately separate: *provision* a raw driver connection, and *execute* a typed plan against a given connection. A subclass provisions a connection, does whatever it needs to it, then runs the user's query against that same connection.

3. **Bind the role to the connection, not to the call.** `SupabaseRuntimeImpl` turns a provisioned connection into a **session**: it sets `role` and `request.jwt.claims` on the connection once, and hands back an object on which *every* query — single statements, ORM operations with their nested reads and writes, multi-statement transactions — runs against that bound connection. The role is a property of the session, so there is no call site that can forget it.

## How it works

### Interfaces are the dependency surface; `Base` is a class you extend, `Impl` is a concretion

Every layer exposes an interface (the bare name) and a class. Callers and tests depend only on the interface; factories build the class and return the interface.

| Layer | Interface (depend on this) | Class |
|---|---|---|
| Framework | `RuntimeExecutor` | `RuntimeCore` (abstract) |
| SQL family | `Runtime` | `SqlRuntimeBase` (abstract) |
| Target | `PostgresRuntime`, `SqliteRuntime` | `PostgresRuntimeImpl`, `SqliteRuntimeImpl` |
| Extension | `SupabaseRuntime` | `SupabaseRuntimeImpl extends PostgresRuntimeImpl` |

Two refinements are worth stating because they bend the usual rules:

- **`Impl` classes are exported**, not package-private. The classic pattern hides the concretion entirely, but `SupabaseRuntimeImpl` lives in a different package from `PostgresRuntimeImpl` and must extend it. So `Impl` classes are exported *solely as an extension seam* — to subclass, never to depend on as a type. The interface remains the only sanctioned dependency.
- **The SQL family interface is named `Runtime`, not `SqlRuntime`.** It is the one place the bare-name scheme isn't followed: it predates the scheme and is the most widely imported symbol in the runtime package, so the symmetry isn't worth a sweeping rename. It lives inside the SQL package, where the ambiguity is low.

Target interfaces start as empty extensions of `Runtime`. Their value is the *named dependency surface* — code can depend on `PostgresRuntime` today, and Postgres-specific runtime surface can be added later without a breaking change.

### The family base provisions a connection separately from executing against it

`SqlRuntimeBase` exposes two protected operations:

- **Provision** — acquire a raw driver connection. The driver's connection is already the queryable abstraction the runtime executes against, so SQL issued directly on it never passes through the codec, middleware, or telemetry pipeline. That *is* the "below the middleware chain" property — there is no separate below-middleware hook to build, just direct use of the raw connection. The connection also carries its own lifecycle (`release`, `destroy`, `beginTransaction`).
- **Execute** — run a typed query plan, fully middleware-wrapped, against a connection supplied by the caller. A subclass provisions a connection, prepares it, and then runs typed plans against that same connection without reimplementing the execution pipeline.

The base knows nothing about sessions, roles, or Supabase. Provisioning and execution are kept apart precisely so a subclass can interleave its own setup between them.

### A subclass turns a connection into a session

`SupabaseRuntimeImpl` composes those two seams into a role-bound session:

- **Bind once, at the start.** It issues `SELECT set_config($1, $2, false)` for `role` and for `request.jwt.claims`. The call is parameterized: `SET role = $1` is not valid Postgres, and building the statement by string interpolation would be an injection vector. `is_local = false` makes the settings session-scoped on that physical connection — which is what makes the object a *session* and not a single transaction.
- **Everything runs bound.** The session executes typed plans through the protected execute seam, runs transactions as plain transactions on the bound connection, and exposes raw access to its own internals. Application code never receives the session's underlying connection directly: the role-bound `Db` returned by `asUser` / `asAnon` / `asServiceRole` has no method that hands back an unbound connection. The safety guarantee is this encapsulation — the runtime *class* still inherits the generic unbound `connection()` and `execute()`, but the façade never surfaces them.
- **Reset on release; destroy on doubt.** When a session ends it issues `RESET ALL` before returning the connection to the pool; if that reset fails, the connection is destroyed rather than pooled. This is what prevents one request's role from leaking into the next request that reuses the connection — and it lives in one place, the session lifecycle, not in every caller.
- **One session per operation.** The role-bound `Db` opens a fresh session per execute, per ORM operation, and per explicit transaction block. The ORM's own connection-scoping is the enforcement mechanism: it asks the session for a connection and runs its whole operation — including nested reads and writes — against it. No connection or transaction is held open across application logic.

The payoff of binding on the session rather than the call: a security review of "can a query run unbound?" reduces to one structural question — *does any method on the role-bound façade hand out a connection that hasn't been through `set_config`?* — rather than an audit of every call site that runs SQL.

## Consequences

- **RLS enforcement is structural.** Because the binding lives on the connection and the façade exposes no unbound path to it, every query inherits the role. The standing invariant to protect (and the thing a test should lock) is that the role-bound `Db` exposes no unbound connection-bearing method.
- **Extension authors get one model.** Depend on bare-name interfaces; extend the `Base` class; provision a connection from the family seam; bind your own semantics onto it before running queries.
- **Two safety disciplines are owned by the substrate, not callers.** Connection lifecycle (release vs. destroy) and session hygiene (reset, or destroy on failure to reset). Both are verifiable with a recording fake driver against real runtime objects — no need to mock the runtime's own classes.
- **There is no family-level runtime factory.** Every runtime is constructed by a target factory as its concrete target class. Code that needs a runtime goes through `postgres()` / `sqlite()` / `supabase()` and depends on the returned interface.

## Alternatives considered

- **Bind the role at the call site** — set `role` / `request.jwt.claims` as a step inside each `execute()` call, or thread the role through per-call execute options. Rejected, and the reasoning is the load-bearing one for this whole ADR: when the binding belongs to a *call*, every code path that reaches the connection another way is an unbound path. In particular the ORM acquires its own connection scope and runs a graph of statements on it; a per-call binding sits above that and the ORM's statements run unbound. A binding placed on a call site makes every other call site a hole. Binding on the connection/session removes the holes by construction. (Threading the role through the cross-family execute-options type also leaks a SQL-and-security concept into a framework type that has no business knowing about it.)
- **Transaction-local binding** (`SET LOCAL` / `set_config(…, true)`) per operation. Postgres resets transaction-local settings automatically at commit/rollback, which is appealing. But it forces a transaction around *every* statement and conflates "transaction" with "session." Session-scoped binding plus an explicit `RESET ALL`-on-release discipline keeps the session concept honest and owns cleanup in one lifecycle implementation.
- **A family-level construction factory returning a hidden default implementation.** Rejected: a generic family-level construction path contradicts thin-core/fat-targets (each target owns its runtime), and exporting a default concretion invites exactly the class-coupling the interface/factory split exists to prevent.
- **Composition / decoration for the Supabase runtime** — wrap a base runtime and forward to it. Rejected: a decorator has to re-forward every method the base grows, and a Supabase runtime genuinely *is a* Postgres runtime — the relationship is subtyping, not delegation.

## References

- [ADR 005 — Thin Core, Fat Targets](ADR 005 - Thin Core Fat Targets.md)
- [`no-target-branches.mdc`](../../../.agents/rules/no-target-branches.mdc) — why target-specific behaviour lives in a target class, not a branch
- [Interface + factory pattern](../patterns/interface-plus-factory.md)
- [Runtime & Middleware Framework](../subsystems/4. Runtime & Middleware Framework.md) — subsystem reference
- Driver contract: `packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts` (`SqlConnection`, `SqlQueryable`)
- ORM connection scoping: `packages/3-extensions/sql-orm-client/src/collection-runtime.ts` (`acquireRuntimeScope`)
