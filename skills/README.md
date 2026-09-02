# Prisma Next skills

Agent skills for [Prisma Next](https://github.com/prisma/prisma) (Prisma 8) — `SKILL.md` files that teach an LLM agent how to operate Prisma Next end-to-end without re-deriving the API from documentation each time.

> **Edit your data contract. Prisma handles the rest.**
>
> **You get the skills by installing the packages.** The `prisma-orm-*` skills ship inside the `@prisma/orm-postgres`, `@prisma/orm-sqlite` and `@prisma/orm-mongo` tarballs, so the skills in your project always describe the version you installed.

## What's in the box

Two installable skills, split by trigger territory:

| Skill | Scope |
|---|---|
| [`prisma-orm-core-concepts`](./prisma-orm-core-concepts/) | Everything except migrations. The mental model (contract vs schema, emitting, hashes and the marker, plans, the query APIs, façade layering, capabilities, codecs, extensions, middleware, the migration graph, offline-vs-online CLI commands), structured-error diagnosis, and the development workflows: adoption/quickstart, contract authoring, queries (with Postgres/SQLite and Mongo companions), runtime wiring, build integration, Supabase/RLS, feedback routing, and upgrading (both an application and an extension package, with the per-transition instructions under [`prisma-orm-core-concepts/upgrading/`](./prisma-orm-core-concepts/upgrading/)). Fires whenever the agent works with Prisma ORM. |
| [`prisma-orm-migrations`](./prisma-orm-migrations/) | Migration authoring, the migration graph / refs / plan-origin model, and deploy-time migration review. Fires on migration planning, applying, and review. |

Each `SKILL.md` is a router: a description trigger that carves that skill's territory, a routing table, and progressive disclosure into the skill's `references/` files. The skills cross-reference each other by name (they install as a set), and each carries the shared version-freshness preamble.

The task-oriented reference files follow a shared shape: preamble + canonical mental-model headline, *When to Use* / *When Not to Use*, *Key Concepts*, *Workflow*, *Common Pitfalls*, **What Prisma Next doesn't do yet**, and *Checklist*. The two upgrade references are procedures rather than reference material, so they carry their own step-by-step shape instead.

Upgrading is a branch of the core-concepts skill. [`prisma-orm-core-concepts/references/upgrade-app.md`](./prisma-orm-core-concepts/references/upgrade-app.md) and [`prisma-orm-core-concepts/references/upgrade-extension.md`](./prisma-orm-core-concepts/references/upgrade-extension.md) carry the two flows; the per-transition instructions and codemods they replay live under [`prisma-orm-core-concepts/upgrading/app/upgrades/<from>-to-<to>/`](./prisma-orm-core-concepts/upgrading/app/upgrades/) and [`prisma-orm-core-concepts/upgrading/extension/upgrades/<from>-to-<to>/`](./prisma-orm-core-concepts/upgrading/extension/upgrades/). The version you upgrade *to* carries the instructions for the transitions leading to it.

## Install

The skills arrive with the packages, and `prisma skills sync` copies them from the installed package into the agent directories at your project root (`.claude/skills/`, `.cursor/skills/`, `.agents/skills/`, `.windsurf/skills/`). The family-level `prisma init` command sets the skills up for you; `prisma orm init` does not touch them. After adding an agent runtime, or to refresh the copies, run the sync directly:

```bash
pnpm exec prisma skills sync
```

Every `prisma` command also checks the synced copies against the installed packages and prints one line on stderr when they have drifted.

### Manual fallback — install from GitHub

If you want the skills without installing the packages, the `skills` CLI can still read this directory. Pin the ref to your Prisma Next version so the skill surface matches your runtime surface. Install both — they route to each other and are meant to travel together:

```bash
pnpm dlx skills add prisma/prisma/skills#v<your-prisma-8-version> --all
```

This is interoperability, not the recommended path: nothing keeps a copy installed this way up to date.

The skills are always installed at the **project level** — there is no host-wide / global install path. Each skill's surface (commands it references, exit codes it expects, capability claims it makes) tracks the project's `@internal/*` version, and a global install would have to pick a single version for every project on the host. Per-project keeps the skills, CLI, runtime, and extension packs coherent on every project the user works in.

To limit a `skills add` install to one agent runtime, add `-a <agent>` (e.g. `-a claude-code`, `-a cursor`, `-a codex`). The `skills` CLI's `--help` lists the supported agent ids.

## Capability-gap honesty

Prisma Next is in early access. Each reference file carries a *What Prisma Next doesn't do yet* section that names features the framework doesn't implement (model validations, lifecycle callbacks, Studio, runtime-apply migrations, `EXPLAIN`, prepared statements, `db.batch()`, multi-database routing, Next.js plugin, …) along with the workaround and a route to [`prisma-orm-core-concepts/references/feedback.md`](./prisma-orm-core-concepts/references/feedback.md) so the request becomes a tracked issue instead of a one-line URL.

The pattern is deliberate: it gives the agent something concrete to say when a user asks about an unbuilt feature, instead of confabulating a plausible-looking API call against something that doesn't exist.

## Versioning

The skills are versioned with the rest of Prisma Next and ship inside the tarballs, so there is no separate skill-version axis to track ([`docs/oss/versioning.md`](../docs/oss/versioning.md)). Each published copy carries `metadata.library` (the package it shipped in) and `metadata.library_version` (the version it shipped at) in its frontmatter — `metadata` is where the [Agent Skills spec](https://agentskills.io) puts keys beyond `name` and `description`; `prisma skills sync` compares that stamp against the installed package to decide whether your copies are current.

## Contributing / authoring

Authoring rules, reference-file conventions, and the worked example for *concepts-over-procedures* live in [`DEVELOPING.md`](./DEVELOPING.md). Read that before adding or rewriting a reference file. Skill sources live in this `skills/` directory in the `prisma/prisma` monorepo.

## License

Apache-2.0.
