---
changes:
  - id: orm-annotations-on-the-call
    summary: |
      Every SQL ORM terminal method runs as one `orm-call` client activity, and the annotations a `configure` callback records live on that activity. The statements the call sends carry only the reserved keys the ORM sets, so a middleware that reads an ORM annotation from a statement plan (`handle.read(plan)` or `plan.meta.annotations`) finds nothing. Read it from the call: in `activityStarted(activity)` or `intercept.onActivity(activity)`, `if (activity.kind === 'orm-call') handle.read(activity)`. A middleware can answer the call through `intercept.onActivity`; the value must have the shape the terminal returns, or the ORM rejects with `ORM.INTERCEPTED_RESULT_INVALID`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.read\(\s*(?:plan|exec|draft)\b'
        - 'meta\.annotations\b'
  - id: cache-store-holds-cached-values
    summary: |
      A cache store for `@internal/middleware-cache` holds `CachedValue`, `{ kind: 'statement-rows', rows } | { kind: 'call-result', result }`, not `CachedRows`; `CacheStore` and `CacheEntry` default their value type to `CachedValue`, and `createCacheMiddleware` accepts only a `CacheStore<TMeta, CachedValue>`. Type a custom store with `CachedValue`, and make `get` give back a value equivalent to the one `set` was given, `kind` included. An ORM call's result holds decoded values such as `Date`, `bigint`, Temporal values and extension class instances, so a store that serializes needs a serializer that rebuilds them; JSON does not. `createInMemoryCacheStore` takes only the meta type now and always holds `CachedValue`: drop its second type argument.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bCachedRows\b'
        - 'createInMemoryCacheStore<[^>(]*,'
  - id: queryable-carries-the-activity-source
    summary: |
      The SQL ORM starts its `orm-call` activity on the queryable it was given, through the queryable's `activitySource` member, and sends every statement through the activity's handle. A wrapper that copies a runtime, connection or transaction to intercept its `query` and `execute` (for example to record plans) also copies the `[activitySource]` member, so ORM statements bypass the wrapper. Wrap the activity source too: return a source whose `startActivity` wraps each handle the same way, including the transaction its `transaction()` returns. A custom queryable passed to the ORM must carry an activity source: without one, every terminal method fails with `ORM.ACTIVITY_SOURCE_MISSING` (streaming terminals throw when called, the others reject). A test stub can use `delegatingActivitySource(() => realRuntime)`, or a source whose handles send their statements to the stub.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.\.\.\s*[\w.]+\s*,\s*(?:query|execute)\s*[:(]'
---

# ORM calls are activities

Each SQL ORM terminal method is one `orm-call` client activity, started with `startActivityOn` on the queryable the ORM holds. Its statements, its own transaction (`handle.transaction()`) and the read-back after a nested write are its children. The annotations are on the call.

## Read ORM annotations from the call

```ts
const audit: SqlMiddleware = {
  name: 'audit',
  familyId: 'sql',
  async activityStarted(activity) {
    if (activity.kind !== 'orm-call') return;
    const actor = auditAnnotation.read(activity);
    if (actor) log(actor);
  },
};
```

## Custom cache stores

```ts
import type { CachedValue, CacheStore } from '@internal/middleware-cache';

const store: CacheStore<unknown, CachedValue> = {
  // get, set and unset as before; value is now { kind: 'statement-rows', rows } or { kind: 'call-result', result }
};
```
