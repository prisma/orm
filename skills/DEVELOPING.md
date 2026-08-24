# Developing Prisma Next skills

Contributor guide for the Prisma Next skills cluster. If you are *using* the skills, read [`README.md`](./README.md) and stop here. If you are *authoring or maintaining* a skill in this cluster, read this file first.

## What this tree is

Skills that teach an LLM agent how to operate Prisma Next end-to-end. The usage surface is one consolidated skill: [`skills/prisma-8/SKILL.md`](./prisma-8/SKILL.md) is the runtime-matched entry point (its `description:` frontmatter fires on any Prisma Next work) and routes via its routing table into workflow-scoped reference files under [`skills/prisma-8/references/`](./prisma-8/references/) — one user goal per reference file. Upgrading is part of the same skill: [`references/upgrade-app.md`](./prisma-8/references/upgrade-app.md) and [`references/upgrade-extension.md`](./prisma-8/references/upgrade-extension.md) carry the two flows, and the per-transition instructions they replay live under [`prisma-8/upgrading/app/upgrades/`](./prisma-8/upgrading/app/upgrades/) and [`prisma-8/upgrading/extension/upgrades/`](./prisma-8/upgrading/extension/upgrades/).

## Design principles

The consolidated shape is deliberate. These principles govern every change to the published skills; a change that regresses one of them needs an explicit reason in the PR.

### One skill, not a cluster

The usage surface is exactly one installable skill. Agent runtimes match skills against the user's prompt by `description:` — a cluster of sibling skills forces each description to carve out its own trigger territory, and the boundaries drift, overlap, and misfire as the cluster grows. One skill means one activation decision ("is this Prisma Next work?") followed by an explicit routing step the skill itself controls.

**A new top-level skill needs a structural reason, not a topical one.** The upgrade flows used to be two sibling skills because their install ref policy differed (always-`main` vs version-pinned); now that the skill ships inside the packages, every copy is version-matched by construction and that reason is gone. A new workflow, feature area, or extension is a new reference file plus a routing-table row, never a new sibling skill.

### Progressive disclosure

`SKILL.md` is the only always-loaded content, so it must earn its context budget. It carries three things: the activation description, the routing table, and the canonical mental model — nothing else. Everything workflow-specific lives in a reference file that is loaded only when its routing-table row matches. API detail, worked examples, pitfalls, and capability gaps all belong at the reference layer.

The test for placement: *would every Prisma Next task benefit from the agent having read this?* If yes, it may live in `SKILL.md`. If only some tasks would, it goes in a reference file.

**The exception: cross-cutting gotchas.** A fact that defies a reasonable assumption — and that the agent has no obvious trigger to look up before it acts — needs to be read *before* the agent hits the situation, not after. A reference file only loads once its routing-table row matches, so a surprising fact scoped to one reference is fine there (its own *Common Pitfalls* section covers it). A surprising fact that cuts across workflows — the kind where an agent already committed to a plan under a wrong assumption has no reason to go back and check a reference it never routed to — belongs in `SKILL.md` itself. The Mongo ORM addressing rule (`db.orm.<collection>` uses storage names, not PSL model names) is the existing example: it lives in `SKILL.md`'s canonical-model paragraph, not buried in `references/queries.md`, because an agent that already assumed model-name addressing has no reason to open the queries reference to find out it's wrong. Keep this tier small — it is competing for the same ~150-line budget as everything else in `SKILL.md`.

### Length budgets

- **`SKILL.md`: ~150 lines.** It is an index and a mental model, not a manual. If it is growing, content is leaking up from the reference layer — push it back down.
- **Reference files: ~200–350 lines.** Below that range, consider whether the file earns its routing-table row or should merge into a sibling. Above it, split into a companion reference (the `queries.md` → `queries-postgres.md` / `queries-mongo.md` split is the template) and link the companions from the parent reference's routing row.
- **`description:` frontmatter: one activation trigger, not a keyword dump.** The 1024-character registry limit is a ceiling, not a target. The description answers "does this skill apply to the current work?"; the per-workflow trigger phrases (CLI flags, error codes, feature vocabulary) live in the routing table's *Triggers* column, where there is room to be exhaustive.

