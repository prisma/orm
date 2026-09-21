# ADR 254 — Target-owned built-in query operations

**Status:** Accepted

**Related:** [ADR 005 — Thin core, fat targets](ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md) draws the line between what a target knows and what an adapter does. [ADR 016 — Adapter SPI for Lowering](ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md) makes the adapter responsible for turning an AST into a statement. [ADR 206 — Operations as TypeScript functions](ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md) defines how an operation is authored. [ADR 251 — Target-owned Postgres list framing](ADR%20251%20-%20Target-owned%20Postgres%20list%20framing.md) is the precedent for moving Postgres semantics out of the adapter.

---

## Context

Postgres has always shipped one built-in query operation, `ilike`, and it lived in `@internal/adapter-postgres`. The adapter was the only Postgres component with a `queryOperations` slot at the time, so that is where it went.

That placement says the wrong thing about ownership. `ILIKE` is not a lowering decision. It is part of the Postgres query language, known before anything is executed and true no matter which driver or adapter carries the statement to the server. The adapter's job, per ADR 016, is to render an AST and bind its parameters; deciding that Postgres spells case-insensitive matching `ILIKE` is the target's job, per ADR 005.

The placement also leaks into generated code. Every emitted Postgres `contract.d.ts` named `@internal/adapter-postgres/operation-types` in an import, so an application's contract types depended on the adapter package for vocabulary the target defines.

Adding full-text search made the mismatch concrete. `to_tsvector`, `websearch_to_tsquery`, `ts_rank` and `ts_headline` are Postgres functions with Postgres semantics — including the set of text-search configurations a server ships with. None of that is adapter knowledge.

## Decision

Built-in query operations for a target live in the target package. For Postgres that is `@internal/target-postgres`, which now contributes `ilike`, `fullTextMatches`, `fullTextRank` and `fullTextHeadline`. `@internal/adapter-postgres` contributes no query operations at all; its `operation-types` export and the `queryOperations` slot on its runtime descriptor are removed rather than kept as forwarding shims.

Nothing in the framework had to change to allow this. `SqlStaticContributions.queryOperations` is already optional on every SQL component, `createSqlExecutionStack` already iterates the target alongside the adapter and the extensions, and `extractQueryOperationTypeImports` already reads `types.queryOperationTypes` from every descriptor in the stack. The target simply fills slots it had left empty.

Extensions are unaffected. An extension pack still contributes its own operations the same way; the change is only about where a *target's built-in* vocabulary lives. Adapters keep the ability to contribute operations — a genuinely adapter-specific operation is still legal — but Postgres no longer has one.

The three full-text operations follow ADR 206: each is a TypeScript function whose signature is its type-level surface. They dispatch on `self: { traits: ['textual'] }`, so they appear on any textual column, exactly as `ilike` does. The search string is bound as a `pg/text@1` parameter. The language is a second, optional argument defaulting to `'english'`, and it is written into the SQL as an inline literal rather than a parameter, because Postgres will not accept a parameter in the configuration position of `to_tsvector`. An inline literal has to be trustworthy, so the language is checked against the configurations a stock PostgreSQL server ships with, and anything else throws `RUNTIME.ARGUMENT_INVALID` before a statement is built.

`websearch_to_tsquery` is the only query parser used. It accepts the syntax an application's users already type — quoted phrases, `-word` to exclude, `or` between terms — and it does not raise a syntax error on arbitrary input, which `to_tsquery` does.

## Consequences

Emitted Postgres `contract.d.ts` files change: they import `QueryOperationTypes` from `@internal/target-postgres/operation-types` under the alias `PgTargetQueryOps` instead of from the adapter under `PgAdapterQueryOps`. `contract.json` does not change, and no contract hash moves. An application regenerates its contract types and keeps working.

An extension or application that imported `@internal/adapter-postgres/operation-types` directly must import `@internal/target-postgres/operation-types` instead. There is no compatibility re-export, per `no-backward-compatibility.mdc`.

Full-text search needs no new codec, no capability key and no extension. `tsvector` and `tsquery` never leave the server — they are constructed and consumed inside a single expression — so nothing has to cross the wire in a shape the codec registry does not already know.

