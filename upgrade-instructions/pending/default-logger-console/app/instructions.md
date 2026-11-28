---
changes:
  - id: default-logger-console
    summary: |
      A client created without `log` (`postgres()`, `postgresServerless()`, `sqlite()`, `supabase()`, the MySQL and MariaDB clients, and `mongo()`) now writes the runtime's warnings to `console.warn` and its errors to `console.error`, which in Node go to standard error, and its info events to `console.info`. Debug events are still dropped. Before, the client dropped every event. An application that needs a silent console passes `log: { info() {}, warn() {}, error() {} }`. `mongo()` now takes `log`, with the same type and default as the SQL clients.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '@prisma/orm-(?:postgres|sqlite|mysql|mariadb|mongo|extension-supabase)/(?:runtime|serverless)[''"]'
---

# The client logs to the console by default

## `default-logger-console`

The runtime logs warnings and errors that do not stop a call: the marker-check warnings such as `CONTRACT.MARKER_MISMATCH` and `CONTRACT.MARKER_MISSING`, the `CONTRACT.CAPABILITIES_NOT_PROVIDED` warning, the warnings of `lints()` and of `budgets()` in `mode: 'permissive'`, the `runtime.close.waiting-for-activities` warning, and the errors a middleware's `activityEnded` or `activityFinalized` hook throws. A client created without `log` used to drop all of them. It now passes each event object, unchanged, to the console:

| Level | Goes to |
| --- | --- |
| `error` | `console.error` (standard error in Node) |
| `warn` | `console.warn` (standard error in Node) |
| `info` | `console.info` (standard output in Node) |
| `debug` | nowhere |

A client created with `log` receives exactly what it received before. An error that one of its methods throws is now discarded everywhere: it no longer fails a query or the creation of a client.

Most applications need no change: a warning that now prints points to something to fix, such as a database signed for another contract. In each file the detection matches, look at each client created without `log`. If the application must keep its console silent, for example a command-line tool whose output another program reads, pass a logger that does nothing:

```ts
const silent = { info() {}, warn() {}, error() {} };
const db = postgres({ contract, url, log: silent });
```

A test that asserts on console output, or fails on any console write, may now see these events; pass the silent logger to the clients it creates.

`mongo()` takes the same `log` option. Its runtime logs the errors a middleware's `activityEnded` or `activityFinalized` hook throws, which it swallows.
