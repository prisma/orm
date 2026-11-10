---
changes:
  - id: runtime-activity-is-activity
    summary: |
      `RuntimeActivity` is renamed `Activity`, with no alias. It is the type of the `activity` parameter of `activityStarted`, `activityEnded` and `activityFinalized`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bRuntimeActivity\b'
  - id: activity-includes-client-activities
    summary: |
      `Activity` is `StatementActivity | TransactionActivity | ClientActivity`, and `ActivityEndedResult` includes `ClientActivityEnded`, in every program. A client activity's kind contains a hyphen, such as `orm-call`. A hook that narrows by ruling out `'transaction'` and then reads statement fields no longer compiles. Narrow by the kind you handle, such as `if (result.kind !== 'statement') return;`, and ignore kinds you do not know.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.kind\s*===\s*[''"]transaction[''"]'
  - id: start-a-client-activity
    summary: |
      An extension can start an activity of its own kind with `startActivityOn(queryable, { kind, contentHash, annotations? })`, where `contentHash` is a function returning a promise of the digest, for example `() => planContentHashOn(queryable, plan)`; middleware read it with `activity.contentHash()`, which computes it once per activity and only when asked. The extension sends statements through the returned handle and must end every handle with `end({ outcome, result? })`, in a `finally`; an open handle keeps `close()` waiting. A middleware can supply the activity's result through `intercept.onActivity(activity, ctx)`. Registering the kind in `ClientActivityRegistry` types the handle's `intercepted.result` and `end({ result })`; in middleware hooks the result stays `unknown`.
  - id: runtime-connections-carry-an-activity-source
    summary: |
      The SQL runtime's queryables start client activities through an `activitySource` member, keyed by a symbol so the public queryable types do not show it, which `startActivityOn` and `planContentHashOn` read. A connection-like object that a `SqlRuntimeBase` subclass builds over a raw connection adds `[activitySource]: this.connectionActivitySource(connection, () => session)`, and `ActivitySourceTarget` to the object's declared type, so activities can start on it. The public `RuntimeConnection` type does not require it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\[transactionStart\]\s*:'
  - id: begin-transaction-on-takes-a-parent
    summary: |
      `SqlRuntimeBase.beginTransactionOn(connection, owner)` takes a third argument, `parent`: the activity the transaction starts beneath, or `undefined`. Pass `undefined` where you began a transaction before.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bbeginTransactionOn\s*\(\s*[^,()]+,\s*[^,()]+\)'
  - id: transaction-activity-takes-a-parent
    summary: |
      `startTransactionActivity` requires `parent` (the activity the transaction starts beneath, or `undefined`). An `ActivityParent` has `acceptsChildren()`, and its `adopt(child)` returns an `ActivityChildSlot` (`statementFailed()`, `ended(own)`, `transactionAcceptsChildren()`) instead of an end callback; `ActivityParent.activity` is an `ActivityBase`. A transaction stops accepting children with `stopAcceptingChildren()`, and adopting beneath a parent that no longer accepts children throws `RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN` instead of an internal error.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bstartTransactionActivity\s*\('
        - '\.adopt\s*\('
  - id: orm-runtime-objects-carry-an-activity-source
    summary: |
      The ORM reaches activities only through `startActivityOn` on the queryable it holds, and a queryable without an `activitySource` member starts none. `db.runtime()` passed straight to `orm()` carries one. A facade, such as `postgres()`, that builds its own ORM runtime object, such as one that looks up its runtime on every call, adds `[activitySource]: delegatingActivitySource(() => runtime)` from `@prisma/orm-family-sql/runtime`, for the runtime and for the context of `db.transaction(fn)`. Where the facade's statements run through sessions of its own, such as role sessions, give an activity source whose statements go the same way, or none.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bormBuilder\s*\(|\borm\s*\(\s*\{\s*runtime\s*:'
---

# Clients start their own activities

The runtime's middleware tree now has a third kind of activity: one a client starts for an act the runtime would not otherwise see, such as an ORM call. A client starts it with `startActivityOn(queryable, activity)` and sends statements through the returned handle. A middleware can supply such an activity's result through the new `intercept.onActivity` handler.

## Rename `RuntimeActivity`

Replace every `RuntimeActivity` with `Activity`, imported from the same module:

```ts
// before
import type { RuntimeActivity } from '@prisma/orm-framework/components/runtime';
async activityStarted(activity: RuntimeActivity, ctx) {}

// after
import type { Activity } from '@prisma/orm-framework/components/runtime';
async activityStarted(activity: Activity, ctx) {}
```

## Narrow activities by the kind you handle

`Activity` always includes `ClientActivity`, whose kind contains a hyphen. A hook that rules out `'transaction'` and then reads statement fields stops compiling. Test for the kind you handle instead:

```ts
// before
if (result.kind === 'transaction') return;
record(result.latencyMs);

// after
if (result.kind !== 'statement') return;
record(result.latencyMs);
```

A middleware that sees a kind it does not know should ignore it rather than fail.

## Start your own activity

An extension can start an activity for an act of its own, such as a report that sends several statements, so that middleware observe it, finalize it and can serve it from a cache.

**Dependencies.** `startActivityOn`, `planContentHashOn` and the types their signatures name, such as `StartActivity`, `ClientActivity`, `ClientActivityKind` and `ActivityInterceptResult`, are in `@prisma/orm-family-sql/runtime`. The registry, `ClientActivityRegistry`, is in `@prisma/orm-framework/components/runtime`, which also has the types. An application or extension that uses `postgres()` already depends on `@prisma/orm-postgres`, which re-exports both as `@prisma/orm-postgres/components/runtime` and `@prisma/orm-postgres/family-runtime`. Augment `ClientActivityRegistry` through the entry that exports it, `@prisma/orm-framework/components/runtime` or `@prisma/orm-postgres/components/runtime`; augmenting it through `@prisma/orm-family-sql/runtime` or `@prisma/orm-postgres/family-runtime` registers nothing, and TypeScript reports no error.

**Register the kind.** A client kind contains a hyphen; a kind without one is rejected with `RUNTIME.ACTIVITY_KIND_RESERVED`. Registering the result type is optional. The file that augments the entry must also import from it, or TypeScript reports that the module cannot be found:

```ts
import type { ClientActivityResult } from '@prisma/orm-postgres/components/runtime';

declare module '@prisma/orm-postgres/components/runtime' {
  interface ClientActivityRegistry {
    'report-run': { result: { readonly emails: readonly string[] } };
  }
}

export type ReportResult = ClientActivityResult<'report-run'>;
```

The registry types the handle side only: `call.intercepted.result` and `call.end({ result })`. In middleware hooks the result of a client activity is `unknown`, even after `result.kind === 'report-run'`, because the hook types must accept unregistered kinds; check or cast the value there.

**Start, use and end it.** Pass a function that derives the content hash from the plan with `planContentHashOn`; the runtime calls it only when a middleware calls `activity.contentHash()`, and once per activity. It equals the digest `ctx.contentHash(exec)` returns for the statement's execution plan only when `beforeCompile` gives the same result for the plan in both places (for `planContentHashOn` it runs with the scope and parent of the queryable it is called on and with fresh state, so on the runtime itself it has no parent; for the statement it runs beneath the handle, with the state its `activityStarted` hooks wrote), no `beforeEncode` hook changes the parameters, and the codecs encode deterministically; a cache should key on the activity's own content hash and not rely on the two being equal. End every handle, in a `finally`, or `close()` waits for it forever:

```ts
import { planContentHashOn, startActivityOn } from '@prisma/orm-postgres/family-runtime';
import type { SqlQueryPlan } from '@prisma/orm-postgres/relational-core/plan';
import type { PostgresClient } from '@prisma/orm-postgres/runtime';

async function runReport(db: PostgresClient<Contract>, plan: SqlQueryPlan<{ email: string }>) {
  const runtime = db.runtime();
  const call = await startActivityOn(runtime, {
    kind: 'report-run',
    contentHash: () => planContentHashOn(runtime, plan),
  });
  let outcome: 'succeeded' | 'failed' = 'failed';
  let result: { readonly emails: readonly string[] } | undefined;
  try {
    if (call.intercepted) {
      outcome = 'succeeded';
      return call.intercepted.result.emails;
    }
    const rows = await call.query(plan).toArray();
    result = { emails: rows.map((row) => row.email) };
    outcome = 'succeeded';
    return result.emails;
  } finally {
    await call.end({ outcome, ...(result === undefined ? {} : { result }) });
  }
}
```

Statements sent through `call` are the activity's children. `call.transaction()` starts a transaction beneath it, on a connection it owns; it is absent when the handle was opened under a transaction. `startActivity` on the handle nests another activity.

**Serve it from middleware.** `intercept.onActivity(activity: ClientActivity, ctx)` runs after `activityStarted`; the first handler that returns `{ result }` wins, and the handle's `intercepted` is set. The ended result carries `source: 'middleware'` when the client then ends without a result:

```ts
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime';

const served = new Map<string, unknown>();

const reportCache: SqlMiddleware = {
  name: 'report-cache',
  familyId: 'sql',
  intercept: {
    async onActivity(activity) {
      if (activity.kind !== 'report-run') return undefined;
      const hit = served.get(await activity.contentHash());
      return hit === undefined ? undefined : { result: hit };
    },
  },
  async activityEnded(activity, result) {
    if (activity.kind !== 'report-run' || result.kind !== 'report-run') return;
    if (result.outcome === 'succeeded' && result.source === 'client' && result.result !== undefined) {
      served.set(await activity.contentHash(), result.result);
    }
  },
};
```

## Give your connection objects an activity source

Inside a `SqlRuntimeBase` subclass, a connection-like object over a raw connection gets its activity members from the base class:

```ts
const session: RoleSession & TransactionStartTarget & ActivitySourceTarget = {
  [transactionStart]: createTransactionStart(),
  [activitySource]: self.connectionActivitySource(conn, () => session),
  // query, execute, transaction, release, destroy as before
};
```

`activitySource` and `ActivitySourceTarget` come from `@prisma/orm-family-sql/runtime`; `transactionStart`, `createTransactionStart` and `TransactionStartTarget` still come from `@prisma/orm-family-sql/runtime/internal/prepared-query`.

## Pass a parent when beginning or starting a transaction

```ts
// before
return self.beginTransactionOn(conn, session);
// after
return self.beginTransactionOn(conn, session, undefined);

// before
await startTransactionActivity({ middleware, context, holdFinishedChildren });
// after
await startTransactionActivity({ middleware, context, parent: undefined, holdFinishedChildren });
```

An `ActivityParent` you implement yourself has `acceptsChildren()` and returns an `ActivityChildSlot` from `adopt`. Most runtimes only pass the parent they were given to `streamStatement`, `executeStatement`, `startTransactionActivity` or `startClientActivity` and need no change.

## Give a facade's ORM runtime object an activity source

The ORM reaches activities only through the `activitySource` member of the queryable it holds. `db.runtime()` passed to `orm()` already carries it. A facade that builds its own runtime object for the ORM gives it the member:

```ts
import { activitySource, delegatingActivitySource } from '@prisma/orm-family-sql/runtime';

const orm = ormBuilder({
  runtime: {
    query: (plan) => getRuntime().query(plan),
    execute: (plan) => getRuntime().execute(plan),
    connection: () => getRuntime().connection(),
    [activitySource]: delegatingActivitySource(() => getRuntime()),
  },
  context,
});
```

Do the same for the ORM object inside `db.transaction(fn)`, with `delegatingActivitySource(() => txCtx)`. Do not add plain `startActivity` or `planContentHash` members instead: `findActivitySource` and `startActivityOn` read only the `activitySource` member, so an object with only the plain members starts no activity.

If the facade sends its statements through sessions of its own, such as role-bound sessions, the activity's statements and transaction must go through them too; give an activity source that does so, or none. The plain runtime's source would run the activity's statements without the session.
