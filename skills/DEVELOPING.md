# Developing Prisma Next skills

Contributor guide for the Prisma Next skills cluster. If you are *using* the skills, read [`README.md`](./README.md) and stop here. If you are *authoring or maintaining* a skill in this cluster, read this file first.

## What this tree is

Skills that teach an LLM agent how to operate Prisma Next end-to-end. The usage surface is two skills with fixed trigger territories:

- [`prisma-orm-core-concepts`](./prisma-orm-core-concepts/SKILL.md) — everything except migrations: the mental model, structured-error diagnosis, and the development workflows (quickstart, contract authoring, queries, runtime, build, Supabase, feedback, upgrades). Fires whenever the agent works with Prisma ORM.
- [`prisma-orm-migrations`](./prisma-orm-migrations/SKILL.md) — migration authoring, the graph/refs model, deploy review. Fires on migration work.

Each `SKILL.md` is the runtime-matched entry point for its territory and routes via its routing table into workflow-scoped reference files under that skill's `references/` — one user goal per reference file. Upgrading is part of the core-concepts skill: [`references/upgrade-app.md`](./prisma-orm-core-concepts/references/upgrade-app.md) and [`references/upgrade-extension.md`](./prisma-orm-core-concepts/references/upgrade-extension.md) carry the two flows, and the per-transition instructions they replay live under [`prisma-orm-core-concepts/upgrading/app/upgrades/`](./prisma-orm-core-concepts/upgrading/app/upgrades/) and [`prisma-orm-core-concepts/upgrading/extension/upgrades/`](./prisma-orm-core-concepts/upgrading/extension/upgrades/).

## Design principles

The two-skill shape is deliberate. These principles govern every change to the published skills; a change that regresses one of them needs an explicit reason in the PR.

### Two skills, fixed territories

The usage surface is exactly two installable skills — core-concepts and migrations — and the set is closed. Agent runtimes match skills against the user's prompt by `description:`, and sibling descriptions carve trigger territory that drifts, overlaps, and misfires as a cluster grows (the pre-consolidation per-workflow cluster failed exactly this way; its names live on in the CLI's retired-skills cleanup list). The boundary is migrations-vs-everything-else: `prisma-orm-core-concepts` fires whenever the agent works with Prisma ORM at all, `prisma-orm-migrations` on migration work specifically, and each `SKILL.md` carries a *Related skills* section that hands misrouted tasks to the sibling.

**A new top-level skill needs a structural reason, not a topical one.** A new workflow, feature area, or extension is a new reference file plus a routing-table row in the skill that owns its territory — never a new sibling skill. When a task genuinely straddles both territories (a migration triggered by a contract edit, an error envelope raised mid-migration), the answer is cross-routing between the existing two, not a third skill.

### Progressive disclosure

Each skill's `SKILL.md` is the only always-loaded content for its territory, so it must earn its context budget. It carries three things: the activation description, the routing table, and the canonical mental model — nothing else. Everything workflow-specific lives in a reference file that is loaded only when its routing-table row matches. API detail, worked examples, pitfalls, and capability gaps all belong at the reference layer.

The test for placement: *would every Prisma Next task benefit from the agent having read this?* If yes, it may live in `SKILL.md`. If only some tasks would, it goes in a reference file.

**The exception: cross-cutting gotchas.** A fact that defies a reasonable assumption — and that the agent has no obvious trigger to look up before it acts — needs to be read *before* the agent hits the situation, not after. A reference file only loads once its routing-table row matches, so a surprising fact scoped to one reference is fine there (its own *Common Pitfalls* section covers it). A surprising fact that cuts across workflows — the kind where an agent already committed to a plan under a wrong assumption has no reason to go back and check a reference it never routed to — belongs in the owning skill's `SKILL.md` itself. Two standing examples: the Mongo ORM addressing rule (`db.orm.<collection>` uses storage names, not PSL model names) lives in the core-concepts `SKILL.md`'s canonical-model paragraph, not buried in `references/queries.md`; the plan-origin rule (`migration plan` never chains from the newest migration on disk) lives in the migrations `SKILL.md`. Keep this tier small — it is competing for the same ~150-line budget as everything else in a `SKILL.md`.

### Length budgets

- **Each `SKILL.md`: ~150 lines.** It is an index and a mental model, not a manual. If it is growing, content is leaking up from the reference layer — push it back down.
- **Reference files: ~200–350 lines.** Below that range, consider whether the file earns its routing-table row or should merge into a sibling. Above it, split into a companion reference (the `queries.md` → `queries-postgres.md` / `queries-mongo.md` split is the template) and link the companions from the parent reference's routing row.
- **`description:` frontmatter: the skill's trigger territory, not a keyword dump.** The 1024-character registry limit is a ceiling, not a target. Each description answers "does this skill — as opposed to its sibling — apply to the current work?"; the per-workflow trigger phrases (CLI flags, error codes, feature vocabulary) live in the routing table's *Triggers* column, where there is room to be exhaustive.