Performance is the application's responsibility, because the operation does not create indexes. `fullTextMatches` renders `to_tsvector('<language>', "<column>")`, so a GIN index that is to answer the predicate has to be the same `to_tsvector` over the same configuration literal and the same column — Postgres compares parsed expressions, not text, so qualifying the column or not makes no difference:

```prisma
@@fullTextIndex([text], name: "message_text_search")
```

An index whose expression differs — a different language, or a `tsvector` column maintained by a trigger — will not be used, and nothing says so: the query simply falls back to a sequential scan, with no error and no warning. That silent failure is the reason the attribute exists.

Because the index and the predicate have to agree on the function, the configuration and the column, the target contributes the index as well as the operations: `@@fullTextIndex([text], name: …)` renders it from the resolved storage column and the same language allowlist, so an author never writes `to_tsvector` by hand and the two cannot drift apart. This needed no new IR — the attribute lowers to the `IndexNode` `@@index(expression:)` already produces — but it did need the framework to let a contributed model attribute return an index instead of a namespaced entity, and to let a descriptor declare itself repeatable. `@@index(expression:)` stays for expressions the attribute does not cover.

The set of accepted languages is a hand-maintained list. A server with a custom text-search configuration installed cannot name it. That is the price of keeping the language out of the parameter list; widening it later means deciding how Prisma learns what a given server has configured, which is a question this decision does not answer.

## Implementation anchors

- The operations and the language list: [`query-operations.ts`](../../../packages/3-targets/3-targets/postgres/src/core/query-operations.ts).
- The index attribute and the one place its expression is rendered: [`authoring.ts`](../../../packages/3-targets/3-targets/postgres/src/core/authoring.ts), [`full-text-index-expression.ts`](../../../packages/3-targets/3-targets/postgres/src/core/full-text-index-expression.ts).
- That Postgres really does choose the index for the SQL the lanes lower, proved with `EXPLAIN` against a real server, including the controls that fail: [`full-text-index-usage.test.ts`](../../../test/integration/test/sql-builder/full-text-index-usage.test.ts).
- Their type-level surface, re-exported as the package's `./operation-types` entry: [`operation-types.ts`](../../../packages/3-targets/3-targets/postgres/src/types/operation-types.ts).
- The runtime target descriptor that contributes them: [`runtime.ts`](../../../packages/3-targets/3-targets/postgres/src/exports/runtime.ts).
- The import spec the emitter writes into `contract.d.ts`: [`descriptor-meta.ts`](../../../packages/3-targets/3-targets/postgres/src/core/descriptor-meta.ts).
- The contributor loop that registers every component's operations: [`sql-context.ts`](../../../packages/2-sql/5-runtime/src/sql-context.ts).
- The control-plane collection of type imports: [`control-stack.ts`](../../../packages/1-framework/1-core/framework-components/src/control/control-stack.ts).

## Alternatives considered

### Leave the operations in the adapter and add full-text search there

Rejected. It keeps `ILIKE` and `to_tsvector` — plain Postgres language — inside the component whose stated job is rendering and transport, and it keeps every generated contract depending on the adapter package for vocabulary the target defines. ADR 251 already moved Postgres list semantics out of the adapter for the same reason.

### Ship full-text search as an extension pack

Rejected. An extension exists for things a server may or may not have: `pgvector`, `postgis`, ParadeDB's `bm25`. Full-text search is in core PostgreSQL and has been for many releases. Requiring an install step for it would misrepresent what an application has to do.

### Accept any string as the language

Rejected. The language is interpolated into the SQL rather than bound, so an unchecked string is a SQL-injection hole on any path where the value is not a compile-time constant. The allowlist is the smallest thing that makes the inline literal safe.

### Use `to_tsquery` or `plainto_tsquery`

Rejected. `to_tsquery` raises a syntax error on ordinary user input, which turns a search box into a source of failed queries. `plainto_tsquery` is safe but throws away the operators users expect — quoted phrases and negation. `websearch_to_tsquery` is forgiving and supports both.
