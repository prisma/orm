## Status and purpose

This document defines the target experience for the Prisma 8 CLI. It describes where we are going, not what every repository supports today. It supersedes the v1 spec after review against the shipped surfaces of prisma-cli, composer, and prisma-next (see `spec-review.md`).

The direction is decided:

- **prisma-cli** becomes the consolidated CLI repository.
- Prisma Next becomes Prisma 8's data and ORM foundation.
- Composer becomes Project orchestration: the layer that runs the whole system from the config, behind `prisma project ...`.
- The classic Prisma implementation is not carried over, and there is no compatibility layer for it (Layer 6).
- Users get one **prisma** command and, when they use orchestration, one **prisma.config.ts**.

The primary experience is local development to Prisma Cloud. Local-only work, external clouds, and direct resource management without Composer all stay supported. When a trade-off is unavoidable, we optimize for the local-to-Prisma-Cloud path.

**Open naming decision.** This spec uses Prisma Next's word **contract** for the versioned data model. Whether the user-facing word should become **schema** is still open with the team. Nothing else in this document depends on that outcome.

---

# Layer 1 — Mental model, nouns, and invariants

## How we operate

- **Opinionated defaults, explicit off-ramps.** The happy path is strongly opinionated. Every opinion has a visible, supported way out.
- **Local first, Prisma Cloud preferred.** Local development needs no account. Prisma Cloud is the most integrated remote experience.
- **Adoption is progressive.** The ORM, migrations, a database, Compute, and full orchestration can each be adopted on their own.
- **Everyday commands use product nouns:** Project, App, Database, Branch, Contract. Internals like ledgers, markers, and hashes stay inside advanced and recovery workflows.
- **Resolve first, then act.** The CLI works out the exact target before it changes anything, and asks for more explicit intent as the consequences grow.
- **Agents are first-class users.** Humans, agents, and CI get the same commands with the same behavior.

## Core mental model

A Project is the complete system the user is building.

```
Project
├── Apps
├── Databases
├── Buckets
├── Contract (models)
└── Bindings between resources
```

The Project can run locally or on a Branch.

```
Project definition
├── Local realization
└── Branches
    ├── production (role)
    ├── staging
    └── feat-auth
```

A Branch is a named remote copy of the Project. One Branch can span providers:

```
Branch: feat-auth
├── Prisma Cloud resources
│   ├── Compute Apps
│   └── Prisma Postgres
└── External provider resources
    ├── Vercel App
    └── Neon Database
```

On Prisma Cloud, the Branch maps to a physical Branch in a Prisma Cloud Project. For external providers, adapters map the same Branch to that provider's own concept (a Vercel preview target, a Neon branch). The provider keeps ownership. Contract-only and local-only users never need to think about Branches.

## Nouns

| Noun | Meaning |
| --- | --- |
| Workspace | The account, team, and billing boundary. Owns login and Project discovery. |
| Project | The whole system described by one **prisma.config.ts**. Can hold several Apps and Databases. A monorepo is one Project, not many. |
| Prisma Cloud Project | The remote container on Prisma Cloud linked to the Project. |
| Branch | A named remote copy of the Project. Has a role (`production` or `preview`) and a durability class (`durable` or `disposable`). Every Cloud Project has a default `main` Branch. |
| Local | The developer's machine. One local copy per working directory. Never a Branch, never a deploy target. |
| App | One deployable application or service. |
| Deployment | One build-and-release of an App on a Branch. Immutable. |
| Database | A logical database used by one or more Apps. |
| Bucket | Object storage with its own access keys. |
| Contract | The versioned description of the application's data, written in PSL or TypeScript. The ORM, migrations, and typed clients derive from it. |
| Binding | A declared connection between resources, resolved to real values at run and deploy time. |
| Env maps | Project-level environment variables in two sets, `production` and `preview`, with per-Branch overrides used sparingly. |

**Production is a role, not a name.** A Branch is production because its role says so, never because it is called `main`, and never guessed from a Git branch name.

## One Project configuration

**prisma.config.ts** is the single entry point for a Project. It can import definitions from other files (`apps/web.ts`, `data/main.ts`). One config means one place where the system comes together, not one giant file.

The config holds what the user wants to exist: the Apps and resources, how they connect, what they need from providers, and how local differs from remote. It never holds current cloud state: no resource IDs, no deployment status, no receipts, no credentials.

```
Config says what should exist.
Providers record what currently exists.
```

Two rules that already hold in the source systems and must keep holding:

- **Evaluating the config does nothing.** It creates no resources and makes no network calls. It only describes the system.
- **App code never imports the config.** The config imports app definitions, not the other way around.

