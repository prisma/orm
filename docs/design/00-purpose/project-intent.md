# Project intent

Prisma 8 is a TypeScript rewrite of Prisma ORM. Its centre is the data contract: one `contract.json`, with a matching `contract.d.ts`, that says what exists in the database and what is allowed. Queries compile into plans that are checked against the contract before they touch data.

The [vision](./vision.md) says what the maintainers value and where they invest. The [steering list](../../architecture%20docs/ADR-INDEX.md#steering-list) lists the requests the maintainers have declined, with what to use instead.

When other docs or code conflict with this page, treat this page as the project's intent.

## What this project is

- **A framework in which every part is an extension.** Support for each database, the ORM client and the query builders are extensions. They are built on the same public interface that any extension author uses.
- **A small core that the core team maintains.** The core does not take a feature that an extension or user code can provide. Will Madden, 2026-10-22: "we will not build in the core features which can be built in extension/user space."
- **Composed, not configured.** New behaviour comes from extensions and middleware, not from patching the core or adding global flags ([ADR 005](../../architecture%20docs/adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md)).

## Who it is for

- **TypeScript and JavaScript developers** who build applications on a database.
- **Software agents, and the people working alongside them.** Agents need predictable behaviour, machine-readable structure and fast feedback. The packages ship skills that agents load to do the work.
- **Teams moving from Prisma 7, one step at a time.** Prisma 8 can read a Prisma 7 schema as its contract source while Prisma 7 still owns the database ([ADR 252](../../architecture%20docs/adrs/ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md)).
- **Extension authors**, who add a database, a tool or a library to Prisma 8 through an extension.

Optimise for:

- **Deterministic behaviour.** Declarative artifacts define every execution path, and checks run before data is touched.
- **Explicit behaviour.** No hidden extra round-trips, fallbacks or guesses. One query builder call compiles to one SQL statement ([ADR 003](../../architecture%20docs/adrs/ADR%20003%20-%20One%20Query%20One%20Statement.md)).
- **Feedback before execution.** Lints, budgets and offline checks say what is wrong and how to fix it before anything runs.

It does not need to optimise for:

- **CommonJS or older runtimes.** Packages are ES modules only. The supported version of each runtime and database starts at the latest release the project tests against, and is lowered only when a concrete user need justifies it ([ADR 222](../../architecture%20docs/adrs/ADR%20222%20-%20Version%20support%20policy.md)).
- **Reproducing Prisma 7 query behaviour.** A Prisma 7 schema used as a contract source describes a database. It does not commit Prisma 8 to behaving like Prisma 7 ([GA plan, principle 4](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/decisions.md#principles)).

## What not to assume

- **Do not assume a Prisma 7 feature exists in Prisma 8.** Check the [feature scoreboard](../../../scorecard.md) and the [`prisma-8` skill](../../../skills/prisma-8/).
- **Do not assume a missing feature is unwanted.** Only an accepted ADR rules a feature out.
- **Do not assume the folders under `projects/` are a roadmap.** They describe work in progress.
- **Do not assume the ORM client is the only way to query.** The ORM is an optional layer over the SQL query builder, and there is a raw SQL lane ([ADR 015](../../architecture%20docs/adrs/ADR%20015%20-%20ORM%20as%20Optional%20Extension.md), [ADR 247](../../architecture%20docs/adrs/ADR%20247%20-%20Whole-query%20raw%20SQL%20is%20the%20fragment%20mechanism%20at%20statement%20position.md)). A request is often answered by a surface that already exists.

## Agent guidance

If you are an agent working in this repo:

- Read this file before making product-level decisions.
- Before you judge a feature request or a pull request, or propose a feature, follow [How to use this page](./vision.md#how-to-use-this-page) on the vision page.
- Open the [steering list](../../architecture%20docs/ADR-INDEX.md#steering-list) before you propose a new surface. If an ADR on it covers the request, cite it.
