# Manual QA — lsp-find-references (find references, go-to-definition on declaration names)

> **Be the user.** You are a schema author whose editor talks to `prisma lsp --stdio`. You ask where a model, a field or a namespace is used in a real multi-file project, and you expect the same list wherever you put the cursor.
>
> **Out of scope of this script.** Re-running `pnpm --filter @internal/language-server test`, `pnpm --filter @internal/psl-parser test` or any other CI gate. Those tests call the provider with synthetic contributions. This script drives the *built CLI* over stdio against a project on disk that loads the real postgres target through its own `prisma.config.ts`.
>
> **Spec:** `projects/lsp-find-references/spec.md` (project), `projects/lsp-find-references/slices/find-references/spec.md` (slice)
> **Plan:** `projects/lsp-find-references/slices/find-references/plan.md`
> **PR:** branch `find-usage`

## Table of contents

| # | Scenario | What it proves | Isolation | Covers |
|---|---|---|---|---|
| 1 | Model usages | `User` and `Post` return the table's usages from the declaration and from each reference, with and without the declaration, including from files the editor never opened | tmpdir | P2, P3, S5 |
| 2 | Field usages | `User.id` and `Post.authorId` return the table's usages; a same-named field on another model has its own list | tmpdir | P2, P3, P4, S5 |
| 3 | Namespace usages | `auth` returns the qualifier and both block names, whatever `includeDeclaration` says | tmpdir | P2, P3, S1 |
| 4 | Symbols with no or one reference | An unreferenced model returns nothing, or its declaration alone; an enum block returns its usage | tmpdir | P4, P5, S1 |
| 5 | Positions with no target | Attribute name, contributed type, unresolved name, keyword, comment, string and whitespace all return an empty list | tmpdir | P6 |
| 6 | Go-to-definition on declaration names | A declaration name returns itself; a namespace block name returns every block; references still go to the declaration | tmpdir | P7 |
| 7 | Unsaved edits | A reference typed into an open buffer shows up in the next result, and disappears when deleted, without saving | tmpdir | (journey; no AC) |
| 8 | Exploratory: identifier sweep | Every identifier position in the scratch project and in the shipped demo schema obeys the cross-cutting requirements | read-only | (no AC; charter) |
| O | Operator steps (VS Code, playground) | The editor shows the results; not run by the agent runner | external | project DoD "Manual check in VS Code"; project spec Open Question 1 |

> Scenarios 1 to 6 are **judgement** scenarios with an explicit oracle: the project spec's "At a glance" table. Scenario 7 is a **journey** scenario. Scenario 8 is **exploratory**. There is no guardrail in this change, so there is no negative control.
>
> AC IDs are the ones used in `projects/lsp-find-references/reviews/code-review.md`: P1 to P8 from the project spec's Definition of Done, S1 to S5 from the slice spec.

## Scenarios deliberately not in this script

| AC | Why it is not a manual-QA scenario |
|---|---|
| P1 — the binder records a `namespace` resolution on namespace block names | An internal map entry. Its user-visible effects are scenario 3 and scenario 6 step 6.3. The entry itself is a unit-test fact. |
| P5 — composite type, named type, generic block, `entityRef` argument in an attribute and in a block value | Not scripted one by one. Scenario 4 covers an enum block against the real target. Scenario 8 sweeps the demo schema, which declares a `types` block, a composite type and two enums, and checks their usage lists for consistency rather than against a written expectation. `entityRef` arguments and non-enum generic blocks are covered only by `references.test.ts` fixtures. |
| P8 — the README lists find references | A file read; the reviewer checked it. |
| S2, S3 — existing tests unchanged, `pnpm test:packages`, `pnpm lint:deps` | CI gates. |
| S4 — this script and a run report exist | Satisfied by the artefacts themselves. |

## Pre-flight