### Point at the source of truth instead of copying it

Where a fact can be *queried* — from the framework source, the installed packages, or the CLI itself — a reference file should teach the query, not transcribe the answer. Transcribed API detail goes stale silently; a lookup procedure stays correct as the framework moves. This is the same principle as *concepts-over-procedures* below, applied to content: prefer *"ask the system with `command --flag`"* over a table of memorised outputs, and prefer `--help` pointers over restating flag lists.

The long-term direction is for versioned API documentation to ship inside the published `@internal/*` packages, with reference files shrinking toward routing plus lookup method. Until that lands, reference files still carry API content inline — which is why the lockstep rule below (skill updates ship in the same PR as framework-surface changes) is load-bearing.

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

The pilot rewrite of [`skills/prisma-8/references/migration-review.md`](./prisma-next/references/migration-review.md) is the canonical worked example for this principle in this cluster. Before that rewrite, the skill contained:

- A five-step *"diamond convergence procedure"* for resolving concurrent migrations.
- A four-step *"detect that main advanced"* workflow.
- Procedural recipes for setting up refs, applying refs, and checking ref status.
- Factually wrong tool surface (it referenced `migrations/refs.json`, `migration ref set --env`, etc. — APIs that don't exist).

After the rewrite, the same ground is covered by one *Key Concepts* block that names the moving parts (**origin** = live DB marker, **destination** = ref or contract head, **migration graph** = path between them) and three short workflow sections that say *"the navigation is X → Y; ask the system about it with `migration status --to <name> --db $URL`."* Diamond convergence collapsed from five steps to one paragraph: *"it's the normal `edit → plan → migrate` loop applied to the post-merge state; port any data-transform logic from the abandoned `migration.ts` over."* The skill is 175 lines instead of 266, and an agent reading it can resolve situations the original five-step procedure didn't anticipate.

Read the diff if you want a before/after; read the rewrite itself if you want the template for new workflow sections.

### Show façade-only imports in user-authored code

**The principle: every import a user types in their own source files comes from `@internal/<target>/<subpath>` or `@internal/extension-<name>/<subpath>`. A user's `package.json` lists exactly one façade per target plus one façade per extension. They never see `@internal/cli/*`, `@internal/family-*`, `@internal/target-*`, `@internal/adapter-*`, `@internal/driver-*`, `@internal/sql-contract-*`, or `@internal/mongo-contract-*` in a file they own.**

The façade packages exist for this reason. `@internal/postgres/config` exposes a `defineConfig({ contract, db, extensions, migrations })` that bakes in `family`/`target`/`adapter`/`driver` and auto-routes `.prisma` vs `.ts` contract paths — so the user writes two imports instead of seven. `@internal/postgres/contract-builder` re-exports the TS-builder surface. `@internal/postgres/control` exposes `createPostgresControlClient({ connection, extensions })` instead of asking the user to compose a `createControlClient` call from five internal pieces. `@internal/postgres/runtime` does the same for the runtime client.

A skill that teaches the verbose form has handed the agent a worse mental model than the API is actually capable of. When the user follows the skill's example into their own code, their `package.json` grows seven `@internal/*` entries instead of one. Upgrades are now seven-way coordinated instead of one-line. The drift compounds.

**Verify each user-authored import:**

```bash
rg "from '@internal/" skills/prisma-8/references/<topic>.md \
  | rg -v '@internal/(postgres|mongo|sqlite|extension-|[a-z]+-plugin-)' \
  | rg -v 'framework-rendered'
```

Anything that prints is a likely defect: a user-authored example is importing from an internal package. Either rewrite it onto the façade, or annotate the surrounding prose so it reads as framework-rendered rather than user-typed.

The exclusion list covers the three sanctioned sources of user-authored `@internal/*` imports: target façades (`postgres`, `mongo`, `sqlite`), extension façades (`extension-<name>`), and build-tool plugin packages (`<bundler>-plugin-<purpose>`, e.g. `@internal/vite-plugin-contract-emit`). Build-tool plugins are themselves one-package-per-integration façades — they ship their own public surface and are not internal to a target package.

**The framework-rendered exception.** Some files in a user's project are written *by* the framework, not by the user — chiefly `migrations/<scope>/<timestamp>/migration.ts`, which `prisma migration plan` renders. Those files import from `@internal/postgres/migration` (or `@internal/sqlite/migration` for SQLite). A skill describing those files should:

1. Make explicit that the imports are framework-managed.
2. Not show those imports as if the user typed them.

The framework-rendered migration scaffold uses the target façade's `/migration` subpath — the same façade-only convention as the rest of the project.

**Worked example — the contract skill re-audit.** Commit `e41f02c1b` rewrote every user-authored example in `references/contract.md` against the façade. The `prisma.config.ts` example went from seven imports across `@internal/{cli,adapter-postgres,driver-postgres,family-sql,target-postgres,sql-contract-psl}` to two imports from `@internal/{postgres/config, extension-pgvector/control}`. The TS builder example moved off `@internal/sql-contract-ts/contract-builder` onto `@internal/postgres/contract-builder`, and uses `@internal/postgres/family` and `@internal/postgres/target` as the `family`/`target` packs (a less-obvious façade subpath worth knowing about). Read the diff for a before/after.

Commit `bf742221c` (`examples: migrate to @internal/<target> façade imports`) does the same migration across nine example apps in `examples/`. Those apps are the canonical worked references; cite them when a skill needs a concrete example to point at.

### Other authoring rules

These are well-trodden but worth listing in one place:

- **`description:` frontmatter is a runtime matcher, not marketing prose.** Only the consolidated `SKILL.md` carries frontmatter; its description fires on any Prisma Next work. Per-workflow trigger phrases — CLI flags, error codes, feature names, foreign-tool vocabulary a user would type — live in the routing table's *Triggers* column, and a new reference file must add its row there.
- **One workflow per reference file.** File size is bounded by the per-file line ceiling. If a workflow grows past it, split into a companion reference (the queries → queries-postgres/queries-mongo split is the template) — don't sprawl.
- **Provide a default, not a menu.** When more than one tool or approach would work (PSL vs. the TS builder, `db update` vs. `migration plan`, which query lane for a given target), commit to the one that's the recommended path for the common case and state it first. Mention the alternative briefly, as an escape hatch with the condition under which it applies — don't present both as equally-weighted options and leave the choice to the agent. An agent handed a menu without a default either guesses or asks; a stated default lets it proceed.
- **Omit what the agent already knows.** Every sentence should teach something the agent wouldn't get right without it: a Prisma Next-specific convention, a non-obvious constraint, the actual verified tool surface. Don't explain what a foreign-key constraint is, what a connection pool does, or other general engineering or database knowledge the agent already has — that's editorial padding that pushes genuinely load-bearing content further from the top of the file and erodes the length budgets above. When rewriting or extending a reference file, apply the test explicitly: *would the agent get this wrong without this sentence?* If no, cut it.
- **`What Prisma Next doesn't do yet` is mandatory.** It names a concrete gap, describes today's workaround, and routes to `references/feedback.md`. Never confabulate an API that doesn't exist.
- **No cross-reference links that drift.** When a reference file links to a sibling, link by reference path (`references/<topic>.md`), not by line range.
- **Skill content ships in lockstep with the framework.** Stale skill content is worse than no skill. When a PR touches framework surface a skill references, the skill update is part of the PR scope, not follow-up work.

## Authoring workflow

1. Read [`README.md`](./README.md) for the user-facing scope of the skills.
2. Read the [`skill-specialist` persona](https://github.com/prisma/ignite/blob/main/skills/.curated/drive-agent-personas/personas/skill-specialist.md) in the Ignite persona library — it's the canonical lens for skill work.
3. Read [`skills/prisma-8/references/migration-review.md`](./prisma-next/references/migration-review.md) for the worked example of concepts-over-procedures.
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
