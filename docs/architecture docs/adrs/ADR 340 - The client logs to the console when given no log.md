# ADR 340 — The client logs to the console when given no log

**Status:** Accepted
**Date:** 2026-11-28
**Domain:** Runtime & Execution

## At a glance

An application connects to a database that was signed for a different contract, and passes no `log`:

```ts
const db = postgres({ contract, url });
await db.orm.public.User.select('id').all();
```

The runtime's first use of the database checks the signature, finds a mismatch, and passes this event to `console.warn`, which in Node writes it to standard error. The query runs.

```ts
{
  code: 'CONTRACT.MARKER_MISMATCH',
  scope: 'marker-verification',
  expected: { storageHash: '…', profileHash: '…' },
  actual: { storageHash: '…', profileHash: '…' },
  message: 'Contract marker hash does not match runtime contract',
}
```

## Decision

A SQL client (`postgres()`, `postgresServerless()`, `sqlite()`, `supabase()`, and the MySQL and MariaDB clients) and the MongoDB client (`mongo()`) that is given no `log` logs to the console:

| Level | Console method |
| --- | --- |
| `error` | `console.error` |
| `warn` | `console.warn` |
| `info` | `console.info` |
| `debug` | none: the event is dropped |

Each event object is passed to the console method unchanged. The method is looked up at each call, so an application that replaces `console.warn` after creating the client still receives the events.

An application that passes `log` receives every event, debug events included when its `log` has a `debug` method. One that wants silence passes a logger whose methods do nothing:

```ts
const db = postgres({ contract, url, log: { info() {}, warn() {}, error() {} } });
```

A logger that throws, the default or one the application passed, never fails a call or the creation of a client. Each family's runtime wraps the log once, when it builds its context, and discards what a method throws. The capability warning given when a client is created is guarded the same way.

Each family keeps its own copy of the default, in its runtime package. The framework domain does not hold it.

## Why

The runtime reports several problems only through its log, and does not stop the application for them: a database never signed, or signed for another contract, or whose signature cannot be read ([ADR 333](ADR%20333%20-%20The%20runtime's%20marker%20check%20only%20warns.md)); a connection that does not provide a capability the contract requires ([ADR 335](ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md)); a lint rule set to warn; a budget exceeded in permissive mode; `close()` waiting for activities never ended; and an error a middleware hook throws, which the runtime swallows. When the default drops them, nothing reports these problems at all. For the signature warnings, that silence is the only sign an application gives that it is pointed at the wrong database.

Debug events are dropped because they come once per statement or more: the framework logs each middleware interception and rewrite at debug level, and the cache middleware logs each hit and miss. Printing them by default would fill an application's console.

Warnings and errors go to `console.warn` and `console.error`, which Node writes to standard error, so they do not mix into an application's standard output. Database tools that print by default do so for warnings about misuse or misconfiguration: the MongoDB Node.js driver through `process.emitWarning`, `pg` through Node's `util.deprecate`, Knex through its `warn` logger, and Prisma 6 through a helper that always calls `console.warn`. Per-query output is off by default in nearly all of them.

A logger is a diagnostic. A failure inside it says nothing about the application's work, so it must not fail that work.

## Consequences

- An application that relied on a silent console sees these warnings and errors, and passes the silent logger above to keep the old behaviour.
- A test that runs a client with no `log` and provokes a warning prints it.
- The default is part of the 8.x compatibility promise: which levels print, and to which console method.

## Alternatives considered

- **Drop every event unless `log` is given.** Problems the runtime reports only through its log then go unreported.
- **Format each event as one line, such as `prisma:warn <message>`, as Prisma 6 does.** The line loses the event's structured fields, such as the two hashes or the missing capabilities, and its text becomes a second format to keep stable. The event already starts with its `code`.
- **Print debug events too.** They come once per statement or more.
- **Hold the default in the framework's runtime core, shared by both families.** It would add to the framework domain for three lines that each family can keep.
- **Export a ready-made silent logger.** It adds a public name for an object of three empty methods.