1. From the repo root: `git status --porcelain` shows nothing under `packages/`.
2. Build the CLI the editor would spawn, with its dependencies: `pnpm turbo run build --filter=@internal/cli`. The run must use this build, not an earlier one.
3. Confirm the entry exists: `ls packages/1-framework/3-tooling/cli/dist/bin.mjs`.
4. Create the scratch project under `wip/` (gitignored):

```bash
S=wip/qa-scratch/lsp-find-references-qa
mkdir -p $S/project $S/out
ln -sfn "$(pwd)/examples/prisma-8-demo/node_modules" $S/project/node_modules
```

5. Write the five files below into `$S/project/`. The three schema files are the project spec's "At a glance" project with the `// use prisma-8` directive added as line 1; `extra.prisma` adds the cases the table does not have.

### `prisma.config.ts`

```ts
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

const orm = ormConfig({ contract: './auth.prisma' });

export default definePrismaConfig({
  orm: {
    ...orm,
    contract: {
      ...orm.contract,
      source: {
        ...orm.contract.source,
        inputs: ['./auth.prisma', './session.prisma', './post.prisma', './extra.prisma'],
      },
    },
  },
});
```

### `auth.prisma`

```prisma
// use prisma-8
namespace auth {
  model User {
    id    Int    @id
    posts Post[]
  }
}
```

### `session.prisma`

```prisma
// use prisma-8
namespace auth {
  model Session {
    id     Int  @id
    userId Int
    user   User @relation(fields: [userId], references: [id])
  }
}
```

### `post.prisma`

```prisma
// use prisma-8
model Post {
  id       Int       @id
  authorId Int
  author   auth.User @relation(fields: [authorId], references: [id])

  @@index([authorId])
}
```

### `extra.prisma`

```prisma
// use prisma-8
// Orphan and Role are mentioned in this comment
enum Role {
  @@type("pg/text@1")
  Admin
  Member
}

model Orphan {
  id   Int    @id
  role Role
  note String @map("Orphan")
}

model OrphanLog {
  id      Int @id
  missing Nope
}
```

### The driver

`projects/lsp-find-references/qa/driver/qa-driver.mjs` is a dependency-free Node script. It:

1. spawns `node <cli> lsp --stdio` with the project directory as working directory and speaks LSP over the child's stdin and stdout with `Content-Length` framing;
2. sends `initialize` (root URI = the project directory, `definition.linkSupport: true`) and `initialized`, and prints the advertised `referencesProvider` and `definitionProvider`;
3. runs the steps of a JSON file in order. A `references` or `definition` step sends `textDocument/didOpen` for its file if the file is not open yet, finds the cursor from a marked anchor (`auth.Us|er`: the anchor text must occur exactly once in the file, `|` is the cursor) and sends the request. A `change` step sends a full-text `textDocument/didChange`. A `diagnostics` step prints what the server published. A `sweep` step is described in scenario 8;
4. prints each response twice: the raw JSON, then one line per location as `file:line:column  <source line with <<range>> marked>` (1-based line and column).

Usage:

```bash
node projects/lsp-find-references/qa/driver/qa-driver.mjs <cli entry> <project dir> <steps.json>
```

Step ids in the JSON files are `<scenario>.<step>` and match the tables below.

## Scenarios 1 to 6 — one server session

**Isolation:** `tmpdir` (the server reads `$S/project`; nothing is written).

**Preconditions:** pre-flight done. No dependency between scenarios; they share one server session because the steps file runs them in order.

### Steps

```bash
S=wip/qa-scratch/lsp-find-references-qa
node projects/lsp-find-references/qa/driver/qa-driver.mjs \
  packages/1-framework/3-tooling/cli/dist/bin.mjs $S/project \
  projects/lsp-find-references/qa/driver/scripted.json | tee $S/out/scripted.txt
```

The first line of output must be `capabilities: referencesProvider=true definitionProvider=true`.

Notation below: a usage is written as the source line with the returned range in `<<…>>`. "decl off / on" is `context.includeDeclaration` false / true.

