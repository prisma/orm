# The client's default logger writes to the console

## At a glance

An application connects to a database that was signed for a different contract, and passes no `log`:

```ts
const db = postgres({ contract, url });
await db.orm.public.User.select('id').all();
```

Today nothing is printed, and the query runs. After this change the first query prints, on standard error:

```text
{
  code: 'CONTRACT.MARKER_MISMATCH',
  scope: 'marker-verification',
  expected: { storageHash: '…', profileHash: '…' },
  actual: { storageHash: '…', profileHash: '…' },
  message: 'Contract marker hash does not match runtime contract'
}
```

## Decision

When an application passes no `log`, the SQL clients (`postgres()`, `postgresServerless()`, `sqlite()`, `supabase()`, and the MySQL and MariaDB clients) and the MongoDB client (`mongo()`) log to the console:

| Level | Goes to | Stream in Node |
| --- | --- | --- |
| `error` | `console.error` | standard error |
| `warn` | `console.warn` | standard error |
| `info` | `console.info` | standard output |
| `debug` | nowhere | — |

Each event object is passed to the console method unchanged, so the default behaves like `log: console`, except that debug events are dropped. The console method is looked up at each call, so an application or test that replaces `console.warn` later still receives the events.

Debug events are dropped because they are per statement: the framework logs `middleware.intercept.onQuery`, `middleware.intercept.onExecute` and `middleware.rewrite`, and the cache middleware logs a hit or a miss, at debug level for each statement. Printing those by default would flood an application's console. An application that wants them passes a `log` with a `debug` method, as today.

An application that wants silence passes a logger that does nothing:

```ts
const silent = { info() {}, warn() {}, error() {} };
const db = postgres({ contract, url, log: silent });
```

The capability warning `CONTRACT.CAPABILITIES_NOT_PROVIDED`, which the PostgreSQL and Supabase clients give when they are created, uses the same default.

The MongoDB client has had no `log` option. It gains one, with the same type and default as the SQL clients. Today the MongoDB runtime logs only the errors a middleware's `activityEnded` or `activityFinalized` hook throws, which it swallows, and the framework's debug events; it has no signature check and no capability warning.

## Why

The runtime's signature check only warns, by design: an application must never stop because of Prisma's own records (see the decision record "The runtime's marker check only warns"). When the warning is dropped, nothing at all reports that an application is pointed at a database signed for another contract, or at one never signed. A warning nobody can see is not a diagnostic.

The same holds for the capability warning, the lint warnings, the budget warnings in permissive mode, the warning that `close()` is waiting for activities never ended, and the errors from middleware hooks that the runtime swallows. All of these were written to be seen.

It must happen before release 8.0. From 8.0, an application upgrades to any later 8.x release with no changes, and a client that starts printing in 8.3 is a change of behaviour inside the major.

## Prior art

Checked against each project's source or docs on 2026-11-28.

- **No client prints per-query output by default**, except Sequelize, whose `logging` defaults to `console.log` of every query. Drizzle, Kysely, Knex, TypeORM and Prisma 6 all need an option for it. This supports dropping debug events.
- **Clients that log through a configurable logger mostly drop warnings by default**: Drizzle, Kysely, TypeORM, and Prisma 6's `log` option, which prints `prisma:warn` lines only when `log` includes `warn`.
- **Warnings about misuse or misconfiguration usually print anyway**: Knex prints `warn`, `error` and `deprecate` by default (through `console.log`); the MongoDB driver calls `process.emitWarning`, which Node prints on standard error; `pg` prints its deprecations through Node's `util.deprecate`; and Prisma 6 has a `warnOnce` helper that always prints through `console.warn`, silenced with `PRISMA_DISABLE_WARNINGS`.

The warnings our runtime logs are of the second kind: a database signed for another contract, a capability the connection lacks, a lint rule set to warn. So they print, on standard error as Node's own warnings do, and per-statement events do not. Prisma 7 was not checked.

## What changes for users

- Warnings and errors that were dropped now print on standard error. An application that relies on a silent console passes the silent logger above.
- The MongoDB client takes `log`.
- The upgrade instructions say both.

## What does not change

- The `log` option's type (`RuntimeLog`, exported as `Log`), and what each event contains.
- A `log` the application passes receives exactly what it receives today, debug events included when it has `debug`.
- A logger that throws still does not fail the call.
- `verifyMarker: false` still turns off the signature check and the capability warning.

## Alternatives considered

- **Format each event as one line, such as `prisma:warn <message>`.** Prisma 6 does this. It loses the structured fields (the hashes, the missing capabilities), and it makes the text a second format to keep stable through 8.x. The event already starts with its `code`, which names the source.
- **Print debug events too.** They come once per statement or more, so the console would fill with them.
- **Put the default in the framework's runtime core, shared by both families.** The framework domain is not changed for this; the default is three lines, kept once in each family's runtime.
- **Export a ready-made silent logger.** It adds a public name for a one-line object; the docs show the object instead.