The config is written through a versioned `defineConfig` from the Prisma 8 SDK. The version marker tells the CLI it is a Prisma 8 config and not an older file with the same name. Each of today's entry points (`prisma-next.config.ts`, `prisma.compute.ts`, `prisma-composer.config.ts` plus entry module, classic `prisma.config.ts`) has a named migration in Layer 6.

The config is optional. Direct resource commands work without it.

## Invariants

Fourteen rules that every command, every surface, and every future spec must respect. Where a rule has a deliberate exception, the exception is written into the rule.

1. **A command's name tells you what it touches.** `project deploy` acts on the whole Project. `app deploy` ships one App. `db migrate` changes one database. A command never quietly does more than its name says — no matter what is in the config.
2. **Local development needs no account and no login.** No auth, no Workspace, no Cloud Project, no Branch. Everything local works before the user has ever signed in.
3. **ORM and migration users are never pushed into the cloud.** The contract, the client, and migrations work against any database without ever needing a Prisma Cloud Project.
4. **One config file, and reading it changes nothing.** `prisma.config.ts` is the only Project configuration. Evaluating it never creates a resource and never touches the network — it only describes the system.
5. **The resource commands are always available.** Orchestration is the high-level surface; the direct resource commands — `app deploy`, `postgres create`, logs, and the rest — are the low-level surface it never replaces. Every resource orchestration manages stays inspectable and operable directly, for example when debugging. How orchestration does its own work internally is not constrained. The config stays the source of intent, so what it declares is what the next `project deploy` converges the system toward.
6. **Create what's missing, and say so.** If a deploy needs a Project, App, or Branch that doesn't exist yet, the CLI creates it and carries on — it never stops the user to do plumbing first. The rule is transparency, not restraint: the output always states plainly what was created on the user's behalf, and every command shows which Project, Branch, and App it acted on.
7. **Local is local.** Local development runs emulators on the user's machine and has no effect on the cloud platform. Local is never a Branch and never a deploy target. Wiring a local app to a remote resource is possible, but only ever explicit.
8. **Production is always on purpose.** Deploys land in preview by default. Reaching production takes an explicit signal — a confirmation at the prompt, or `-prod` in automation — and a generic `-yes` is never that signal. One deliberate exception: the very first deploy of a brand-new production Branch goes live automatically, because there is no traffic to protect yet — and the output says so loudly.
9. **Deleting real data is always visible and always confirmed.** Keeping reality in sync with the config is the deploy's job: remove a resource from the config and the next deploy removes the real thing. It just never does it quietly — the plan lists every deletion as destructive and the user confirms it explicitly. Direct destructive commands confirm the exact resource (`-confirm <id>`); `-yes` alone never deletes anything. Resources that are only referenced — managed somewhere else — are never deleted by Prisma.
10. **Orchestrating a resource is not owning it.** Composer can create and manage resources on other platforms — a Neon database, a Vercel app — but those platforms still own them. The flip side: resources Prisma offers on partner infrastructure, like buckets on Tigris, are Prisma-owned — ownership is about who manages the resource, not whose hardware it runs on.
11. **Deploys are honest about partial failure.** A Project deploy is an ordered sequence, not an all-or-nothing transaction: if step four fails, steps one to three have already happened. The CLI never pretends otherwise — the result says exactly what succeeded and what didn't, and running the deploy again continues from recorded state instead of creating duplicates.
12. **Humans, agents, and CI use the same CLI.** Same commands, same behavior. `-json` changes the shape of the answer, never the answer. When context is missing and nobody is there to ask, the CLI returns a structured error — it never guesses.
13. **Every surface lands on the same target.** CLI, Console, GitHub, and agents all resolve to the same Project, Branch, and App — the same repo never turns into two Projects because it was touched from two places. Resources are tracked by stable IDs, not display names or folder paths: renaming or moving code never creates a new resource, and when a target is ambiguous the CLI stops instead of picking one.
14. **One command language.** Prisma 8 ships one way to do each thing. There are no compatibility aliases for the classic CLI: classic projects keep working by pinning the CLI they already have, and Prisma 8 offers detection and a migration path — nothing more (Layer 6).

## Non-goals

We do not promise identical features across providers, all-or-nothing deployment across providers, that Prisma Cloud manages external resources, an embedded copy of classic Prisma, or that every command in this document ships in the first release.

---

# Layer 2 — Root commands

## Grammar

```
prisma <group> <action>
prisma <group> <subresource> <action>     # resources with their own lifecycle
```

Examples: `prisma project deploy`, `prisma postgres backup restore`, `prisma app deployment logs`.

## Root commands