## Scenario 1 — Model usages

**What you're proving from the user's seat:** the usage list of a model is the one the spec's table promises, it does not depend on where the cursor is, and it includes files the editor never opened. Steps 1.1 and 1.2 run while only `post.prisma` is open; `auth.prisma` and `session.prisma` are read from disk.

**Covers:** P2, P3, S5

**Oracle:** project spec, "At a glance" table, rows "model `User`" and "model `Post`".

| Step | File, cursor | decl | Expected locations |
|---|---|---|---|
| 1.1 | `post.prisma`, `auth.Us\|er` | off | `author   auth.<<User>> @relation(…)` in post.prisma; `user   <<User>> @relation(…)` in session.prisma |
| 1.2 | same | on | 1.1 plus `model <<User>> {` in auth.prisma |
| 1.3 | `auth.prisma`, `model Us\|er` | off | same as 1.1 |
| 1.4 | same | on | same as 1.2 |
| 1.5 | `session.prisma`, `user   Us\|er` | off | same as 1.1 |
| 1.6 | `post.prisma`, `model Po\|st` | off | `posts <<Post>>[]` in auth.prisma |
| 1.7 | same | on | 1.6 plus `model <<Post>> {` in post.prisma |
| 1.8 | `auth.prisma`, `posts Po\|st[]` | off | same as 1.6 |

### What you should see

- The marked range is exactly the model name: `User` alone in `auth.User`, never `auth.User`.
- 1.1, 1.3 and 1.5 are the same list. 1.2 and 1.4 are the same list.

### Failure modes

- A list that differs between cursor positions on the same symbol.
- A range wider or narrower than the identifier.
- A missing usage from a file that was not opened.
- The declaration present with decl off, or absent with decl on.

## Scenario 2 — Field usages

**What you're proving from the user's seat:** a field's usages are found through `@relation` and `@@index` arguments across files, and `id` on `User` is not mixed up with `id` on `Session` or `Post`.

**Covers:** P2, P3, P4, S5

**Oracle:** "At a glance" table, rows "field `id` of `User`" and "field `authorId`"; cross-cutting requirement "Symbol identity decides, text only proposes".

| Step | File, cursor | decl | Expected locations |
|---|---|---|---|
| 2.1 | `auth.prisma`, `i\|d    Int    @id` | off | `references: [<<id>>]` in post.prisma and in session.prisma |
| 2.2 | same | on | 2.1 plus `<<id>>    Int    @id` in auth.prisma |
| 2.3 | `session.prisma`, `references: [i\|d]` | off | same as 2.1 |
| 2.4 | `post.prisma`, `references: [i\|d]` | on | same as 2.2 |
| 2.5 | `post.prisma`, `author\|Id Int` | off | `fields: [<<authorId>>]` and `@@index([<<authorId>>])` in post.prisma |
| 2.6 | same | on | 2.5 plus `<<authorId>> Int` |
| 2.7 | `post.prisma`, `fields: [author\|Id]` | off | same as 2.5 |
| 2.8 | `post.prisma`, `@@index([author\|Id])` | off | same as 2.5 |
| 2.9 | `session.prisma`, `i\|d     Int  @id` (`Session.id`) | off | empty |
| 2.10 | `post.prisma`, `i\|d       Int       @id` (`Post.id`) | on | `<<id>>       Int       @id` in post.prisma only |

### What you should see

- No result of 2.1 to 2.4 contains `Session.id` or `Post.id`; 2.9 and 2.10 contain no `references: [id]` entry.
- `userId` and `authorId` never appear in a result for `id`.

### Failure modes

- A same-named field of another model in the list.
- A longer identifier (`userId`, `authorId`) reported for `id`.
- A missing `references:` entry in either file.

## Scenario 3 — Namespace usages

**What you're proving from the user's seat:** a namespace declared in two files is one symbol; its usages are the qualifier and the name of both blocks, and the answer does not change with `includeDeclaration`.

