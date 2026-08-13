# Agents — Prisma Next

Welcome. This is a contract‑first, agent‑friendly data layer.

## Start Here

- [Docs Index](docs/README.md) — How the docs are organized and what to read next
- [Architecture Overview](docs/Architecture%20Overview.md) — High-level design principles
- [Testing Guide](docs/Testing%20Guide.md) — Philosophy, patterns, and commands
- [Rules Index](.agents/rules/README.md) — All agent rules organized by topic
- [ADRs](docs/architecture%20docs/adrs/) — Architecture Decision Records

### Modular Onboarding

- [Getting Started](docs/onboarding/Getting-Started.md) — Build, test, and run demo
- [Repo Map & Layering](docs/onboarding/Repo-Map-and-Layering.md) — Package organization and import rules
- [Conventions](docs/onboarding/Conventions.md) — TypeScript, tooling, and code style
- [Testing](docs/onboarding/Testing.md) — Test commands, patterns, and organization
- [Common Tasks Playbook](docs/onboarding/Common-Tasks-Playbook.md) — Add operation, split monolith, fix import
- [Cursor Cloud Agents](docs/onboarding/Cursor-Cloud-Agents.md) — Setup, secrets, lockfile discipline, snapshot management

## Project Overview

**Prisma Next** is a contract-first data access layer:

- **Contract-first**: Emit `contract.json` + `contract.d.ts` — no executable runtime code generation
- **Composable DSL**: Type-safe query builder (`sql().from(...).select(...)`)
- **Machine-readable**: Structured artifacts that agents can understand and manipulate
- **Runtime verification**: Contract hashes and guardrails ensure safety before execution

## Where skills and rules live

The repo keeps a single canonical home for each kind of agent surface, with presentation symlinks that satisfy the paths each harness expects.