| Root | What it does | Why it is a root |
| --- | --- | --- |
| **init** | Set up Prisma in a repository, or migrate an existing setup. | The entry point into everything. |
| **project** | The Project as a whole: check, dev, plan, deploy, plus Project records and env maps. | The unit that ties Apps, Databases, migrations, and bindings together. |
| **branch** | Named remote copies of the Project. | Shared context across resource types. (Manual create and delete ship after workflow-created Branches prove the need.) |
| **app** | Build, run, deploy, and operate one App. | Works on its own, without orchestration. |
| **db** | Act on the live database the config declares: migrate, reconcile, verify, inspect, query. | Account-free; works against any database. |
| **postgres** | Hosted Prisma Postgres instances: lifecycle, usage, credentials, backups. | A platform resource with its own lifecycle, managed by ID. |
| **bucket** | Object storage and its keys. | Its own lifecycle. |
| **contract** | Author, check, infer, and emit the data model. | Local and account-free. |
| **migration** | Recorded database change on disk: plan, scaffold, check, inspect history, manage refs. | Its own safety and recovery story; never touches a live database. |
| **auth** | Identity and workspace access. | Shared by everything remote. |
| **git** | Connect a repository. | Affects Projects and Branches, not one resource. |
| **agent** | Install and inspect Prisma skills for coding agents. | Cross-cutting. |
| Utilities | **version**, **feedback**, **help**, **mcp**, **telemetry**. | Support the CLI itself. `mcp` serves the same commands over MCP. |

**`db`, not `database`.** The short form wins: it is what people have typed for years and it matches Prisma Next's style guide. It is the only abbreviated root. The hosted-instance group is `postgres`, not `database` — a second near-identical name next to `db` would be worse than the sanctioned product-name exception (see below).

## Who owns what in the data lifecycle

Four roots share the data lifecycle. The rule:

- **contract** owns the model: the files you author and the artifacts they produce.
- **migration** owns recorded change on disk: planning, scaffolding, checking, and inspecting migration history and refs. It never touches a live database.
- **db** owns the live database, reached through the configured connection: applying migrations (`db migrate`) and unrecorded state (`update`, `init`, `verify`, `sign`, `schema`).
- **postgres** owns the hosted instance as a platform resource: lifecycle, usage, credentials, backups.

If it touches migration files on disk, it is `migration`. If it touches the live database or its data, it is `db`. If it only touches model files and their artifacts, it is `contract`. If it manages the hosted instance by ID, it is `postgres`.

## Two behavioral worlds

Every group belongs to exactly one of two worlds:

- **Admin groups** (`postgres`, `app`, `bucket`, `branch`, `auth`, the remote side of `project`) wrap management API operations. They need auth, resolve Workspace, Project, and Branch, and refer to platform entities by ID.
- **Local groups** (`contract`, `migration`, `db`) are account-free. They never resolve platform context; `db` learns how to reach the database from the config, not from an ID.

The worlds never share a group. A user who has learned that admin commands affect only the resource they name by ID must never find, in the same group, a command that instead acts on whatever database the config points at.

## When a concept gets a root

A concept earns a root when it is the whole Project, shared context across resources, a resource that works on its own, an account-free workflow, or a cross-cutting integration. Everything else nests: `app deployment`, `postgres connection`, `postgres backup`, `bucket key`, `auth workspace`, `project env`.

## No product or provider names

There is no `prisma composer`, `prisma compute`, `prisma cloud`, `prisma neon`, or `prisma vercel`. Provider names show up in config, target selection, plans, status, and errors. They never shape the command tree.

One decided exception: **`postgres`**. The natural noun for the hosted-database group is taken — `db` is the local group, and a `database` root beside it would put two near-identical names in one tree. The product name is safe here because admin commands only ever manage Prisma-hosted instances: an external database is referenced or orchestrated, never administered, so `postgres` cannot be misread as "any postgres". This exception does not extend to other products.

## Direct commands and orchestration

```
Direct commands                      Orchestration
├── prisma app deploy                └── prisma project deploy
└── prisma postgres create               ├── Databases
                                         ├── Migrations
                                         ├── Bindings
                                         └── Apps
```

`app deploy` ships one App. `postgres create` creates one Database. `project deploy` brings the whole configured Project up to date.

**Ruling of 2026-09-30 (Will Madden):** the shipped bare commands `prisma deploy` and `prisma dev` stay as they are. They are special cases of the noun-verb grammar, not violations to be renamed. Wherever this document writes `project deploy` or `project dev` for the Composer workflow, read the shipped bare command.

Direct commands work without a config, but remote commands always need a resolved Cloud Project and Branch (Layer 3).

