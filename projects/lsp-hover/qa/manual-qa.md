# Manual QA — lsp-hover (hover + hover-arguments)

> **Be the user.** You are a schema author with the Prisma 8 language server wired into an editor, hovering names in a real, multi-file `.prisma` project backed by the postgres target, the way the project's own spec promises.
>
> **Out of scope of this script.** Re-running `pnpm --filter @internal/language-server test`, `pnpm --filter @internal/psl-parser test`, or any other CI gate. Those already run on every push; re-running them here proves only that your machine matches CI. This script exists to drive the *built* server over real LSP against a *real* target stack, which CI's unit tests (synthetic fixtures) do not do.
>
> **Spec:** `projects/lsp-hover/spec.md` (project), `projects/lsp-hover/slices/hover-arguments/spec.md` (slice)
> **Plan:** `projects/lsp-hover/plan.md`, `projects/lsp-hover/slices/hover-arguments/plan.md`
> **PR:** hover-arguments branch (`lsp-hover-arguments`)

## Table of contents

| # | Scenario | What it proves | Isolation | Covers |
|---|---|---|---|---|
| 1 | Entity hover (model, field, named type, block) | Declaration, reference and `///` all resolve the same way, including across files | tmpdir | S1-1, S1-2, S1-3 |
| 2 | Attribute hover (field, model, block) | `@`/`@@` signature rendering is correct for all three attribute levels | tmpdir | S1-4, S2-6 |
| 3 | Contributed-type hover | A target-contributed scalar constructor renders its signature + doc | tmpdir | S1-8 |
| 4 | Block-keyword hover | A generic block keyword shows the extension's own documentation | tmpdir | S1-9 |
| 5 | Argument-key hover (parameter) | A named attribute-argument key renders `key?: type` + its own doc | tmpdir | S1-5, S2-1 |
| 6 | Function-name hover | A `@default(...)` function call's name renders its signature + doc | tmpdir | S1-6, S2-4 |
| 7 | Constant hover | A fixed-identifier value inside a multi-alternative `oneOf` renders its own doc | tmpdir | S1-7, S2-5 |
| 8 | Null-case hover | Namespace, cross-space, unresolved and non-identifier positions all answer `null` | tmpdir | S1-10 |
| 9 | Exploratory: real-schema hover sweep | Probe hover across the shipped `examples/prisma-8-demo` schema for anything the scripted scenarios didn't anticipate | tmpdir | (no AC; charter) |