**Covers:** P2, P3, S1 (row "Namespace declared in two blocks in two files")

**Oracle:** "At a glance" table, row "namespace `auth`"; cross-cutting requirement "Namespace blocks are both declaration and usage".

| Step | File, cursor | decl | Expected locations |
|---|---|---|---|
| 3.1 | `post.prisma`, `au\|th.User` | off | `namespace <<auth>> {` in auth.prisma; `author   <<auth>>.User …` in post.prisma; `namespace <<auth>> {` in session.prisma |
| 3.2 | same | on | same as 3.1 |
| 3.3 | `auth.prisma`, `namespace au\|th` | off | same as 3.1 |
| 3.4 | `session.prisma`, `namespace au\|th` | on | same as 3.1 |

### Failure modes

- A block name missing with decl off.
- A fourth location, or `User` in `auth.User` reported for the namespace.
- Different lists from the qualifier and from a block name.

## Scenario 4 — Symbols with no or one reference

**What you're proving from the user's seat:** an unused model says so instead of listing lookalike text, and an enum of the real postgres target is found from its declaration and from its use.

**Covers:** P4, P5 (enum block only), S1 (row "Symbol with no references")

**Oracle:** slice spec edge-case rows "Name inside a longer identifier", "Name inside a comment or a string", "Symbol with no references". `extra.prisma` has `Orphan` in a `//` comment, in `@map("Orphan")` and inside `OrphanLog`.

| Step | File, cursor | decl | Expected locations |
|---|---|---|---|
| 4.1 | `extra.prisma`, `model Orph\|an {` | off | empty |
| 4.2 | same | on | `model <<Orphan>> {` only |
| 4.3 | `extra.prisma`, `enum Ro\|le` | off | `role <<Role>>` |
| 4.4 | `extra.prisma`, `role Ro\|le` | on | `enum <<Role>> {` and `role <<Role>>` |

### Failure modes

- The comment, the string or `OrphanLog` in a result.
- The enum's usage missing, or the comment's `Role` reported.

## Scenario 5 — Positions with no target

**What you're proving from the user's seat:** asking for references where there is nothing to find answers with an empty list, not an error and not a guess.

**Covers:** P6

**Oracle:** project spec non-goals ("A cursor on one of these returns an empty result") and cross-cutting requirement "Nothing to answer with means an empty result".

All steps use decl on and expect an empty list.

| Step | File, cursor | Position kind |
|---|---|---|
| 5.1 | `post.prisma`, `@rel\|ation` | attribute name |
| 5.2 | `post.prisma`, `authorId In\|t` | contributed type |
| 5.3 | `extra.prisma`, `missing No\|pe` | unresolved name |
| 5.4 | `extra.prisma`, `mo\|del Orphan {` | keyword |
| 5.5 | `extra.prisma`, `// Orp\|han and Role` | comment |
| 5.6 | `extra.prisma`, `@map("Orp\|han")` | string |
| 5.7 | `post.prisma`, `author  \| auth.User` | whitespace |

### Failure modes