---

# Layer 3 — Finding the target

## Resolution model

```
Command scope → Project → Local or Branch → Provider → Resource → Plan
```

The command sets the scope (invariant 1). Everything below it resolves before anything changes.

## Where context comes from

```
prisma.config.ts            What the user wants to exist
Local Project link          Which remote Project this directory belongs to
Credentials / CI env        Who is acting
Operation state             What exists right now, recorded by the platform
```

The local Project link is a small gitignored file holding the Workspace and Project IDs. It is a cache checked against the platform on every call, not a source of truth. It matters most for direct commands: Composer deploys can also find their destination through the state the platform already stores for the Project. Relinking is explicit (`project link` / `unlink`).

## Finding the Project

In order:

1. Explicit input (`-project`).
2. Identity from the environment (CI, service tokens).
3. The local Project link.
4. What the platform already knows about this repository (Git mapping, Composer state).
5. Nothing found: the CLI creates the Project and says so (invariant 6). This applies in automation too.

If several Projects match, the CLI asks. When nobody is there to answer, it returns a structured error instead of guessing (invariants 12 and 13). It never picks by age or display name, and never switches workspaces silently.

Apps and preview Branches follow the same pattern: created when a deploy first targets them, always announced.

## Finding the Branch, and the production gate

In order: explicit `--branch`, then the current Git branch (or the CI ref), then a prompt, then a structured error.

Resolution is predictable and can land on any Branch, including production. Safety lives in the gate, not in resolution: before changing a production-role Branch, the CLI asks for confirmation, or requires `--prod` in automation (invariant 8). This gives automation one stable error to handle.

Branch is the portable name across providers; adapters map it to each provider's own concept. A Branch can exist without a Prisma Cloud Project when everything on it is external. That needs the external state backend (see Deferred). Local is never a Branch.

## Three ways a resource can participate

| Path | Meaning |
| --- | --- |
| Orchestrated | Declared in the config. `project deploy` keeps it in line. |
| Direct | Created and managed through resource commands. |
| Referenced | Declared in the config but managed elsewhere. Shown in plans, never changed by Prisma. |

Moving between paths is explicit. `project adopt` takes a direct resource into the config so orchestration manages it. `project detach` takes a resource out of orchestration while keeping it alive; this is the alternative to removing it from the config, which deletes it on the next deploy (invariant 9). The direct commands keep working on orchestrated resources (invariant 5).

## Local

`project dev` runs everything locally by default: local databases, services, and emulators. One local copy per working directory. Wiring a local app to a remote resource is possible, but always explicit and always shown before start.

## Prompts and automation

Interactive mode may ask the user to fill in missing context. Automation gets the same condition back as a structured error (invariant 12).

---

# Layer 4 — Command surface

Directional, not a launch checklist.

```
prisma
├── init
│
├── project
│   ├── check | dev | plan | deploy | status
│   ├── create | list | show | rename | transfer | delete
│   ├── link | unlink
│   ├── adopt | detach
│   └── env
│       ├── add | update | list | delete | pull
│
├── branch
│   ├── create | list | show | delete
│
├── app
│   ├── build | run | deploy
│   ├── list | show | delete
│   ├── logs | open
│   ├── promote | rollback
│   ├── deployment
│   │   ├── list | show | logs
│   └── domain
│       ├── add | list | show | delete
│
├── db
│   ├── migrate
│   ├── update | init | verify | sign | schema
│   ├── query | browse | seed
│
├── postgres
│   ├── create | list | show | delete
│   ├── usage
│   ├── connection
│   │   ├── create | list | rotate | delete
│   └── backup
│       ├── create | list | restore | delete
│
├── bucket
│   ├── create | list | show | delete
│   └── key
│       ├── create | list | delete
│
├── contract
│   ├── emit | infer | format | validate
│
├── migration
│   ├── plan | new | check
│   ├── status | list | show | log
│   └── ref
│       ├── set | list | delete
│
├── auth
│   ├── login | logout | whoami
│   └── workspace
│       ├── list | use | logout
│
├── git
│   ├── connect | status | disconnect
│
├── agent
│   ├── install | update | status
│
├── version | feedback | help | mcp | telemetry
```

Notes on deliberate shapes:

- **`app promote <deployment>` and `app rollback` sit flat.** They are App-level traffic actions that take a Deployment. `app deployment` keeps inspection: `list`, `show`, `logs`. Deployment logs also cover builds triggered by Git push, since those produce Deployments.
- **`project env`** manages the two env maps (`-role production|preview`) and per-Branch overrides (`-branch <name>`). `add` fails if the variable exists; `update` fails if it does not. Production values can be written but never read back; inspection shows metadata only. `pull` fetches preview values, explicitly, for local development. No output path ever prints a production value.
- **`project delete`** removes the remote Cloud Project and everything in it. It shows the full destructive plan and requires `-confirm <project-id>`. **`branch delete`** tears down one Branch: it shows what will be destroyed, asks for confirmation matching the Branch's role and durability, and never touches referenced resources. Cloud commands never delete local project files. Local dev state resets with `project dev --fresh`.
- **`project adopt`** brings an existing direct resource into the config. **`project detach`** removes one from orchestration without deleting it.
- **`db update`** brings a database's structure in line with the contract without recording a migration: the prototyping loop. **`db init`** adopts an existing database as a signed starting point. **`db verify`** and **`db sign`** check and record where a database stands against the contract; together they replace classic failed-migration repair. **`db schema`** prints the live structure, read-only. `update` and `init` keep Prisma Next's names: with hosted-instance administration in its own `postgres` group, there is no settings-update or repo-init collision to design around, and the group acts on one implicit resource — the configured database.
- **`contract emit`** produces the versioned contract artifacts (IR plus types). It keeps Prisma Next's verb on purpose: "generate" suggests classic codegen, which Prisma Next left behind. **`contract infer`** derives a contract from an existing database.

## Nested nouns

A child with its own identity gets a noun: `app deployment list`, `postgres connection create`, `postgres backup restore`. Never `list-deploys`, `create-connection`, or `restore-backup`.

## Core verbs

| Verb | Meaning |
| --- | --- |
| list / show | A collection / one resource. |
| status | Current operational state. |
| check | Validate without changing anything. |
| plan | Work out changes without applying them. May write a reviewable file locally. |
| create / update / delete | Create a resource, change its settings, delete it. Deletion is guarded (invariant 9). |
| link / unlink | Change an association without deleting anything. |
| connect / disconnect | Change an external integration. |
| use | Change local context only. |
| adopt / detach | Move a resource into or out of orchestration. |
| build / run | Produce an artifact / run locally. |
| dev | Run the local copy of the Project, continuously. |
| deploy | Make an App or Project revision live. |
| migrate | Move the configured database through recorded migrations. |
| update (in `db`) | Match the configured database's structure to the contract without recording a migration. |
| init / verify / sign (in `db`) | Adopt, check, or record where a database stands against the contract. |
| emit / infer | Produce the contract artifacts / derive a contract from a live database. |
| promote / rollback | Move App traffic to a healthy Deployment / back to an earlier one. |
| new | Scaffold a hand-written artifact (data migration). |
| pull | Fetch values for explicit local use (preview env values only). |
| rotate | Replace a credential. |

Operational conveniences (`logs`, `open`, `query`, `browse`, `seed`, `usage`, `format`, `validate`) follow common CLI habits. Avoid **remove**: it never says whether it means delete, unlink, or detach.

## Migration commands follow the graph

Prisma 8 uses Prisma Next's migration model. Migrations form a graph: contracts are the points, migrations are the steps between them, and named refs point at them. Each extension keeps its own migration space, applied in a fixed order. The database carries a signed marker saying which contract it is on. Movement is forward-only.

- `migration plan` works out the change from the current contract and writes a reviewable migration package. It runs offline; no database is needed.
- `migration check` validates packages and the graph, and classifies risk: additive, widening, destructive, data.
- `db migrate [--to <ref>]` walks the graph to the target contract (default: latest). Moving to an earlier contract is how you roll back. There is no reset against remote targets, and no down-migrations.
- `migration new` scaffolds a hand-written data migration. `migration ref` manages the named pointers. Refs stay inside the migration group.
- The same workflow serves local, preview, and production. There are no separate dev and deploy modes; safety comes from targeting, planning, risk classes, and the production gate.

Hashes, markers, and spaces show up in `migration` and `db migrate` output where useful, and nowhere else.

---

# Layer 5 — How operations behave

## Every change follows the same shape

```
Resolve → Validate → Plan → Confirm → Apply → Verify → Receipt
```

Authorized automation may skip the confirmation. Nothing skips resolution, validation, or safety checks.

## project deploy

`project deploy` brings one Branch up to date with the config. Running `project plan` first is optional; deploy plans internally. A reviewed plan can be handed to deploy, and a stale one is rejected.

The order: resolve the Branch and providers, create or update resources, apply migrations that pass their risk checks, resolve secrets and bindings, build and deploy Apps, verify health, move traffic.