> Scenario 6 is a **negative-control-shaped judgement scenario**: it names an explicit oracle (the project spec's own headline example, `@default(autoincrement())`) and the runner judges the observed hover against it. It is not scripted as "plant a violation, observe a gate fire" because there is no guardrail here — it is read-only hover.

## Scenarios deliberately not in this script

| Row | Why it's not a manual-QA scenario here |
|---|---|
| S2-2 — a named arg key inside a function call (e.g. `dbgenerated(expr: "…")`) | The real postgres target's `@default` function registry (`autoincrement`, `now`, `uuid`, `cuid`, `ulid`, `nanoid`) has no function with a *named* argument — only positional ones (`uuid(version)`, `cuid(version)`, `nanoid(size)`) — and `dbgenerated(...)` is explicitly rejected by the real target (`defaultValueArm` in `sql-attribute-specs.ts` reports it as a removed function). There is no real-world postgres position for this row today. `hover.test.ts`'s `'shows a named function-call-argument key and its documentation'` test covers it with a synthetic fixture instead. |
| S2-3 — a struct-block entry key (e.g. `using` in a `policy` block) | The only generic PSL block the real postgres target contributes is `enum`, which is `mapBlock`-mode (bare values), not `structBlock`-mode. No struct-mode block exists anywhere in the real postgres control stack to hover a struct entry key on. `hover.test.ts`'s `'shows a struct-block entry key and its documentation'` test covers it with a synthetic fixture instead. |

## Pre-flight

1. From the repo root, confirm a clean tree: `git status --porcelain` — only pre-existing, unrelated noise (if any) should appear; nothing under `packages/1-framework/3-tooling/language-server` or `packages/1-framework/2-authoring/psl-parser` should be dirty.
2. Confirm the standard gate is green: `pnpm --filter @internal/language-server typecheck && pnpm --filter @internal/language-server test && pnpm --filter @internal/language-server lint`.
3. Build nothing extra — the server runs directly from `packages/1-framework/3-tooling/language-server/src` via `tsx`, so edits are picked up without a build step.
4. This script drives a **scratch multi-file PSL project** under `wip/qa-scratch/lsp-hover-qa/` (two `.prisma` files + a `prisma.config.ts` that wires the real `@prisma/orm-postgres/config` stack, no extensions, no live DB connection) plus a throwaway LSP driver under `wip/qa-scratch/driver/`. Both are gitignored scratch, not committed. See "Driver setup" below for how to recreate them if they are missing.

### Driver setup (once per run)

```bash
cd <repo-root>
mkdir -p wip/qa-scratch/lsp-hover-qa wip/qa-scratch/driver
ln -sfn "$(pwd)/examples/prisma-8-demo/node_modules" wip/qa-scratch/lsp-hover-qa/node_modules
ln -sfn "$(pwd)/packages/1-framework/3-tooling/language-server/node_modules" wip/qa-scratch/driver/node_modules
```

Then author `wip/qa-scratch/lsp-hover-qa/prisma.config.ts`, `main.prisma` and `shared.prisma` (content below, under each scenario's Preconditions), and a driver script `wip/qa-scratch/driver/qa-driver.mts` that:

1. Spawns the real server via `startServer({ stdin, stdout, stderr })` from `packages/1-framework/3-tooling/language-server/src/start-server.ts` (not the published package — the branch's own source), wired to a `vscode-languageserver/node` client over injected `PassThrough` streams (the same pattern `test/start-server.test.ts` uses for its in-process client).
2. Sends `initialize` with `rootUri` pointing at the scratch directory, then `initialized`.
3. Sends `textDocument/didOpen` for both scratch files with their real on-disk text.
4. Sends `textDocument/hover` at a computed `{line, character}` for each scripted position (computed by locating a unique anchor substring in the known file text, not hand-counted).
5. Prints the JSON result for every position, then `shutdown` + `exit`.

Run it with: `<repo-root>/packages/1-framework/3-tooling/language-server/node_modules/.bin/tsx wip/qa-scratch/driver/qa-driver.mts`.

### `wip/qa-scratch/lsp-hover-qa/prisma.config.ts`

```ts
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

const orm = ormConfig({ contract: './main.prisma' });

export default definePrismaConfig({
  orm: {
    ...orm,
    contract: {
      ...orm.contract,
      source: { ...orm.contract.source, inputs: ['./main.prisma', './shared.prisma'] },
    },
  },
});
```

### `wip/qa-scratch/lsp-hover-qa/shared.prisma`

```prisma
// use prisma-8

/// A person who can sign in.
model User {
  id    String @id @default(uuid())
  /// Primary contact address.
  email Email  @unique
  posts Post[]
}

types {
  /// A bounded email address.
  Email = sql.String(255)
}

namespace billing {
  model Invoice {
    id String @id
  }
}
```

### `wip/qa-scratch/lsp-hover-qa/main.prisma`

```prisma
// use prisma-8

/// A role an account can hold.
enum Role {
  @@type("pg/text@1")
  Admin
  Member
}

model Post {
  id        String   @id @default(uuid())
  authorId  String
  createdAt DateTime @default(now())
  views     BigInt   @default(autoincrement())
  role      Role
  author    User     @relation("authoredPosts", fields: [authorId], references: [id], onDelete: Cascade)

  @@map("post")
}

model Oddity {
  id       String @id
  parent   billing
  external auth:User
  missing  Nope
}
```

This is a real, if deliberately small, postgres-target project: `sql.String` is the family's built-in contributed scalar constructor (the "pg.Varchar" row's real-world equivalent — the bare postgres target registers no extension-contributed types without an extension), `autoincrement()` / `now()` / `uuid()` are the real registered default functions, `onDelete: Cascade` is the real `@relation` referential-action argument, `@@type(...)` is the real `enum` block's only contributed block attribute, and `@@map` is a real model attribute. `Oddity` exists purely to exercise the four null-case rows (a namespace named as a type, a cross-space-qualified reference, an unresolved type name, and a non-identifier positional value).

## Scenario 1 — Entity hover (model, field, named type, block)

**What you're proving from the user's seat:** hovering a model, a field, a named type and a generic block — at both a reference and the declaration name — shows the declaration line plus the `///` comment immediately above it, including when the declaration lives in the project's *other* file.

**Covers:** S1-1, S1-2, S1-3

**Isolation:** `tmpdir`

**Oracle:** the project spec's own rule (`spec.md` § At a glance, § Decisions 7–8): the fence is the declaration's header line; the documentation is the `///` run directly above it; a reference resolves the same way as the declaration name, even across files.

**Preconditions:**

- Driver setup complete (above).
- Both scratch files open in the session (`didOpen` sent for both).

### Steps

Hover at each of the following positions (character picked inside the named word; `file` is `main.prisma` or `shared.prisma` under the scratch dir):

1. `shared.prisma`, inside `User` in `model User {` (the declaration name).
2. `main.prisma`, inside `User` in `author    User     @relation(...)` (a reference, in the *other* file from the declaration).
3. `shared.prisma`, inside `email` in `email Email  @unique` (a field declaration with a `///` directly above it).
4. `shared.prisma`, inside `posts` in `posts Post[]` (a field declaration with no `///` above it).
5. `main.prisma`, inside `Role` in `enum Role {` (a block declaration name).
6. `main.prisma`, inside `Role` in `role      Role` (a block reference).

### What you should see

- (1) and (2) both return the same fence `model User` and documentation `A person who can sign in.` — confirming a cross-file reference resolves identically to the declaration name.
- (3) returns fence `email Email @unique` and documentation `Primary contact address.`.
- (4) returns fence `posts Post[]` with **no** documentation section (no blank trailing line, no empty string — the markdown value ends right after the closing fence).
- (5) and (6) both return fence `enum Role` and documentation `A role an account can hold.`.

### Failure modes

- A reference does not match the declaration's own hover (stale/duplicated documentation logic).
- A no-`///` field grows a spurious trailing blank documentation section.
- A cross-file reference returns `null` or an empty fence (symbol table not merging both scratch files).

## Scenario 2 — Attribute hover (field, model, block)

**What you're proving from the user's seat:** hovering `@relation` (field-level), `@@map` (model-level) and `@@type` (block-level, new in this slice) all show the same shape of signature label, with the right `@`/`@@` prefix for the level.

**Covers:** S1-4, S2-6

**Isolation:** `tmpdir`

**Oracle:** `spec.md` § Decisions 7 ("Attribute and function lines reuse the signature rendering in `signature-help.ts`") and the hover-arguments slice spec § Chosen design ("field attributes take `@`, model and block attributes take `@@`").

**Preconditions:** same scratch project as Scenario 1.

### Steps

1. `main.prisma`, inside `relation` in `@relation("authoredPosts", ...)`.
2. `main.prisma`, inside `map` in `@@map("post")`.
3. `main.prisma`, inside `type` in `@@type("pg/text@1")` (inside the `enum Role` block).

### What you should see

- (1) shows the full `@relation(...)` signature label with every named parameter (`string?, fields?: field name[], references?: field name[], map?: string, onDelete?: ..., onUpdate?: ..., index?: boolean`) and the attribute's own documentation — this is the *existing*, pre-slice attribute case, included here as a baseline the new kinds sit next to.
- (2) shows `@@map(string)` with its documentation ("Maps this model to a database table name.").
- (3) shows `@@type(string)` — **with the `@@` prefix**, even though it is attached to a block rather than a model — plus its documentation ("Selects the storage codec for this enum.").

### Failure modes

- (3) renders with a bare `@` prefix instead of `@@` (the level-to-prefix mapping regressed for block-level attributes).
- Any of the three shows the fence with no documentation when the underlying spec declares one.

## Scenario 3 — Contributed-type hover

**What you're proving from the user's seat:** hovering a target-contributed scalar-constructor call (the real-world equivalent of the spec's illustrative `pg.Varchar`) shows its signature and the contributing descriptor's documentation.

**Covers:** S1-8

**Isolation:** `tmpdir`

**Oracle:** `spec.md`'s table row for `contributedType`: "descriptor documentation, else `pg.Varchar(<arg labels>)`".

**Preconditions:** same scratch project.

### Steps

1. `shared.prisma`, inside `String` in `Email = sql.String(255)`.

### What you should see

- Fence `sql.String(length: number)` and documentation "Variable-length text with a required maximum character length." — `sql.String` is the SQL family's built-in contributed type constructor (no extension needed), the real-world stand-in for the spec's `pg.Varchar` example.

### Failure modes

- Shows the bare path (`sql.String`) with no argument signature.
- Shows the raw authoring `kind` tag instead of a readable arg-type label.

## Scenario 4 — Block-keyword hover

**What you're proving from the user's seat:** hovering the `enum` keyword itself (not a symbol — the project spec is explicit that this is handled by the hover provider directly, not the binder) shows the extension's own documentation for that block kind.

**Covers:** S1-9

**Isolation:** `tmpdir`

**Oracle:** `spec.md` § Decisions 9.

**Preconditions:** same scratch project.

### Steps

1. `main.prisma`, inside the `enum` keyword of `enum Role {`.

### What you should see

- The hover shows **only** the extension's documentation string ("Defines an enum with named values and an inferred or explicitly selected storage codec."), with **no** fenced code block — this is a token, not a declaration, and gets no declaration-line fence.

### Failure modes

- A fenced declaration line appears alongside the keyword documentation (keyword hover should never show a code fence).
- `null` instead of the descriptor's documentation.

## Scenario 5 — Argument-key hover (parameter)

**What you're proving from the user's seat:** hovering a named attribute-argument key shows that key's own type and documentation, distinct from the attribute's own signature hover.

**Covers:** S1-5, S2-1

**Isolation:** `tmpdir`

**Oracle:** hover-arguments spec § Chosen design: `key?: <type label>` in the fence, plus `param.documentation`.

**Preconditions:** same scratch project.

### Steps

1. `main.prisma`, inside `references` in `references: [id]` (inside `@relation(...)`).

### What you should see

- Fence `references?: field name[]` and documentation "The corresponding fields on the referenced model. Must be supplied together with `fields`." — distinct from hovering `@relation` itself (Scenario 2, step 1), which shows the *whole* signature.

### Failure modes

- Shows the whole attribute's signature instead of just this one key.
- Shows the key with no `?` despite the parameter being optional, or vice versa.

## Scenario 6 — Function-name hover

**What you're proving from the user's seat:** hovering a `@default(...)` function call's name — the project spec's own headline example, `@default(autoincrement())` — shows that function's signature and documentation, the same way the shipped unit tests demonstrate with a synthetic fixture.

**Covers:** S1-6, S2-4

**Isolation:** `tmpdir`

**Oracle:** `spec.md`'s table row for `function`: `autoincrement()` + `FuncCallSig.documentation`; hover-arguments spec § Chosen design: `renderSignatureLabel(name, signature, params)` in the fence, plus `signature.documentation`.

**Preconditions:** same scratch project.

### Steps

1. `main.prisma`, inside `autoincrement` in `views BigInt @default(autoincrement())`.
2. `main.prisma`, inside `now` in `createdAt DateTime @default(now())`.
3. `main.prisma`, inside `uuid` in `id String @id @default(uuid())`.

### What you should see

- Each shows a fence with the function's call signature (`autoincrement()`, `now()`, `uuid(version?: 4 | 7)`) and its own documentation string, from the real `postgresDefaultFunctionRegistryEntries` in `packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts`.

### Failure modes

- Any of the three returns `null` instead of the function's hover. **This is the failure mode this round actually observed — see the run report.**

## Scenario 7 — Constant hover

**What you're proving from the user's seat:** hovering `Cascade` inside `onDelete: Cascade` — a fixed identifier that is not the first alternative of a five-way `oneOf` (`NoAction | Restrict | Cascade | SetNull | SetDefault`) — shows the constant's own name and documentation, proving the `oneOf` match (not just the shortcut-free first-match loop) correctly reaches a non-first alternative built entirely from fixed identifiers.

**Covers:** S1-7, S2-5

**Isolation:** `tmpdir`

**Oracle:** `spec.md`'s table row for `constant`: `Cascade` + `FixedIdentifierArgType.documentation`.

**Preconditions:** same scratch project.

### Steps

1. `main.prisma`, inside `Cascade` in `onDelete: Cascade`.

### What you should see

- Fence `Cascade` and documentation "Propagates deletion or key updates of a referenced row to its referencing rows." (the real `referentialActionArgument` documentation from `sql-attribute-specs.ts`, not a synthetic fixture's text).

### Failure modes

- `null` (the `oneOf` loop stopped at an earlier, non-matching fixed identifier instead of reaching `Cascade`).
- Wrong documentation (a different alternative's text leaked through).

## Scenario 8 — Null-case hover

**What you're proving from the user's seat:** the documented "answers nothing" positions genuinely answer nothing, across the four distinct reasons a position can be unhoverable: a namespace resolution, a cross-space resolution, a genuinely unresolved name, and a position that is not an identifier at all.

**Covers:** S1-10

**Isolation:** `tmpdir`

**Oracle:** `spec.md`'s table row: "`[authorId]` value in positional position, unresolved names, `crossSpace` → `null`".

**Preconditions:** same scratch project.

### Steps

1. `main.prisma`, inside `billing` in `parent   billing` (a namespace name used, invalidly, as a type).
2. `main.prisma`, inside `User` in `external auth:User` (a cross-space-qualified reference).
3. `main.prisma`, inside `Nope` in `missing  Nope` (a genuinely unresolved type name).
4. `main.prisma`, inside the string literal `"authoredPosts"` (`@relation`'s positional `name` argument — not an `Ident` token at all, so there is nothing to hover; this is the real-world shape of "a positional value" from the project's own illustrative schema, which supplies its one positional argument as a bare string).

### What you should see

- All four return `null`.
- The project's diagnostics for `main.prisma` separately confirm *why*: `"billing" is a namespace; a type reference must name a model, composite type, enum, or named type`, `Field "Oddity.external" type "User" is a type of contract space "auth"; only a relation field can name a type of another contract space.`, and `Cannot find type "Nope"` — hover and diagnostics agree on resolution, per the project's cross-cutting requirement.

### Failure modes

- Any of the four returns non-`null` content.
- Hover's null verdict disagrees with what the diagnostics say the position actually is.

## Scenario 9 — Exploratory: real-schema hover sweep

**Charter.** Open `examples/prisma-8-demo/src/prisma/contract.prisma` (read-only; do not edit it) against its own real `prisma.config.ts` (which does need `DATABASE_URL` set to *some* syntactically valid value in the environment — config loading does not connect to it) and hover over 10–15 names you did not script above: the `pgvector.Vector(1536)` contributed-type call, the `user_type`/`Priority` enums and their `@@type(...)` attributes, the `@@fullTextIndex([title], name: "post_title_search")` attribute and its `name:` key, the `@@discriminator(type)` / `@@base(Task, "bug")` attributes on the `Bug`/`Feature`/`Task` hierarchy, and the `BigIntNumber` / `UnboundedInt` named types. Look for anything that surprises you: a hover that renders oddly, a function or constant that silently fails the way Scenario 6 did, a declaration-line format that reads wrong for a real multi-line attribute.

**Covers:** (no specific row; surfaces unknowns)

**Time budget:** 20 minutes.

**Notes capture:** record what you tried and anything that felt off, even if you can't yet classify it. File it as a finding in the run report the same way a scripted scenario's finding would be filed.

## Sign-off coverage map

| Row | Scenario(s) | Notes |
|---|---|---|
| S1-1 model (ref + decl) | 1 | — |
| S1-2 field (with/without doc) | 1 | — |
| S1-3 named type + block (ref + decl) | 1 | — |
| S1-4 attribute (`@relation`) | 2 | — |
| S1-5 parameter (`references`) | 5 | — |
| S1-6 function (`autoincrement`) | 6 | — |
| S1-7 constant (`Cascade`) | 7 | — |
| S1-8 contributedType (`pg.Varchar` equivalent) | 3 | — |
| S1-9 block keyword | 4 | — |
| S1-10 null cases | 8 | — |
| S2-1 attribute-argument key | 5 | — |
| S2-2 function-call-argument key | (CI only) | see "Scenarios deliberately not in this script" |
| S2-3 struct-block entry key | (CI only) | see "Scenarios deliberately not in this script" |
| S2-4 function (new kind) | 6 | — |
| S2-5 constant (new kind) | 7 | — |
| S2-6 block attribute | 2 | — |
