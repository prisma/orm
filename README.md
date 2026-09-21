<p align="center">
  <a href="https://github.com/prisma/orm">
    <img src="./images/prisma-8.png" alt="Prisma 8" width="680" />
  </a>
</p>

<p align="center">
  <a href="https://www.prisma.io/docs/orm">Docs</a>  |  <a href="https://pris.ly/discord">Discord</a>  |  <a href="https://twitter.com/prisma">X</a>  |  <a href="https://pris.ly/pn-announcement">Blog Post</a>  |  <a href="./ARCHITECTURE.md">Architecture</a>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" /></a>
  <a href="https://www.npmjs.com/package/prisma"><img alt="npm" src="https://img.shields.io/npm/v/prisma?label=prisma" /></a>
  <a href="https://github.com/prisma/orm/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/prisma/orm/actions/workflows/ci.yml/badge.svg" /></a>
</p>

---

> **Using Prisma 7?** It remains fully supported. Its source lives on the [`v7` branch](https://github.com/prisma/orm/tree/v7) of this repository and its docs at [prisma.io/docs/orm/v7](https://www.prisma.io/docs/orm/v7).

> **Prisma 8 is a release candidate.** `8.0.0` final is expected in the next four to eight weeks. Until then a release candidate may include breaking changes, and every release ships with an upgrade recipe that the `prisma-8` skill applies for you. The candidate is a complete implementation we stand behind: we treat bugs in it as urgent, and the risk you take on is a feature that is not built yet rather than churn. The [feature scoreboard](./scorecard.md) names every gap. New projects should start here. Existing Prisma 7 applications can migrate incrementally, and Prisma 7 stays on the [`v7` branch](https://github.com/prisma/orm/tree/v7) with bug fixes and security updates for eighteen months after `8.0.0` final. Star the repo, follow [@prisma on X](https://pris.ly/x), or read along on the [Prisma blog](https://www.prisma.io/blog).

**Prisma 8** is a TypeScript rewrite of Prisma ORM, designed to be **extensible**, **composable**, and **AI-agent friendly** by default. Read the [announcement](https://pris.ly/pn-announcement) or start with the [docs](https://www.prisma.io/docs/orm).

## Prerequisites

- Node.js 24 or newer
- A package manager (`npm`, `pnpm`, or `yarn`)

## Getting started

### 1. Scaffold a new project

The interactive scaffolder picks an app template (Next.js, Hono, Nuxt, Astro, NestJS, SvelteKit, TanStack Start, or Elysia) and wires Prisma 8 in with your chosen database (PostgreSQL or MongoDB):

```bash
npm create prisma
```

You finish with a runnable app, a starter contract, and the agent skills already installed. See the [create-prisma reference](https://www.prisma.io/docs/prisma-orm/create-prisma) for every template and flag, or follow the [PostgreSQL](https://www.prisma.io/docs/prisma-orm/quickstart/postgresql) and [MongoDB](https://www.prisma.io/docs/prisma-orm/quickstart/mongodb) quickstarts.

### 2. Or, add Prisma 8 to an existing project

Run this from your repo root:

```bash
npx prisma orm init
```

`orm init` writes `prisma.config.ts`, scaffolds a starter contract and `db.ts` under `src/prisma/`, installs the runtime, and emits the contract. It does not touch your framework or build setup. Then install the agent skills:

```bash
npx prisma skills sync
```

See the [`orm init`](https://www.prisma.io/docs/cli/orm-init) and [`skills`](https://www.prisma.io/docs/cli/skills) CLI references, or the guides for adding Prisma 8 to an existing [PostgreSQL](https://www.prisma.io/docs/prisma-orm/add-to-existing-project/postgresql) or [MongoDB](https://www.prisma.io/docs/prisma-orm/add-to-existing-project/mongodb) app.

### 3. Use your AI agent for everything Prisma 8

Both installers leave a top-level **`prisma-8.md`** primer at your project root for any agent to read first, and install one **`SKILL.md`** per workflow into the directories agent runtimes read:

- `.claude/skills/<skill-name>/SKILL.md` — Claude Code
- `.cursor/skills/<skill-name>/SKILL.md` — Cursor
- `.agents/skills/<skill-name>/SKILL.md` — universal location for Copilot Agent and other runtimes
- `.devin/skills/<skill-name>/SKILL.md` — Devin

Skills ship inside the Prisma packages your project installs, so they always describe the version in use. Your editor's AI assistant auto-loads the right skill when your prompt matches.

Just describe what you want. For example:

> *"Add a `posts` model with a relation to `users`, then write a query that loads each user's three most recent posts."*

The agent loads the `prisma-8` skill, opens its contract and queries references, then drives the change end-to-end.

For the full catalogue and what each skill covers, see [`skills/README.md`](./skills/README.md).

## Found a bug, missing a feature, or have a question for the team?

Ask your agent. The `prisma-8` skill's feedback flow drafts a structured GitHub issue or hands you a Prisma Discord link for live Q&A. You can review and confirm before anything is submitted.

## For extension authors

Prisma 8 has a minimal core. Everything around it, including Postgres support itself, is built on the same public SPI that's available to any author. If you've wanted to integrate your tool, your database, or your library with Prisma, this is the way in.

Extensions already shipping:

- **[`@prisma/orm-extension-pgvector`](https://www.npmjs.com/package/@prisma/orm-extension-pgvector)**: vector columns and similarity search.
- **[`@prisma/orm-extension-postgis`](https://www.npmjs.com/package/@prisma/orm-extension-postgis)**: geometry columns and geo queries.
- **[`@prisma/orm-extension-paradedb`](https://www.npmjs.com/package/@prisma/orm-extension-paradedb)**: BM25 full-text search indexes (experimental).
- **[`@prisma/orm-extension-supabase`](https://www.npmjs.com/package/@prisma/orm-extension-supabase)**: Supabase auth and storage tables, role-bound clients (experimental).
- **[`@prisma/orm-extension-arktype-json`](https://www.npmjs.com/package/@prisma/orm-extension-arktype-json)**: JSON columns validated by an arktype schema.
- **[`@cipherstash/prisma-next`](https://pris.ly/cipherstash-p-blog)**: searchable encryption and data-level access control.

See [Using extensions](https://www.prisma.io/docs/orm/extensions/using-extensions) for how to install and register one. Want to ship your own? The **[call for extension authors](https://pris.ly/pn-extension-authors)** walks through the SPI, the layers your extension can hook into, and how the team features new extensions.

## Supported databases

- **PostgreSQL** — the primary target, first-class support
- **MongoDB** — first-class support
- **SQLite** — planned next, a proof of concept today

MySQL follows after SQLite. See the [feature scoreboard](./scorecard.md) for what each database supports today.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, commands, DCO signoff, and PR expectations. For substantive changes, please open an issue first so we can give direction-fit feedback before you invest implementation time.

Security issues: follow the Private Vulnerability Reporting flow in [SECURITY.md](./SECURITY.md). Please do not file them as public issues.

## Community

Built something with Prisma 8? Tag [@prisma](https://pris.ly/x) on X. The best community builds get a shout-out and a link here.

- **Discord**: Talk to us in [Discord](https://pris.ly/discord)
- **X**: [@prisma](https://pris.ly/x)
- **Blog**: [prisma.io/blog](https://www.prisma.io/blog)

## License

Apache 2.0. See [LICENSE](./LICENSE).