- A non-empty list.
- A JSON-RPC error response, or the server exiting (the driver prints `driver error` and the server's stderr).

## Scenario 6 — Go-to-definition on declaration names

**What you're proving from the user's seat:** `textDocument/definition` on a declaration's own name now answers with that declaration, which is what makes an editor fall back to showing usages, and existing definition behaviour from references is unchanged.

**Covers:** P7

**Oracle:** project spec, cross-cutting requirement "Go-to-definition on a declaration name returns the declaration itself … For a namespace block name it returns every block".

| Step | File, cursor | Expected links (name range; target range) |
|---|---|---|
| 6.1 | `auth.prisma`, `model Us\|er` | name `model <<User>> {`; target the `model User { … }` block, auth.prisma lines 3 to 6 |
| 6.2 | `auth.prisma`, `i\|d    Int    @id` | name `<<id>>`; target `<<id    Int    @id>>` |
| 6.3 | `session.prisma`, `namespace au\|th` | two links: `namespace <<auth>> {` in auth.prisma (block lines 2 to 7) and in session.prisma (block lines 2 to 8) |
| 6.4 | `post.prisma`, `auth.Us\|er` | same link as 6.1 |
| 6.5 | `post.prisma`, `au\|th.User` | same two links as 6.3 |

### What you should see

- 6.1 and 6.2: the name range contains the cursor position, so the definition is the place the cursor already is.
- 6.3 returns both blocks, the one the cursor is on included.

### Failure modes

- `null` for 6.1, 6.2 or 6.3.
- Usages in a definition response.
- 6.4 or 6.5 different from before this change.

The steps file ends with a `diagnostics` step. Expected: one diagnostic, `PSL_UNRESOLVED_REFERENCE Cannot find type "Nope"` in `extra.prisma`, and none in the other files. Anything else means the scratch project is not the project this script describes.

## Scenario 7 — Unsaved edits

**What you're proving from the user's seat:** the list follows what is in the editor, not what is on disk. You add a model that references `auth.User` to the open `post.prisma` buffer, ask again, then delete the original reference and ask again. Nothing is saved.

**Covers:** (journey; no AC). Backs the project spec's "Whole project" requirement for the mixed case of open and unopened files.

**Isolation:** `tmpdir` (edits exist only in the server's memory; the files on disk are not written).

**Oracle:** the buffer text after each `didChange`.

**Preconditions:** pre-flight done. Independent of scenarios 1 to 6 (own server session).

### Steps

```bash
node projects/lsp-find-references/qa/driver/qa-driver.mjs \
  packages/1-framework/3-tooling/cli/dist/bin.mjs $S/project \
  projects/lsp-find-references/qa/driver/edit.json | tee $S/out/edit.txt
```

| Step | Action | Expected |
|---|---|---|
| 7.1 | references, `auth.prisma`, `model Us\|er`, decl off | the two usages of scenario 1 |
| 7.2 | `didChange` on `post.prisma`: append `model Comment { id Int @id; userId Int; writer auth.User @relation(fields: [userId], references: [id]) }` (one member per line) | — |
| 7.3 | references, `auth.prisma`, `model Us\|er`, decl off | 7.1 plus `writer auth.<<User>> …` at post.prisma line 13 |
| 7.4 | references, `auth.prisma`, `namespace au\|th`, decl off | scenario 3's three plus `writer <<auth>>.User …` |
| 7.5 | references, `auth.prisma`, `i\|d    Int    @id`, decl off | scenario 2.1's two plus `references: [<<id>>]` on the `writer` line |
| 7.6 | `didChange` on `post.prisma`: delete the `author   auth.User …` line | — |
| 7.7 | references, `auth.prisma`, `model Us\|er`, decl on | `model <<User>> {`, `writer auth.<<User>> …` (now line 12), `user   <<User>> …`; no `author` line |

### Failure modes

- A result that reflects the file on disk after an edit.
- A range that points at the pre-edit line or column.

### Restore

`git status --porcelain` must show no change from this scenario; `cat $S/project/post.prisma` still shows the pre-flight text.

## Scenario 8 — Exploratory: identifier sweep

**Charter.** Explore every identifier position of the scratch project and of the shipped demo schema (`examples/prisma-8-demo/src/prisma/contract.prisma`, real postgres target with the pgvector extension) to discover positions where find references breaks one of the cross-cutting requirements.

**Covers:** (no specific AC; surfaces unknowns)

**Isolation:** `read-only`

**Time budget:** 15 minutes.

The driver's `sweep` step opens every listed file, then for each match of `[A-Za-z_][A-Za-z0-9_]*` (keywords, comments and strings included) requests `textDocument/references` with the declaration included and `textDocument/definition` at the middle of the match. It reports a violation when:

1. references is non-empty and definition is `null`, or the reverse ("same resolution as go-to-definition");
2. a non-empty result does not contain the token the cursor is on ("cursor position does not change the answer");
3. a returned range does not cover exactly the identifier text at the cursor ("token ranges");
4. two positions listed in one result return different lists.

```bash
node projects/lsp-find-references/qa/driver/qa-driver.mjs \
  packages/1-framework/3-tooling/cli/dist/bin.mjs $S/project \
  projects/lsp-find-references/qa/driver/sweep-scratch.json | tee $S/out/sweep-scratch.txt
node projects/lsp-find-references/qa/driver/qa-driver.mjs \
  packages/1-framework/3-tooling/cli/dist/bin.mjs examples/prisma-8-demo \
  projects/lsp-find-references/qa/driver/sweep-demo.json | tee $S/out/sweep-demo.txt
```

**Notes capture:** record the counts the sweep prints, every violation verbatim, and anything in the scripted outputs that surprised you even though it matched (ordering, duplicates, timing).

## Operator steps — not run by the agent runner

These need an editor UI. The runner marks them "not run" in the report; the operator records the outcome.

**Covers:** project Definition of Done, "Manual check in VS Code"; project spec Open Question 1 (playground).

**Isolation:** `external`

**Preconditions:** a VS Code window with the Prisma 8 extension pointed at this branch's build, opened on the scratch project of the pre-flight (or any project with a namespace in two files); for O5, `pnpm --filter lsp-playground start` on this branch with a freshly seeded scratch project.

| Step | Action | Expected |
|---|---|---|
| O1 | In `post.prisma`, cursor on `User` in `auth.User`; run **Find All References** | The references view lists the usages in `post.prisma` and `session.prisma` and the declaration in `auth.prisma` (VS Code asks for the declaration). Clicking an entry opens the file with `User` selected, not `auth.User`. |
| O2 | Same position; run **Peek References** | The peek widget shows the same entries grouped by file. |
| O3 | Repeat O1 from the declaration (`model User`), on the field `id` of `User` (declaration and a `references: [id]` entry), on `auth` (a qualifier and a `namespace auth` block name) and on the enum `Role` in `extra.prisma` (declaration and `role Role`) | Each pair gives the same list. `id` lists only the two `references: [id]` entries and `User.id`. `auth` lists both block names and the qualifier. |
| O4 | Cursor on `User` in `model User`; press **F12** | VS Code shows the usages of `User` (peek or references list), because the definition is the position the cursor is on. Repeat on a `namespace auth` block name: VS Code lists both blocks. |
| O5 | Playground: with `order.prisma` selected, ask for the references of `Customer` in `Order.customer`, and of `catalog` in `catalog.Product` | The request appears in the WebSocket frames as `textDocument/references` and the response lists locations in `customer.prisma`. Record whether the editor shows the list, and whether choosing an entry in `customer.prisma` switches the sidebar selection the way a cross-file definition does. If it does not open, that is a finding for a follow-up on the playground client, not a failure of this change. |

## Sign-off coverage map

| AC ID | Scenario(s) covering it |
|---|---|
| P1 | (CI; not manual-QA scope) — see "Scenarios deliberately not in this script" |
| P2 | 1, 2, 3 |
| P3 | 1, 2, 3 |
| P4 | 2, 4 |
| P5 | 4 (enum block), 8 (named type, composite type, enums of the demo schema); `entityRef` arguments and other generic blocks CI only |
| P6 | 5 |
| P7 | 6 |
| P8 | (not manual-QA scope) |
| S1 | 3, 4; remaining rows CI only |
| S2, S3, S4 | (CI or artefact existence) |
| S5 | 1, 2, 8 |
| Project DoD "Manual check in VS Code" | O1 to O4 (operator) |
| Project spec Open Question 1 (playground) | O5 (operator) |