### Point at the source of truth instead of copying it

Where a fact can be *queried* — from the framework source, the installed packages, or the CLI itself — a reference file should teach the query, not transcribe the answer. Transcribed API detail goes stale silently; a lookup procedure stays correct as the framework moves. This is the same principle as *concepts-over-procedures* below, applied to content: prefer *"ask the system with `command --flag`"* over a table of memorised outputs, and prefer `--help` pointers over restating flag lists.

The long-term direction is for versioned API documentation to ship inside the published `@prisma/orm-*` packages, with reference files shrinking toward routing plus lookup method. Until that lands, reference files still carry API content inline — which is why the lockstep rule below (skill updates ship in the same PR as framework-surface changes) is load-bearing.

## Authoring rules

These rules are load-bearing for the cluster. A new skill or a skill rewrite that doesn't honour them is a defect, not a style preference. Where this list differs from the general Prisma Next contributor guide, this list takes precedence *for files under `skills/`*.

### Verify the tool surface as you author, not afterwards

**Every CLI flag, command name, error code, config key, and file path you cite must be verified against the framework source before the sentence ships.** Authoring against an imagined tool surface — *"`db migrate --dry-run` probably exists; it's standard"* — is how the most common defect class in this cluster gets in: a confidently-worded claim about an API that doesn't ship. The agent the skill teaches will not catch it (the skill is what the agent loads instead of re-deriving the API); reviewers catch it only if they happen to check.

Verify *during* drafting, not at the end. The first draft of the `migration-review.md` pilot — written with the stated goal of "verify the tool surface before authoring" — still introduced three fabricated claims: a `--dry-run` flag on `db migrate`, a "long-running operation" classifier that doesn't exist, and a destructive-op confirmation prompt on `db migrate` (the prompt lives on `db update`). None of the three were caught by the author; all three were caught only by review. The lesson is that a final "verify pass" doesn't work — the verification step has to fire *at each tool-surface claim, while drafting it*, so the temptation to extrapolate from a similar command is gone before it leaves a trace in the file.

Use ripgrep against the framework source as you write. Verifying a flag:

```bash
rg "option\('--<flag>" packages/1-framework/3-tooling/cli/src/commands/<file>.ts
```

Verifying a command:

```bash
rg "new Command\('<name>'\)" packages/1-framework/3-tooling/cli/src/
```

Verifying a diagnostic code:

```bash
rg "code: '<CODE>'" packages/1-framework/3-tooling/cli/src/commands/<file>.ts
```

If the search returns nothing, the surface does not ship. Name the gap in *What Prisma Next doesn't do yet* and route the user to `references/feedback.md`. Do not paper over the gap with a plausible-looking incantation.

### Teach concepts, not procedures

**The principle: teach the system's mental model and show the queries that reveal each piece of state. Reserve rigid step-by-step procedures for the rare case where there's literally one safe path and any deviation is costly.**

Procedural workflow sections — *"step 1: run X; step 2: read Y; step 3: if Z, do W"* — teach the agent to follow a memorised script. When the situation drifts from what the script's author anticipated, the agent escalates or confabulates. Concept-based sections — *"the concept is X; ask the system about it with `command --flag`"* — teach the agent to *compose* the right action from the model. Concept-based sections cover more ground in fewer words and degrade gracefully on situations the author didn't anticipate.

**Symptoms a workflow section is wearing concept's clothes but is actually procedural:**

- More than three numbered steps.
- The section names two states whose names don't appear in the skill's *Key Concepts*.
- The section can't be rewritten as *"the concept is X; ask the system about it with `command --flag`."*

**The carve-out.** Some operations are genuinely one-safe-path (data-loss-risk migrations, irreversible operations, security-critical sequences where the agent must not improvise). Those workflow sections may be procedural — explicitly say *"this is the one-safe-path case"* in the section header so future maintainers don't strip the steps thinking they're cargo-culted.