**Building.** `project deploy` builds Apps with their build profiles by default. Bringing your own build stays first-class: an App can point at a prebuilt artifact, and CI can hand one in. That is the Composer workflow of typecheck, build, deploy.

Only what changed gets touched. An unchanged App is not rebuilt or redeployed. Re-running a deploy is safe; it continues from recorded state (invariant 11).

**Deletions.** When a resource was removed from the config, the plan shows its deletion as destructive. The deploy removes it only after the user confirms, or after automation passes an explicit destructive-changes flag. This keeps reality in line with the config without quiet deletions (invariant 9).

There is no `--only <app>` mode. Working on one resource is what direct commands are for.

## app deploy

`app deploy` ships one App: from an artifact (`app build` or the user's own build) or from source through its build profile. It needs no config, runs no migrations, and never turns into a Project deploy (invariant 1). In a config with several Apps, a bare `app deploy` is ambiguous; deploying the whole system is `project deploy`.

**Named off-ramp:** `app deploy --db` creates one Branch-scoped database and binds it (`DATABASE_URL` and `DIRECT_URL` as Branch env vars) in the same run. The flag makes the intent explicit. It is the one-command path from nothing to a live URL with a database. It still runs no migrations and never overwrites an existing binding.

## Migrations during project deploy

Pending recorded migrations are part of the plan. Deploy applies the ones whose risk class passes. Destructive or data-loss migrations stop the deploy until the user deals with them directly. No generic confirmation flag gets past that (invariant 9). `app deploy` never runs migrations.

## Promote and rollback

Promote moves App traffic to a healthy existing Deployment. Rollback moves it back to an earlier one. Neither touches the database, the infrastructure, or other providers. Shipping a full production Project is an explicit production `project deploy`.

## When things fail

Every change returns a receipt: the resolved Project and Branch, resource IDs, what finished, what failed, whether a retry is safe, and the recommended next step. Re-running continues; it does not duplicate.

There is no generic undo. Recovery uses the matching tool: retry the deploy, `app rollback`, `postgres backup restore`, apply a corrected migration, redeploy an earlier revision, or explicit cleanup.

Operation state lives on the platform, next to the Branch it describes, never in `prisma.config.ts`. Prisma Cloud is its default home. Projects with no Prisma resources need a compatible state backend, which does not exist yet; it is the biggest unbuilt piece behind Journey 6. Storing state never makes Prisma the owner of anyone's resources (invariant 10).

## Production

Three different things, kept separate: confirmation acknowledges a known plan, authentication says who you are, and explicit Branch selection plus the gate says "yes, production". No confirmation flag ever picks a workspace, Project, Branch, or production target (invariants 8 and 12).

---

# Layer 6 — One contract for humans, agents, and migration

## One engine, two presentations

Humans and machines run the same commands; `--json` changes the format only (invariant 12). The unified CLI keeps the platform CLI's shipped conventions as they are:

- stdout carries data; stderr carries human-facing status. One-time secrets print alone on stdout, so `-quiet` leaves the pure value.
- Results use one envelope: `{ ok, command, result, warnings, nextSteps, nextActions }`. Errors carry stable codes with domain, summary, why, fix, and a docs link. Streaming commands emit one JSON event per line.
- `nextActions` are typed recovery steps (`run-command`, `user-choice`, `edit-file`). Agents branch on codes and actions, never on prose.
- Exit codes: `0` success, `1` failure, `2` usage error, `130` cancelled.
- Destructive commands require `-confirm <id>`; `-yes` is never enough (invariant 9).
- Production env values are write-only and show as metadata. Preview values come back only through an explicit `pull`. No output path prints a production value.

The CLI describes its own commands and provider capabilities in machine-readable form, so agents do not scrape help text. `agent install` ships the skills that already onboard agents across Next, Composer, and the platform CLI. `prisma mcp` serves the same engine over MCP; the shell stays the main agent surface.

## Identity and versioning

Renaming a resource is an explicit identity change, never delete-and-create (invariant 13). On unclear ownership or unexpected drift, the CLI stops before changing anything. Four contracts are versioned separately: the config, the provider protocol, the structured output, and the operation state. Unsupported versions fail before anything changes, and state upgrades are explicit and recoverable.

## Prisma 8 and classic Prisma

Prisma 8 is Prisma Next's product surface. It does not embed the classic implementation and has no compatibility layer: no aliases, no recognition of classic verbs. Classic projects keep working by pinning the CLI they already use. `prisma init` detects a classic setup (a `schema.prisma` with datasource and generator blocks, a `prisma/migrations` folder, a legacy `prisma.config.ts`) and offers a migration path. Nothing is ever silently reinterpreted.

## Migration from the consolidating surfaces

The flow is read-only first, for all three surfaces: detect the existing setup, generate a proposed Prisma 8 config, show the exact mapping and anything unresolved, write it alongside or show a diff, validate locally, link remote targets explicitly, deploy only after a reviewed plan. Config migration never deploys and never migrates data.

**The rename rule.** A source command changes only when one of four things forces it: the command grammar, a verb rule, an invariant, or a collision created by consolidation. Familiarity with classic Prisma is never a justification in either direction (invariant 14). Commands that survive unchanged say so.

**Prisma Next → unified CLI**

| Prisma Next | Unified | Why |
| --- | --- | --- |
| `contract emit` | `contract emit` | Unchanged. |
| `contract infer` | `contract infer` | Unchanged. |
| `format` (top-level) | `contract format` | Grammar: a bare top-level verb fails the root-presence test; actions live under their noun group. |
| `migration plan` / `new` / `check` | `migration plan` / `new` / `check` | Unchanged: recorded change on disk keeps its group. |
| `migration status` / `list` / `show` / `log` / `graph` | `migration status` / `list` / `show` / `log` | Unchanged, except graph rendering becomes a presentation mode of `list`/`show`. |
| `migrate [--to]` (bare verb applies) | `db migrate [--to]` | Grammar: every root is a noun, and every mutation of the live configured database lives under `db`. The verb stays bare — applying is what `migrate` means. |
| `ref set` / `list` / `delete` (top-level) | `migration ref set` / `list` / `delete` | Root-presence: refs are migration-scoped context — top-level in the Prisma Next domain, nested in the broader Prisma domain. |
| `db init` | `db init` | Unchanged: with hosted-instance admin in its own `postgres` group, the collision that would have motivated a rename does not exist. |
| `db update` | `db update` | Unchanged: same reason — `update`-as-resource-settings lives in the admin world, not in `db`. |
| `db verify` / `sign` / `schema` | `db verify` / `sign` / `schema` | Unchanged. |
| `init` | `init` | Unchanged; scope grows to the whole Project definition. |
| `telemetry` | `telemetry` | Unchanged (utility). |
| `prisma-next.config.ts` | `prisma.config.ts` | The consolidation itself: one Project configuration entry point (invariant 4). |

**Composer → unified model (concepts)**

| Composer | Unified |
| --- | --- |
| Outermost module (the app) | Project |
| Service | App |
| Managed resource (`postgres(...)`) | Database |
| Dependency / binding | Binding |
| Stage | Branch |
| Extension | Provider capability |
| Composer state | Project operation state |
| `prisma-composer.config.ts` + entry module | `prisma.config.ts` (composition root; control-plane boundary preserved) |

**Composer → unified CLI (commands)**

| Composer | Unified | Why |
| --- | --- | --- |
| `deploy <entry>` (bare = production) | `deploy <entry>`, unchanged | Ruling of 2026-09-30: `deploy` stays a bare command as a special case of the grammar. Whether the production gate of invariant 8 applies to it is not decided here. |
| `deploy <entry> --stage X` | `deploy <entry> --stage X`, unchanged | Same ruling. A later rename of `--stage` to `--branch` is open; Composer's own ADR already defines a stage as a Branch. |
| `destroy <entry> --stage X` / `--production` | `branch delete X` (plan + guarded confirm) | Verb rule: one stable destructive verb (`delete`). Composer's explicit-target discipline survives — teardown never guesses, and the exact-id confirm guard applies (invariant 9). |
| `dev <entry>` | `dev <entry>`, unchanged | Ruling of 2026-09-30: `dev` stays a bare command as a special case of the grammar. Same stage-less, credential-free behavior. |
| `log <entry> [address]` | `app logs` / `project dev` output | Unified verb is `logs`, scoped per App instead of dotted addresses. |
| `<entry>` positional argument | discovered via `prisma.config.ts` | One composition root replaces per-command entry paths (invariant 4). |

**Current platform CLI (beta) → unified CLI**

| Today | Unified | Why |
| --- | --- | --- |
| `app list-deploys` / `show-deploy` | `app deployment list` / `show` | Nested-noun rule: Deployment has its own identity and lifecycle; compound verbs would be the lone exception to the subresource grammar. |
| `app remove`, `project remove`, `database remove`, `app domain remove`, `db connection remove` | `… delete` | Verb rule: `remove` never says whether it means delete, unlink, or detach; `delete` is the one destructive verb. |
| `project env rm` | `project env delete` | Same verb rule. |
| `database …` | `postgres …` | Two-worlds rule: admin commands wrap the management API and identify instances by ID; they cannot share a group with the config-addressed local commands in `db`. `postgres` is the decided product-name exception (Layer 2). |
| `database restore` | `postgres backup restore` | Nested-noun rule: restore acts on a backup, which owns its own lifecycle. |
| `build logs` (root group) | `app deployment logs` | Root-presence: a build is a phase of a Deployment, not an independent resource. |
| bare multi-app `app deploy` (deploys every configured app) | `project deploy` | Invariant 1: scope from the noun — `app deploy` ships one App; deploying the declared system is the Project operation. |
| `app promote <deployment>` / `app rollback` | `app promote` / `app rollback` | Unchanged. |
| `bucket key delete` | `bucket key delete` | Unchanged. |
| `prisma.compute.ts` | compute settings inside `prisma.config.ts` | Invariant 4; the compute config was already designed to fold in as a sub-key. |
| `init` (writes `prisma.compute.ts`) | `init` (writes `prisma.config.ts`) | Follows the config consolidation. |

`app domain retry` and `wait` are conveniences left to later sequencing; leaving them out of the tree is not a removal decision.

## Compatibility rule

Temporary migration tooling is fine. A second permanent command language is not (invariant 14).

---

# Layer 7 — Journeys

| Priority | Journey |
| --- | --- |
| Primary | Local development → Prisma Cloud |
| Required | Local-only; external database; direct resources; monorepo; CI and agents |
| Supported | Prisma Cloud plus referenced external resources |
| End-state | Orchestrated deployment to external providers |

Provider adapters ship over time. That changes what is available, not the model.

**J1 — Local-only.** `init`, then `project dev`, then contract and migration work (`contract validate`, `migration plan`, `db migrate`). No login, no Cloud Project, no Branch. Local state stays until reset (`project dev --fresh`). The config can describe just a database and a contract; Apps and deployment are not required.

**J2 — External database.** `init`, `contract infer`, `migration plan`, `db migrate`, against an explicitly targeted external database. No account needed. Prisma changes what it is asked to change and owns nothing (invariant 10).

**J3 — Direct resources.** `app deploy ./app.tar.gz --project <p> --branch <b>` ships one artifact. `postgres create` returns one database and its connection. No config, no Composer, no migrations. `app deploy --db` is the one-command path to a live URL with a database. A direct resource can join a Project later with `project adopt`.

**J4 — Local to Prisma Cloud (the happy path).**

```
prisma init
prisma project dev
prisma auth login
prisma project deploy --branch feat-auth       # first run creates the Cloud Project and says so
prisma project deploy --branch <production>    # production gate engages
```

`project plan` is available at any point for a preview. The plan shows the workspace, the Project and Branch, what gets created or updated, pending migrations, bindings, ownership, and anything destructive. Deploy creates, migrates safely, ships, checks health, and returns URLs plus a receipt. This path gets the best defaults, the fewest provider decisions, and the clearest production workflow.

**J5 — Referenced external dependency.** The external database is declared as referenced. Its credentials resolve through the Branch; plans label it; Prisma never creates, migrates, or deletes it unless asked directly; `branch delete` leaves it alone. The same model covers external APIs, queues, and storage.

**J6 — External providers (end state).** The same `project dev`, `plan`, `deploy` flow through provider packs. Plans group effects by provider. Providers keep ownership. Partial failure is reported honestly. Needs the external state backend. Prisma Cloud may stay deeper.

**J7 — Mixed providers.** One Branch holds Prisma Postgres, a Prisma Compute API, a Vercel app, and an external queue. One ordered plan, no all-or-nothing promise. The plan says who manages what and what was created, adopted, or referenced. A failure in one provider is never shown as success.

**J8 — Monorepo.** One config composes several packages. Every App and Database has a stable key. Nested directories find the Project root. `project dev` starts the topology; `app run` starts one App and what it depends on. Bindings use names, not pasted URLs. Moving a package does not recreate its cloud resource (invariant 13).

**J9 — CI and agents.** Checkout, `project check`, `project plan --json`, review gate, `project deploy`, structured receipt. No prompts, no guessing, explicit production, safe retries, redacted secrets (invariants 8, 11, 12).

---

# Deliberately deferred

Decidable later without changing this design:

- the exact TypeScript API of `prisma.config.ts`;
- the provider protocol and the order adapters ship in;
- **the state backend for Projects with no Prisma resources** (the biggest unbuilt piece, Journey 6);
- exact output and streaming schemas;
- storage of plans and receipts, and the detail of migration risk approval;
- which subcommands ship in the first release.

Open naming decision, not deferred: **schema vs contract** as the user-facing word, to be settled with the team. This spec says contract. A change would touch the `contract` group name and the noun table only.