- **Skills — canonical home:** `skills-contrib/<skill-name>/SKILL.md`. These are the tracked, deliverable source-of-truth files.
- **Skills — presentation symlinks:** `.claude/skills/<skill-name>` and `.agents/skills/<skill-name>` are symlink directories pointing into `skills-contrib/`. They exist so the various agent harnesses (Cursor, Claude Code, …) can find the skills at the paths they expect. Both symlink trees are gitignored.
- **Skills — wired post-install:** the symlink trees (and any tooling-specific copies) are materialized by the `prepare` script in [`package.json`](./package.json), which runs `skills add ./skills-contrib --skill '*' --agent universal claude-code -y`. After `pnpm install`, `.claude/skills/` and `.agents/skills/` are populated automatically — no manual setup. If you add a new skill under `skills-contrib/`, re-run `pnpm install` (or just the prepare hook) to wire it into the tooling locations. `pnpm lint:skills` validates skill frontmatter in CI.
- **Drive upstream in ignite:** `drive-*` skills and [`docs/drive/`](https://github.com/prisma/ignite/tree/main/docs/drive) live in [prisma/ignite](https://github.com/prisma/ignite) (`skills/.pilot/`); install with `npx skills add prisma/ignite/skills/.pilot --skill '*'`. This repo keeps only `drive/` project-context overlays.
- **Rules — canonical home:** `.agents/rules/<rule-name>.mdc` — the only tracked copy (rule files must use the `.mdc` extension; a `.md` rule is never loaded by the harnesses) (a whitelist exception in `.gitignore` keeps `.agents/rules/**` tracked even though the rest of `.agents/` is ignored). The `.cursor/rules/` and `.claude/rules/` trees are gitignored presentation mirrors containing only relative symlinks back into `.agents/rules/`.
- **Rules — wired post-install:** like skills, the symlink trees are materialized by `prepare` (which runs `node scripts/sync-agent-rules.mjs` after `skills add`). After `pnpm install` the trees are regenerated automatically — no manual setup. A rule added only to `.cursor/rules` is gitignored and silently lost, so **always add it under `.agents/rules/`** and run `pnpm rules:sync`. `pnpm lint:rules:symlinks` enforces tree/canonical consistency in CI.
- **Practical implication for editors and sub-agents:** when amending or authoring a skill or rule, **edit at the canonical path** (`skills-contrib/` for skills, `.agents/rules/` for rules) — not at the symlinked path. An edit through a symlink writes to the canonical file on disk, but `git status` and `git ls-files` report against the canonical path; addressing the canonical path keeps diffs legible and avoids surface churn.

## Golden Rules

- **Node.js version**: Use the shell's Node — do not run `nvm`/`fnm` or any version switcher. Source of truth is the root `package.json` `engines.node`. If the shell's `node -v` doesn't satisfy that, report that the shell is misconfigured (e.g. user should set their default Node in their version manager, or use Volta) — don't try to switch it yourself.
- Use `pnpm`, not `npm`. Never use `npx`.
- Build with `pnpm build` (delegates to Turbo). After changing exported types in a workspace package consumed elsewhere, run that package's `pnpm build` to refresh `dist/*.d.mts` before validating downstream TypeScript.
- For typecheck/test, use the local `pnpm typecheck` / `pnpm test` scripts rather than writing `tsc`/`vitest` invocations from scratch.
- Use arktype, not zod.
- Never add file extensions to imports in TypeScript.
- Don't add comments if avoidable, prefer code that expresses its intent.
- Don't add backwards-compat exports unless asked.
- Always write tests before creating or modifying implementation.
- Don't reexport from one file in another, except in `exports/` folders.
- Don't branch on target; use adapters: `.agents/rules/no-target-branches.mdc`.
- Keep tests concise; omit "should": `.agents/rules/omit-should-in-tests.mdc`.
- In sql-orm-client tests, assert the whole result shape (`toEqual`/snapshot) with explicit `select`: `.agents/rules/sql-orm-client-whole-shape-assertions.mdc`.
- Keep docs current (READMEs, rules, links): `.agents/rules/doc-maintenance.mdc`.
- Prefer links to canonical docs over long comments.

## Typesafety rules

- Never use `any`.
- Never use `@ts-expect-error` outside of negative type tests; never use `@ts-nocheck`.
- Never suppress biome lints.
- Minimize type casts: prefer explicit types that make casts unnecessary. If unavoidable, narrow the cast as far as possible — never cast a whole object/class when casting one property would suffice.
- No bare `as` in production code. Use `blindCast<T, "Reason">` or `castAs<T>` from `@internal/utils/casts`; see the `no-bare-casts` skill for the decision tree. `as const` and test files are exempt. The `no-bare-cast` plugin + CI ratchet enforce no per-PR cast increases.

## Common Commands

```bash
pnpm build                 # Build via Turbo
pnpm test:packages         # Run package tests (cheapest healthy-workspace signal)
pnpm test:integration      # Integration tests (PGlite + mongodb-memory-server, no external DB)
pnpm test:e2e              # E2E tests (also self-contained)
pnpm test:all              # Everything
pnpm coverage:packages     # Coverage (packages only)
pnpm lint:deps             # Validate layering/imports — fix violations, never bypass
pnpm fixtures:check        # Use this rather than ad-hoc emit-and-diff
```

## Core Concepts

### Contract Flow

1. **Authoring**: Write `schema.psl` or use TypeScript builders → canonicalized Contract IR
2. **Emission**: Emitter validates and generates `contract.json` + `contract.d.ts`
3. **Hydration**: the client factory (or a family `ContractSerializer`) validates `contract.json` and returns the typed contract
4. **Usage**: DSL functions (`sql()`, `schema()`) accept the contract and propagate types

### Key Patterns

- **Type Parameter Pattern**: JSON imports lose literal types. Import the precise types from `contract.d.ts` and name them where the JSON enters: `postgres<Contract>({ contractJson, url })`. The type parameter must be the fully-typed `Contract`, not a generic like `SqlContract<SqlStorage>`. Tests that need the contract on its own hydrate it with `validateSqlContractFully<Contract>(contractJson)`.
- **ExecutionContext**: Encapsulates contract, codecs, operations, and types. Pass to `schema()`, `sql()`, `orm()`.
- **Interface + factory pattern for stateful services**: Stateful services (registries, runtimes, adapters, drivers) are exposed through an interface plus a `createX()` factory; the implementing class stays package-private. Consumers depend on the interface, never the implementation. Pattern reference: [`docs/architecture docs/patterns/interface-plus-factory.md`](docs/architecture%20docs/patterns/interface-plus-factory.md).
- **Three-layer polymorphic IR for AST/IR class hierarchies**: AST/IR nodes (Contract IR, Schema IR, migration ops) are organised as framework interface → family abstract base → target concrete classes. Concrete classes are publicly exported as the target's IR alphabet; `freezeNode(this)` is called in the constructor. Target packs contribute new entity kinds via `AuthoringContributions.entityTypes` (see [`docs/reference/typescript-patterns.md`](docs/reference/typescript-patterns.md) § "AST/IR class hierarchies"). Pattern references: [`three-layer-polymorphic-ir.md`](docs/architecture%20docs/patterns/three-layer-polymorphic-ir.md), [`frozen-class-ast.md`](docs/architecture%20docs/patterns/frozen-class-ast.md), [`json-canonical-class-in-memory.md`](docs/architecture%20docs/patterns/json-canonical-class-in-memory.md).
- **Capability Gating**: Features like `returning()` require capabilities in the contract; gating is enforced at authoring time.
- **Builder chaining**: Methods return new instances — always chain calls.
- **Column access**: Use `table.columns.fieldName` to avoid conflicts with table properties.

### Package Organization

Organized by **Domains → Layers → Planes**:

- **Domains**: Framework (target-agnostic), SQL, Document, Targets, Extensions
- **Layers**: Core → Authoring → Tooling → Lanes → Runtime → Adapters
- **Planes**: Migration, Runtime, Shared

See `architecture.config.json` for the complete mapping and `pnpm lint:deps` to validate.

## Frequent Tasks

- Day-to-day playbook (add SQL operation, split monolith, fix import violation, etc.): [Common Tasks Playbook](docs/onboarding/Common-Tasks-Playbook.md)
- Shape and deliver a project (spec → plan → implement): run `drive-start-workflow`; methodology in [`prisma/ignite docs/drive/`](https://github.com/prisma/ignite/tree/main/docs/drive); project artifacts live under `projects/` (see [`projects/README.md`](projects/README.md))
- Cut the next npm minor release: `.agents/skills/publish-npm-version/SKILL.md` (policy in [`docs/oss/versioning.md`](docs/oss/versioning.md))

## Subsystem Deep Dives

See [`docs/architecture docs/subsystems/`](docs/architecture%20docs/subsystems/) — Data Contract, Contract Emitter & Types, Query Lanes, Runtime & Middleware Framework, Adapters & Targets, Error Handling, Migration System.

- [Telemetry](docs/Telemetry.md) — user-facing reference for what the CLI collects, the consent prompt, opt-out signals, and the per-user config file.

## Ask First

- Significant refactors to rule scope (`alwaysApply`) or architecture docs.
- Changes that affect demo, examples, or CI.

---

**Remember**: This is a prototype. Focus on clear docs that reflect implemented behavior.