*Terminology note:* this rule and the general skill-authoring notion of "favor procedures over declarations" (teach a reusable method instead of transcribing one instance's answer) are compatible, not competing — they use "procedure" for opposite things. This rule's "procedure" is a rigid, memorised step-script (avoid it). The general notion's "procedure" is the generalizable *method* itself (prefer it over a one-off answer). A concept block plus the query that reveals state satisfies both: it's a method, not a rigid script.

#### Worked example — `references/migration-review.md`

The pilot rewrite of [`skills/prisma-orm-migrations/references/migration-review.md`](./prisma-orm-migrations/references/migration-review.md) is the canonical worked example for this principle in this cluster. Before that rewrite, the skill contained:

- A five-step *"diamond convergence procedure"* for resolving concurrent migrations.
- A four-step *"detect that main advanced"* workflow.
- Procedural recipes for setting up refs, applying refs, and checking ref status.
- Factually wrong tool surface (it referenced `migrations/refs.json`, `migration ref set --env`, etc. — APIs that don't exist).

After the rewrite, the same ground is covered by one *Key Concepts* block that names the moving parts (**origin** = live DB marker, **destination** = ref or contract head, **migration graph** = path between them) and three short workflow sections that say *"the navigation is X → Y; ask the system about it with `migration status --to <name> --db $URL`."* Diamond convergence collapsed from five steps to one paragraph: *"it's the normal `edit → plan → migrate` loop applied to the post-merge state; port any data-transform logic from the abandoned `migration.ts` over."* The skill is 175 lines instead of 266, and an agent reading it can resolve situations the original five-step procedure didn't anticipate.

Read the diff if you want a before/after; read the rewrite itself if you want the template for new workflow sections.

### Show façade-only imports in user-authored code

**The principle: every import a user types in their own source files comes from `@prisma/orm-<target>/<subpath>` or `@prisma/orm-extension-<name>/<subpath>` — the published names. The `@internal/*` workspace scope is not published (ADR 242 — Public npm surface), so any `@internal/` import in a user-authored example is a defect, full stop. A user's `package.json` lists exactly one façade per target plus one façade per extension (plus the `@prisma/cli-engine` / `@prisma/cli` toolchain).**

The façade packages exist for this reason. `@prisma/orm-postgres/config` exposes a `defineConfig({ contract, db, extensions, migrations })` that bakes in `family`/`target`/`adapter`/`driver` and auto-routes `.prisma` vs `.ts` contract paths — so the user writes two imports instead of seven. `@prisma/orm-postgres/contract-builder` re-exports the TS-builder surface. `@prisma/orm-postgres/control` exposes `createPostgresControlClient({ connection, extensions })` instead of asking the user to compose a `createControlClient` call from five internal pieces. `@prisma/orm-postgres/runtime` does the same for the runtime client.

A skill that teaches the verbose form has handed the agent a worse mental model than the API is actually capable of. When the user follows the skill's example into their own code, their `package.json` grows entries that don't resolve on npm, or seven-way coordinated deep subpaths instead of one façade. The drift compounds.

**Verify each user-authored import:**

```bash
# Published-surface positive check — user examples import @prisma/orm-* (or @prisma/cli-engine):
rg "from '@prisma/orm-" skills/*/references/<topic>.md

# Defect check — any @internal/ import in a user-authored example is a defect:
rg "from '@internal/" skills/prisma-orm-*/
```

Anything the second command prints is a defect (outside the historical `upgrading/` instruction sets): the `@internal/*` scope is unpublished, so a user cannot install it. Rewrite the example onto the published façade name.

The sanctioned sources of user-authored imports are: target façades (`@prisma/orm-postgres`, `@prisma/orm-mongo`, `@prisma/orm-sqlite`), extension façades (`@prisma/orm-extension-<name>`), and the config/CLI toolchain (`@prisma/cli-engine` for `definePrismaConfig`). Build-tool plugins ship as façade subpaths (e.g. `@prisma/orm-postgres/vite-plugin-contract-emit`), not separate packages.

**The framework-rendered exception.** Some files in a user's project are written *by* the framework, not by the user — chiefly `migrations/<scope>/<timestamp>/migration.ts`, which `prisma migration plan` renders. Those files import from `@prisma/orm-postgres/migration` (or `@prisma/orm-sqlite/migration` for SQLite; `@prisma/orm-mongo/family/migration` + `@prisma/orm-mongo/target/migration` on Mongo). A skill describing those files should:

1. Make explicit that the imports are framework-managed.
2. Not show those imports as if the user typed them.

The framework-rendered migration scaffold uses the target façade's `/migration` subpath — the same façade-only convention as the rest of the project.

**Worked example — the contract skill re-audit.** Commit `e41f02c1b` (predating the `@prisma/orm-*` publish rename, so its diff still shows workspace `@internal/*` names) rewrote every user-authored example in `references/contract.md` against the façade: the `prisma.config.ts` example went from seven low-level imports to two façade imports, and the TS builder example moved onto the façade's `/contract-builder`, `/family`, and `/target` subpaths. Read the diff for a before/after of the altitude change; today's spellings are the published `@prisma/orm-*` names.

Commit `bf742221c` (same pre-rename era) does the same migration across nine example apps in `examples/`. Those apps are the canonical worked references — now on the published names; cite them when a skill needs a concrete example to point at.

### Other authoring rules

These are well-trodden but worth listing in one place:

- **`description:` frontmatter is a runtime matcher, not marketing prose.** Only the two `SKILL.md` files carry frontmatter; each description fires on its skill's territory. Per-workflow trigger phrases — CLI flags, error codes, feature names, foreign-tool vocabulary a user would type — live in the owning skill's routing table's *Triggers* column, and a new reference file must add its row there.
- **One workflow per reference file.** File size is bounded by the per-file line ceiling. If a workflow grows past it, split into a companion reference (the queries → queries-postgres/queries-mongo split is the template) — don't sprawl.
- **Provide a default, not a menu.** When more than one tool or approach would work (PSL vs. the TS builder, `db update` vs. `migration plan`, which query lane for a given target), commit to the one that's the recommended path for the common case and state it first. Mention the alternative briefly, as an escape hatch with the condition under which it applies — don't present both as equally-weighted options and leave the choice to the agent. An agent handed a menu without a default either guesses or asks; a stated default lets it proceed.
- **Omit what the agent already knows.** Every sentence should teach something the agent wouldn't get right without it: a Prisma Next-specific convention, a non-obvious constraint, the actual verified tool surface. Don't explain what a foreign-key constraint is, what a connection pool does, or other general engineering or database knowledge the agent already has — that's editorial padding that pushes genuinely load-bearing content further from the top of the file and erodes the length budgets above. When rewriting or extending a reference file, apply the test explicitly: *would the agent get this wrong without this sentence?* If no, cut it.
- **`What Prisma Next doesn't do yet` is mandatory.** It names a concrete gap, describes today's workaround, and routes to `references/feedback.md`. Never confabulate an API that doesn't exist.
- **No cross-reference links that drift.** When a reference file links to a sibling, link by reference path (`references/<topic>.md`), not by line range.
- **Skill content ships in lockstep with the framework.** Stale skill content is worse than no skill. When a PR touches framework surface a skill references, the skill update is part of the PR scope, not follow-up work.

## Authoring workflow

1. Read [`README.md`](./README.md) for the user-facing scope of the skills.
2. Read the [`skill-specialist` persona](https://github.com/prisma/ignite/blob/main/skills/.curated/drive-agent-personas/personas/skill-specialist.md) in the Ignite persona library — it's the canonical lens for skill work.
3. Read [`skills/prisma-orm-migrations/references/migration-review.md`](./prisma-orm-migrations/references/migration-review.md) for the worked example of concepts-over-procedures.
4. Draft the reference file, **verifying each tool-surface claim against the framework source as you write it** (see *Verify the tool surface as you author* above for the ripgrep commands). The shape:
   - A routing-table row in `SKILL.md` as the matcher (CLI flags, error codes, feature names — all verified).
   - Preamble + canonical mental-model headline.
   - *When to Use* / *When Not to Use*.
   - *Key Concepts* — name the moving parts.
   - *Workflow* — for each workflow, *concept block + the query that reveals state*.
   - *Common Pitfalls*.
   - *What Prisma Next doesn't do yet* — concrete gap + workaround + route to `references/feedback.md`.
   - *Reference Files* (when applicable; the migration-review skill omits this and points at `--help` instead).
   - *Checklist*.
5. Re-read your workflow sections against the symptoms in *Teach concepts, not procedures*. Procedural? Rewrite as concept + query.

## Journey tests

[`journey-tests/`](./journey-tests/) contains Markdown checklists for the workflows the cluster supports. Each checklist names the prompt, the example app, and the expected end-state. Tests are run by hand against an example app and a configured agent runtime; cross-runtime automation is deferred.

When you add or rewrite a skill workflow, add or update a journey test that exercises it end-to-end.

## Where to surface defects

- **Skill content drift / staleness** — fix in-PR or open a follow-up under this project / Linear ticket. Don't merge a framework-surface change without the skill update.
- **Skill cluster scope or shape issues** — surface to `tech-lead` (orchestration) or the `skill-specialist` lens (cluster shape). See the [persona library](https://github.com/prisma/ignite/blob/main/skills/.curated/drive-agent-personas).
- **Framework affordance gaps the skill is papering over** — file via the feedback flow in `references/feedback.md` or open the Linear ticket directly. Don't bury an affordance gap as a workaround in a skill body without naming it in *What Prisma Next doesn't do yet* and routing the user to feedback.
