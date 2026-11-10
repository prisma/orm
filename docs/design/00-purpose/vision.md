# Vision

This page says where Prisma 8 is going, in two parts. **Values** do not change. **Durable themes** are the parts of the product the maintainers invest in across many releases. [Project intent](./project-intent.md) says who Prisma 8 is for and what not to assume.

## How to use this page

Use it before you judge a feature request or a pull request, and before you propose a new feature, surface or solution. Read the [project intent](./project-intent.md) and the [steering list](../../architecture%20docs/ADR-INDEX.md#steering-list) first. If an ADR on the list covers the request, cite it.

A verdict on a request cites the value, durable theme or ADR it rests on. Only an `Accepted` ADR that covers the request, or a [maintainer](../../oss/governance.md#maintainer-team)'s own earlier words on an issue or a pull request, grounds a decline. The full reading rules, with the four verdicts and the protections against a wrong decline, are in the [`product-direction` skill](../../../skills-contrib/product-direction/SKILL.md). The [PR triage guide](../../oss/pr-triage.md#step-5--direction-fit) applies them to pull requests.

## Values

- "we will not build in the core features which can be built in extension/user space." (Will Madden, 2026-10-22)
- "The framework fundamentally knows nothing about any database, query language, or schema format" ([Prisma ORM Manifesto, principle 1](https://www.prisma.io/blog/prisma-orm-manifesto-2026#1-prisma-orm-is-an-open-framework-and-an-open-ecosystem))
- "It shows what it will do before it does it, checks its own work afterwards, and asks before it destroys anything." ([principle 2](https://www.prisma.io/blog/prisma-orm-manifesto-2026#2-database-tools-must-be-safe-to-delegate))
- "High-level abstractions must have escape hatches." ([principle 3](https://www.prisma.io/blog/prisma-orm-manifesto-2026#3-developer-experience-must-be-exceptional))
- "Code must be explicit and unambiguous, never magical." ([principle 3](https://www.prisma.io/blog/prisma-orm-manifesto-2026#3-developer-experience-must-be-exceptional))
- "Prisma ORM must run wherever your JavaScript runs, and work with the frameworks and build tools you already use, today and as they change." ([principle 4](https://www.prisma.io/blog/prisma-orm-manifesto-2026#4-prisma-orm-must-fit-the-modern-javascript-landscape))
- "Prisma’s hosted products are built on the same foundation as every other extension, with the same access and no more" ([principle 5](https://www.prisma.io/blog/prisma-orm-manifesto-2026#5-we-are-stewards-not-gatekeepers))

How the system is built is in the [guiding principles](../../Architecture%20Overview.md#guiding-principles) of the Architecture Overview.

## Durable themes

- **Databases, in order.** Will Madden, 2026-10-22: "postgres GA. mongo GA / SQLite GA / mysql GA. then we see. everything else we expect to be built in user/extension space"
- **The data contract.** One contract, written in PSL or TypeScript, says what exists and what is allowed, and every other part works from it.
- **Querying.** The query builder, the ORM client on top of it, and raw SQL all work from the same contract.
- **Migrations.** Each change is planned from one contract to the next, checked before and after it runs, and needs approval when it destroys data.
- **Extensions.** Anyone can add a database, a tool or a library through the same public interface the core team uses.
- **Agents.** Agents are first-class users: the packages ship skills for them, and the tools give output they can act on.
- **The runtime and middleware.** Behaviour around queries, such as logging, caching and tracing, is written as middleware.
- **The CLI, the editor and tools.** The maintainers build and maintain the `prisma` CLI and the VS Code extension.
- **The upgrade path from Prisma 7.** An application moves from Prisma 7 to Prisma 8 one step at a time.
