# Manual QA — lsp-rename (rename symbol for entities, fields and namespaces)

> **Be the user.** You are a schema author whose editor talks to `prisma lsp --stdio`. You press F2 on a model, a field, a namespace or a block in a real multi-file project, type a new name, and expect every file to change with it, whichever occurrence the cursor was on.
>
> **Out of scope of this script.** Re-running `pnpm --filter @internal/language-server test` or any other CI gate. Those tests call the provider with synthetic contributions, or the server through an in-process connection. This script drives the *built CLI* over stdio against a project on disk that loads the real postgres target through its own `prisma.config.ts`.
>
> **Spec:** `projects/lsp-rename/spec.md` (project), `projects/lsp-rename/slices/rename/spec.md` (slice)
> **Plan:** `projects/lsp-rename/slices/rename/plan.md`
> **PR:** branch `psl-rename` (based on `find-usage`, PR #30621)

## Table of contents

| # | Scenario | What it proves | Isolation | Covers |
|---|---|---|---|---|
| 1 | Rename a model | `User` → `Account` returns the table's edit, with `@@map("User")` in the declaration's file, from the declaration and from each reference | tmpdir | DoD-2, DoD-12 |
| 2 | Rename a field | `User.id` → `uid` and `authorId` → `writerId` return the table's edits with `@map` carrying the old name; `Session.id` and `Post.id` are untouched | tmpdir | DoD-2, DoD-12 |
| 3 | Rename a namespace | `auth` → `identity` edits both block names and the qualifier, from either block and from the qualifier | tmpdir | DoD-2, DoD-6 (namespace in two files) |
| 4 | Rename an enum block; a lookalike enum member stays | An enum of the real target is renamed from its declaration and its use; a model named like an enum member does not drag the member along | tmpdir | DoD-3 (enum block only) |
| 5 | `prepareRename` | A renameable name answers with its own range and text; an attribute name and other non-renameable positions answer `null` | tmpdir | DoD-4 |
| 6 | Refused new name | A name that is not a PSL identifier is an error response that quotes it; a hyphenated name is accepted | tmpdir | DoD-5, DoD-6 (hyphen, rejected names) |
| 7 | Files the client never opened; client without `prepareSupport` | With one file open, the edit still covers the other files under their URIs; the server declares `renameProvider: true` | tmpdir | DoD-1, DoD-6 (file not open, client without `prepareSupport`) |
| 8 | Apply the edit and keep working | After applying each of the four table renames in turn, map attributes included, diagnostics stay empty and find references on the new name returns the renamed positions | tmpdir | (journey; no AC) |
| 9 | Rename to a name already declared | The edit is returned; the duplicate-declaration diagnostic appears afterwards | tmpdir | DoD-6 (name already declared) |
| 10 | Exploratory: identifier sweep | Every identifier position in the scratch project and in the shipped demo schema obeys the cross-cutting requirements | read-only | (no AC; charter) |
| 11 | Applied renames keep the storage names | A model, a scalar field and a `native_enum` block are renamed and applied; each edit carries the map attribute, diagnostics stay empty, the formatter leaves the attribute in place, and the emitted contract has the same storage as before | tmpdir | DoD-12, DoD-13, DoD-14, DoD-15 |
| 12 | Renames that get no map attribute | A relation field in both directions, a model with `@@base`, a namespace, a `role` block, a model and a field that already have one, and a rename to the current name return name edits only | tmpdir | DoD-12 |
| 13 | Navigation and diagnostics on a `pg.enum(…)` argument | Go-to-definition and find references work on the enum name inside `pg.enum(…)`; an unknown name is reported once; a `native_enum` of another namespace is refused while navigation still works | tmpdir | slice `type-constructor-refs` |
| V | Operator steps: VS Code | F2 in the editor applies the edit across files; not run by the agent runner | external | DoD-10 |
| P | Operator steps: playground | Rename across scratch files with one never selected; not run by the agent runner | external | DoD-8 |

> Scenarios 1 to 7 and 9 are **judgement** scenarios with an explicit oracle: the project spec's "At a glance" table, its cross-cutting requirements and the slice spec's edge-case table. Scenario 8 is a **journey** scenario. Scenario 10 is **exploratory**. The refused-name check of scenario 6 is the one guard this change adds; its coverage boundary is stated there.
>
> AC IDs are the ones used in `projects/lsp-rename/reviews/code-review.md`: DoD-1 to DoD-15.
>
> Scenarios 1 to 10 run against scratch project A (the "At a glance" project). Scenarios 11 and 12 run against scratch project B, which adds Postgres-specific declarations.

## Scenarios deliberately not in this script

| AC | Why it is not a manual-QA scenario |
|---|---|
| DoD-3 — composite type, named type, generic block | Not scripted one by one. Scenario 4 covers an enum block against the real target. Scenario 10 sweeps the demo schema, which declares a `types` block, a composite type and two enums, and checks their edits for consistency with find references rather than against a written expectation. A non-enum generic block exists only in the fixtures of `rename.test.ts`. |
| DoD-4 — `prepareRename` on a cross-space reference | The scratch project has one contract space. Covered by `rename.test.ts`. |
| DoD-6 — model and namespace with the same name (`auth.auth`) | Covered by `rename.test.ts`; not added to the scratch project to keep the table rows readable. |
| DoD-7 — `references.ts`, `cursor-resolution.ts`, psl-parser unchanged | A `git diff`; the reviewer checked it. |
| DoD-12 — a field typed by a model of another contract space; a control stack that defines no `map` | The scratch projects have one contract space and the real Postgres stack defines `map`. Covered by `rename.test.ts`. |
| DoD-13 — formatter options with tabs and CRLF, a one-line model, an unterminated model | Covered by `rename.test.ts`; not repeated against the real target. |
| DoD-14 — Mongo | The scratch projects use the Postgres target. Covered by the Mongo interpreter test. |
| DoD-9 — READMEs | A file read; the reviewer checked it. |
| DoD-11 — team gates | CI gates. |

## Pre-flight

1. From the repo root: `git status --porcelain` shows nothing under `packages/` or `apps/`.
2. Build the workspace: `pnpm build`. The run must use this build, not an earlier one. Building only the CLI (`--filter=@internal/cli`) is not enough: the scratch projects load the Postgres target through `@prisma/orm-postgres`, which is outside the CLI's build graph, so the interpreter would be a stale one.
3. Confirm the entry exists: `ls packages/1-framework/3-tooling/cli/dist/bin.mjs`.
4. Create the scratch project under `wip/` (gitignored):

```bash
S=wip/qa-scratch/lsp-rename-qa
mkdir -p $S/project $S/out
ln -sfn "$(pwd)/examples/prisma-8-demo/node_modules" $S/project/node_modules
```

5. Write the five files below into `$S/project/` (scratch project A). The three schema files are the project spec's "At a glance" project with the `// use prisma-8` directive added as line 1; `extra.prisma` adds an enum, and a model whose name is also an enum member, a word in a comment and a string.

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
// Role and Member are mentioned in this comment
enum Role {
  @@type("pg/text@1")
  Admin
  Member
}

model Member {
  id   Int    @id
  role Role
  note String @map("Member")
}
```

### Scratch project B (scenarios 11 and 12)

```bash
M=wip/qa-scratch/lsp-rename-qa-map
mkdir -p $M/project $M/out
ln -sfn "$(pwd)/examples/prisma-8-demo/node_modules" $M/project/node_modules
cp $S/project/auth.prisma $S/project/session.prisma $S/project/post.prisma $M/project/
```

Its `prisma.config.ts` is the one above with `inputs: ['./auth.prisma', './session.prisma', './post.prisma', './shop.prisma', './roles.prisma']`. Two more files:

#### `shop.prisma`

```prisma
// use prisma-8
native_enum OrderStatus {
  pending = "pending"
  shipped = "shipped"
}

model Order {
  id     Int                  @id
  status pg.enum(OrderStatus)
  note   String               @map("order_note")

  @@map("orders")
}

model Task {
  id   Int    @id
  kind String

  @@discriminator(kind)
}

model Bug {
  severity Int

  @@base(Task, "bug")
}
```

#### `roles.prisma`

```prisma
// use prisma-8
namespace unbound {
  role app_user {
  }
}
```

After writing the files, make three copies for the "after" states of scenario 11:

```bash
for d in after-model after-field after-enum; do cp -a $M/project $M/$d; done
```

### The driver

`projects/lsp-rename/qa/driver/qa-driver.mjs` is the find-references QA driver (`projects/lsp-find-references/qa/driver/qa-driver.mjs`) extended for rename. It is a dependency-free Node script. It:

1. spawns `node <cli> lsp --stdio` with the project directory as working directory and speaks LSP over the child's stdin and stdout with `Content-Length` framing;
2. sends `initialize` (root URI = the project directory, `textDocument.rename.prepareSupport` true unless the steps file says `"prepareSupport": false`) and `initialized`, and prints the advertised `renameProvider` and `referencesProvider`;
3. runs the steps of a JSON file in order. A `rename`, `prepareRename`, `references` or `definition` step sends `textDocument/didOpen` for its own file if that file is not open yet, finds the cursor from a marked anchor (`auth.Us|er`: the anchor text must occur exactly once in the file, `|` is the cursor) and sends the request. No other file is opened by a request step;
4. prints each response as raw JSON, then rendered. A `WorkspaceEdit` is rendered per file, with whether the driver has that file open, and one line per edit as `file:line:column  <source line with <<old -> new>> marked>` (1-based). An error response is printed as `error response: {code, message}`;
5. for a `rename` step with `"apply": true`, applies the returned edits to its own copy of each file and tells the server: `didChange` with the full new text for a file that is open, `didOpen` with the text on disk followed by `didChange` for a file that is not. Nothing is written to disk;
6. for a `references` step with `"compareWithApplied": true`, prints whether the returned locations are exactly the ranges the last applied edit produced (start of each edit, length of the new name);
7. a `diagnostics` step waits 1.5 s and prints the latest `publishDiagnostics` per file. A `sweep` step is described in scenario 10;
8. an edit whose new text spans lines (the `@@map` line) is rendered as `file:line:column  insert "<text>" before "<rest of the line>"`. A `references` step with `"compareWithApplied": true` compares against the name edits of the last applied edit, not the insertion;
9. a `format` step sends `textDocument/formatting` for a file, applies the returned edits to its copy, tells the server, and prints the resulting text;
10. a `save` step writes the driver's current text of every project file into another directory (a copy of the project), so that the CLI can emit a contract from the renamed text.

`projects/lsp-rename/qa/driver/compare-storage.mjs <before dir> <after dir>…` reads `contract.json` from each directory and prints the storage hash, the storage names (namespace, entry kind, entry, columns, type name) and whether the `storage` section is equal to the first one.

Usage:

```bash
node projects/lsp-rename/qa/driver/qa-driver.mjs <cli entry> <project dir> <steps.json>
```

Step ids in the JSON files are `<scenario>.<step>` and match the tables below. Notation: an edit is written as the source line with the replaced range and the new text in `<<old -> new>>`.

## Scenarios 1 to 6 — one server session

**Isolation:** `tmpdir` (the server reads `$S/project`; nothing is written).

**Preconditions:** pre-flight done. No dependency between scenarios; they share one server session because the steps file runs them in order. No step applies an edit, so every request sees the pre-flight text.

### Steps

```bash
S=wip/qa-scratch/lsp-rename-qa
node projects/lsp-rename/qa/driver/qa-driver.mjs \
  packages/1-framework/3-tooling/cli/dist/bin.mjs $S/project \
  projects/lsp-rename/qa/driver/scripted.json | tee $S/out/scripted.txt
```

The first line of output must be `capabilities: renameProvider={"prepareProvider":true} referencesProvider=true`.

The steps file ends with a `diagnostics` step. Expected: no diagnostic in any file. Anything else means the scratch project is not the project this script describes.

## Scenario 1 — Rename a model

**What you're proving from the user's seat:** renaming `User` changes the declaration and both references in three files, and the edit is the same wherever the cursor was.

**Covers:** DoD-2

**Oracle:** project spec, "At a glance" table, row "model `User` → `Account`"; cross-cutting requirements "One token per edit" and "Cursor position does not change the answer".

| Step | File, cursor | New name | Expected edits |
|---|---|---|---|
| 1.1 | `auth.prisma`, `model Us\|er` | `Account` | `model <<User -> Account>> {` and `insert "\n    @@map(\"User\")\n" before "}"` in auth.prisma; `user   <<User -> Account>> @relation(…)` in session.prisma; `author   auth.<<User -> Account>> @relation(…)` in post.prisma |
| 1.2 | `session.prisma`, `user   Us\|er` | `Account` | same as 1.1 |
| 1.3 | `post.prisma`, `auth.Us\|er` | `Account` | same as 1.1 |

### What you should see

- Three name edits, one per file, each replacing `User` alone: in `auth.User` the qualifier and the dot are outside the range.
- One insertion, in auth.prisma whatever file the cursor was in: a line break, two indent units of the project's formatter options (four spaces here, the default), `@@map("User")` and a line break, before the model's closing brace. In this file that reads as a blank line and the attribute at the indent of the model's fields.
- The response uses `changes` keyed by file URI, not `documentChanges`.
- The raw JSON of 1.1, 1.2 and 1.3 is identical.

### Failure modes

- An edit list that differs between cursor positions.
- A range wider or narrower than the identifier.
- A file missing from the edit.
- No `@@map("User")`, more than one, or one in a file other than auth.prisma.

## Scenario 2 — Rename a field

**What you're proving from the user's seat:** a field is renamed through `@relation` and `@@index` arguments across files, and `id` on `User` is not mixed up with `id` on `Session` or `Post`.

**Covers:** DoD-2

**Oracle:** "At a glance" table, rows "field `id` of `User` → `uid`" and "field `authorId` → `writerId`".

| Step | File, cursor | New name | Expected edits |
|---|---|---|---|
| 2.1 | `auth.prisma`, `i\|d    Int    @id` | `uid` | `<<id -> uid>>    Int    @id` and the insertion ` @map("id")` after `@id` in auth.prisma; `references: [<<id -> uid>>]` in session.prisma and in post.prisma |
| 2.2 | `session.prisma`, `references: [i\|d]` | `uid` | same as 2.1 |
| 2.3 | `post.prisma`, `references: [i\|d]` | `uid` | same as 2.1 |
| 2.4 | `post.prisma`, `author\|Id Int` | `writerId` | `<<authorId -> writerId>> Int`, `fields: [<<authorId -> writerId>>]`, `@@index([<<authorId -> writerId>>])` and the insertion ` @map("authorId")` after `Int`, all in post.prisma |
| 2.5 | `post.prisma`, `fields: [author\|Id]` | `writerId` | same as 2.4 |
| 2.6 | `post.prisma`, `@@index([author\|Id])` | `writerId` | same as 2.4 |

### What you should see

- 2.1 to 2.3: exactly three name edits and one insertion. No edit on `id     Int  @id` in session.prisma or `id       Int       @id` in post.prisma, and none inside `userId` or `authorId`.
- 2.4 to 2.6: three name edits and one insertion under the one URI of post.prisma. The insertion is one space and the attribute, with no column alignment.

### Failure modes

- A same-named field of another model in the edit.
- An edit inside a longer identifier.
- A missing `references:`, `fields:` or `@@index` entry.

## Scenario 3 — Rename a namespace

**What you're proving from the user's seat:** a namespace declared in two files is one symbol; renaming it changes both block names and every qualifier.

**Covers:** DoD-2, DoD-6 (row "Namespace declared in two blocks in two files")

**Oracle:** "At a glance" table, row "namespace `auth` → `identity`".

| Step | File, cursor | New name | Expected edits |
|---|---|---|---|
| 3.1 | `auth.prisma`, `namespace au\|th` | `identity` | `namespace <<auth -> identity>> {` in auth.prisma and in session.prisma; `author   <<auth -> identity>>.User …` in post.prisma |
| 3.2 | `session.prisma`, `namespace au\|th` | `identity` | same as 3.1 |
| 3.3 | `post.prisma`, `au\|th.User` | `identity` | same as 3.1 |

### Failure modes

- A block name missing.
- `User` in `auth.User` edited for the namespace.
- Different edits from a block name and from the qualifier.

## Scenario 4 — Rename an enum block; a lookalike enum member stays

**What you're proving from the user's seat:** an enum of the real postgres target is renamed from its declaration and from its use. `extra.prisma` also has a model `Member`, an enum member `Member`, the word in a comment and in `@map("Member")`; renaming the model must touch only the model.

**Covers:** DoD-3 (enum block only)

**Oracle:** project spec non-goal "Enum members"; cross-cutting requirements "Name edits equal references" and "Nothing else gets one" (an enum block gets no map attribute).

| Step | File, cursor | New name | Expected edits |
|---|---|---|---|
| 4.1 | `extra.prisma`, `enum Ro\|le` | `Rank` | `enum <<Role -> Rank>> {` and `role <<Role -> Rank>>` |
| 4.2 | `extra.prisma`, `role Ro\|le` | `Rank` | same as 4.1 |
| 4.3 | `extra.prisma`, `model Memb\|er` | `Person` | `model <<Member -> Person>> {` and `insert "\n  @@map(\"Member\")\n" before "}"`; nothing else |

### Failure modes

- The comment's `Role` or `Member` edited.
- The enum member `Member` or the string `"Member"` edited in 4.3.

## Scenario 5 — `prepareRename`

**What you're proving from the user's seat:** before the editor shows the rename box it asks whether the position can be renamed. On a renameable name it gets the name's own range and text (the box is pre-filled with it); on anything else it gets `null` and the editor refuses.

**Covers:** DoD-4

**Oracle:** project spec, "`textDocument/prepareRename` answers whether the position can be renamed: the range of the identifier token under the cursor for the symbols above, `null` anywhere else"; non-goals "Enum members" and "Symbols with no declaration in the schema sources".

| Step | File, cursor | Position kind | Expected |
|---|---|---|---|
| 5.1 | `post.prisma`, `auth.Us\|er` | model reference | range `auth.<<User>>`, placeholder `User` |
| 5.2 | `auth.prisma`, `model Us\|er` | model declaration | range `model <<User>> {`, placeholder `User` |
| 5.3 | `post.prisma`, `au\|th.User` | namespace qualifier | range `<<auth>>.User`, placeholder `auth` |
| 5.4 | `post.prisma`, `author\|Id Int` | field declaration | range `<<authorId>> Int`, placeholder `authorId` |
| 5.5 | `extra.prisma`, `enum Ro\|le` | enum block | range `enum <<Role>> {`, placeholder `Role` |
| 5.6 | `post.prisma`, `@rel\|ation` | attribute name | `null` |
| 5.7 | `post.prisma`, `authorId In\|t` | contributed type | `null` |
| 5.8 | `extra.prisma`, `Adm\|in` | enum member | `null` |
| 5.9 | `post.prisma`, `mo\|del Post {` | keyword | `null` |
| 5.10 | `post.prisma`, `author  \| auth.User` | whitespace | `null` |

### Failure modes

- A range other than the identifier under the cursor, or a placeholder other than its text.
- A range on 5.6 to 5.10.
- An error response instead of `null`.

## Scenario 6 — Refused new name (negative control)

**What you're proving from the user's seat:** typing something that is not a name gets a message that says so and quotes what was typed, and nothing is edited.

**Covers:** DoD-5, DoD-6 (rows "`-` in the new name" and "`NaN`, `Infinity`, a name starting with a digit, an empty string, a name with a `.`")

**Oracle:** project spec, cross-cutting requirement "Only identifiers are accepted. A new name for which `isPslIdentifier` is false is an error response with a message naming the rejected text"; failure state "No edit is returned".

| Step | File, cursor | New name | Expected |
|---|---|---|---|
| 6.1 | `post.prisma`, `auth.Us\|er` | `NaN` | error response, code `-32803` (`RequestFailed`), message quotes `NaN` |
| 6.2 | same | `Infinity` | error response quoting `Infinity` |
| 6.3 | same | `1st` | error response quoting `1st` |
| 6.4 | same | empty string | error response quoting the empty string |
| 6.5 | same | `auth.Account` | error response quoting `auth.Account` |
| 6.6 | same | `My Model` | error response quoting `My Model` |
| 6.7 | same | `user-profile` | accepted: the edits of scenario 1 with `user-profile`, `@@map("User")` included |
| 6.8 | `post.prisma`, `@rel\|ation` | `1st` | error response quoting `1st` (the name is checked before the position) |
| 6.9 | `post.prisma`, `@rel\|ation` | `link` | `null` |

**Coverage boundary.** This proves the check fires for these six texts and lets a hyphenated name through. It does not prove every non-identifier is refused; the rule is the tokenizer's `isPslIdentifier`, tested in `psl-parser`.

### What you should see

- The message reads as something an editor can show as is. Judge the wording: does it tell the user what is wrong with what they typed?
- After the refusals the server still answers (6.7, 6.9) and the closing `diagnostics` step shows no diagnostic.

### Failure modes

- A result (edit or `null`) for 6.1 to 6.6.
- A message that does not contain the rejected text.
- The server exiting, or a later request failing (the driver prints `driver error` and the server's stderr).

## Scenario 7 — Files the client never opened; client without `prepareSupport`

**What you're proving from the user's seat:** with only `post.prisma` open in the editor, a rename still reaches `auth.prisma` and `session.prisma`, addressed by their own URIs. The session also declares no `prepareSupport`, as an older client would.

**Covers:** DoD-1, DoD-6 (rows "A usage in a file that is not open" and "Client without `prepareSupport`")

**Isolation:** `tmpdir`

**Oracle:** cross-cutting requirement "Whole project"; slice spec, "The server declares `renameProvider: { prepareProvider: true }` when the client has `prepareSupport`, and `renameProvider: true` otherwise".

**Preconditions:** pre-flight done. Own server session.

### Steps

```bash
node projects/lsp-rename/qa/driver/qa-driver.mjs \
  packages/1-framework/3-tooling/cli/dist/bin.mjs $S/project \
  projects/lsp-rename/qa/driver/unopened.json | tee $S/out/unopened.txt
```

| Step | File, cursor | New name | Expected |
|---|---|---|---|
| — | capabilities line | — | `renameProvider=true` |
| 7.1 | `post.prisma`, `auth.Us\|er` | `Account` | the edits of scenario 1, the `@@map("User")` insertion in auth.prisma included; auth.prisma and session.prisma marked "not open in the client" |
| 7.2 | `post.prisma`, `au\|th.User` | `identity` | the three edits of scenario 3; same two files not open |
| 7.3 | `post.prisma`, `references: [i\|d]` | `uid` | the edits of scenario 2.1, the ` @map("id")` insertion in auth.prisma included; same two files not open |

### Failure modes

- An edit that covers only the open file.
- `renameProvider` in the options form for this client, or missing.

## Scenario 8 — Apply the edit and keep working

**What you're proving from the user's seat:** the edit is not only well-formed, it is right: after the editor applies it, the project still has no errors, and asking for the usages of the new name gives the places that were just changed. The four renames of the table are applied one after the other, so each later rename works on text the earlier ones produced.

**Covers:** (journey; no AC). Backs the project spec's "Edits equal references" requirement and the failure state "Edits for files that are not open are computed from the text on disk".

**Isolation:** `tmpdir` (edits exist only in the driver's and the server's memory; the files on disk are not written).

**Oracle:** the text of each file after the edit; an empty diagnostics list; the edited ranges.

**Preconditions:** pre-flight done. Own server session.

### Steps

```bash
node projects/lsp-rename/qa/driver/qa-driver.mjs \
  packages/1-framework/3-tooling/cli/dist/bin.mjs $S/project \
  projects/lsp-rename/qa/driver/apply.json | tee $S/out/apply.txt
```

| Step | Action | Expected |
|---|---|---|
| 8.1 | rename `post.prisma`, `auth.Us\|er` → `Account`, apply | three name edits and `@@map("User")`; auth.prisma and session.prisma are opened by the apply |
| 8.2 | diagnostics | none in any file |
| 8.3 | references, `auth.prisma`, `model Acc\|ount`, declaration included | three locations, each covering `Account`; "same positions as the applied edit: yes" |
| 8.4 | rename `auth.prisma`, `namespace au\|th` → `identity`, apply | three name edits and no map attribute; the post.prisma line already reads `auth.Account` |
| 8.5 | diagnostics | none |
| 8.6 | references, `post.prisma`, `ident\|ity.Account` | both block names and the qualifier; same positions: yes |
| 8.7 | rename `session.prisma`, `references: [i\|d]` → `uid`, apply | three name edits and ` @map("id")` in auth.prisma |
| 8.8 | diagnostics | none |
| 8.9 | references, `auth.prisma`, `ui\|d    Int    @id` | three locations; same positions: yes |
| 8.10 | rename `post.prisma`, `@@index([author\|Id])` → `writerId`, apply | three name edits and ` @map("authorId")` in post.prisma |
| 8.11 | diagnostics | none |
| 8.12 | references, `post.prisma`, `writer\|Id Int` | three locations; same positions: yes |

### Failure modes

- A diagnostic after an applied edit.
- A references result that differs from the applied ranges.
- An edit computed against text from before an earlier apply (ranges pointing at old columns).

### Restore

`git status --porcelain` shows no change from this scenario; `cat $S/project/post.prisma` still shows the pre-flight text.

## Scenario 9 — Rename to a name already declared

**What you're proving from the user's seat:** the server does not stop you from renaming onto an existing name; the editor shows the conflict afterwards through the ordinary diagnostic.

**Covers:** DoD-6 (row "New name is already declared in the same scope")

**Isolation:** `tmpdir`

**Oracle:** project spec non-goal "Collision checks": "Renaming to a name that is already declared, or to one that changes how another reference resolves, is not rejected. The result is reported by the existing diagnostics (`Duplicate declaration of "…"`), and the user undoes the edit."

**Preconditions:** pre-flight done. Own server session.

### Steps

```bash
node projects/lsp-rename/qa/driver/qa-driver.mjs \
  packages/1-framework/3-tooling/cli/dist/bin.mjs $S/project \
  projects/lsp-rename/qa/driver/collision.json | tee $S/out/collision.txt
```

| Step | Action | Expected |
|---|---|---|
| 9.1 | diagnostics before | none |
| 9.2 | rename `extra.prisma`, `model Memb\|er` → `Post`, apply | `model <<Member -> Post>> {` and the `@@map("Member")` insertion; no error response |
| 9.3 | diagnostics | a `PSL_DUPLICATE_DECLARATION` diagnostic, `Duplicate declaration of "Post"` |
| 9.4 | prepareRename `extra.prisma`, `model Po\|st` | record what is returned |
| 9.5 | rename `extra.prisma`, `model Po\|st` → `Member`, not applied | record the edit: this is what a user gets who renames back instead of undoing |
| 9.6 | rename `auth.prisma`, `posts Po\|st[]` → `Article`, not applied | record the edit: which of the two `Post` models the existing reference now belongs to |

The spec gives no expectation for 9.4 to 9.6. Record the responses verbatim, and in 9.3 record on which of the two declarations the diagnostic sits and what else is reported.

### Failure modes

- An error response or `null` for 9.2.
- No duplicate-declaration diagnostic in 9.3.

### Restore

`git status --porcelain` shows no change from this scenario.

## Scenario 10 — Exploratory: identifier sweep

**Charter.** Explore every identifier position of the scratch project and of the shipped demo schema (`examples/prisma-8-demo/src/prisma/contract.prisma`, real postgres target with the pgvector extension) to discover positions where rename breaks one of the cross-cutting requirements.

**Covers:** (no specific AC; surfaces unknowns)

**Isolation:** `read-only`

**Time budget:** 15 minutes.

The driver's `sweep` step opens every listed file, then for each match of `[A-Za-z_][A-Za-z0-9_-]*` (keywords, comments and strings included) requests `textDocument/references` with the declaration included, `textDocument/prepareRename` and `textDocument/rename` with the new name `Renamed`, at the middle of the match. Nothing is applied. It reports a violation when:

1. `prepareRename` returns a range and `rename` returns `null`, or the reverse ("`prepareRename` and `rename` agree");
2. `rename` returns an edit and references is empty, or the reverse;
3. the ranges of the edits whose text is the new name, in order, are not the references locations ("Name edits equal references");
4. the edit holds more than one edit whose text is not the new name, or that edit does not contain `map("<the identifier>")`, or it is in a file with no name edit ("At most one insertion");
5. the `prepareRename` range is not the token under the cursor, or the placeholder is not its text;
6. the edit does not contain the token under the cursor, or one of its ranges does not cover that identifier's text ("One token per edit").

```bash
node projects/lsp-rename/qa/driver/qa-driver.mjs \
  packages/1-framework/3-tooling/cli/dist/bin.mjs $S/project \
  projects/lsp-rename/qa/driver/sweep-scratch.json | tee $S/out/sweep-scratch.txt
node projects/lsp-rename/qa/driver/qa-driver.mjs \
  packages/1-framework/3-tooling/cli/dist/bin.mjs examples/prisma-8-demo \
  projects/lsp-rename/qa/driver/sweep-demo.json | tee $S/out/sweep-demo.txt
node projects/lsp-rename/qa/driver/qa-driver.mjs \
  packages/1-framework/3-tooling/cli/dist/bin.mjs $M/project \
  projects/lsp-rename/qa/driver/sweep-map.json | tee $M/out/sweep-map.txt
```

The sweep also prints how many distinct symbols carry a map attribute in their edit.

**Notes capture:** record the counts the sweep prints, every violation verbatim, and anything in the scripted outputs that surprised you even though it matched.

## Scenario 11 — Applied renames keep the storage names

**What you're proving from the user's seat:** you rename a model, a field and a Postgres enum type in a project that already has a database, and nothing in the database has to change: the next `contract emit` describes the same storage. The rename is started from a reference in another file, so the attribute has to land in the declaration's file.

**Covers:** DoD-12, DoD-13, DoD-14, DoD-15

**Isolation:** `tmpdir` (the driver writes only into the three copies under `$M/`).

**Oracle:** project spec, Purpose ("A rename that would change a database name also adds `@map` / `@@map` with the old name to the declaration, so the database keeps its names") and the cross-cutting requirements "When a map attribute is added", "Where the attribute goes" and "At most one insertion". The contract comparison uses the real path: `prisma contract emit` of the built CLI in a copy of the project that holds the renamed text.

**Preconditions:** pre-flight done, scratch project B and its three copies in place. Own server session.

### Steps

```bash
C=$(pwd)/packages/1-framework/3-tooling/cli/dist/bin.mjs
node projects/lsp-rename/qa/driver/qa-driver.mjs $C $M/project \
  projects/lsp-rename/qa/driver/map-apply.json | tee $M/out/map-apply.txt
for d in project after-model after-field after-enum; do
  (cd $M/$d && node $C contract emit --output-path ../out/contract-$d > ../out/emit-$d.txt 2>&1; echo "emit $d exit $?")
done
node projects/lsp-rename/qa/driver/compare-storage.mjs \
  $M/out/contract-project $M/out/contract-after-model $M/out/contract-after-field $M/out/contract-after-enum \
  | tee $M/out/compare.txt
```

| Step | Action | Expected |
|---|---|---|
| 11.1 | diagnostics, `post.prisma` open | none in any file |
| 11.2 | rename `post.prisma`, `auth.Us\|er` → `Account`, apply | three name edits; `@@map("User")` inserted in auth.prisma, which is not open |
| 11.3 | diagnostics | none |
| 11.4 | references, `auth.prisma`, `model Acc\|ount` | the three renamed positions; same positions: yes |
| 11.5 | format `auth.prisma` | no edit; the text shows a blank line and `@@map("User")` after `posts Post[]` |
| 11.6 | save to `after-model` | — |
| 11.7 | rename `post.prisma`, `author\|Id Int` → `writerId`, apply | three name edits and ` @map("authorId")` after `Int` |
| 11.8 | diagnostics | none |
| 11.9 | format `post.prisma` | the formatter may realign the rows; `@map("authorId")` stays on the `writerId` line |
| 11.10 | save to `after-field` | — |
| 11.11 | rename `shop.prisma`, `pg.enum(Order\|Status)` → `Stage`, not applied | the edit of 11.12: the answer does not depend on the cursor position |
| 11.12 | rename `shop.prisma`, `native_enum Order\|Status` → `Stage`, apply | the block name, the `pg.enum(OrderStatus)` argument, and `@@map("OrderStatus")` inserted after a blank line before the block's closing brace |
| 11.13 | diagnostics | none |
| 11.14 | format `shop.prisma` | no edit to the `@@map("OrderStatus")` line |
| 11.15 | save to `after-enum` | — |
| 11.16 | rename `auth.prisma`, `model Acc\|ount` → `Member`, not applied | three name edits and no second `@@map` |
| emit | `contract emit` in the four directories | exit 0 four times |
| compare | `compare-storage.mjs` | `after-model` and `after-field`: storage names equal: yes; storage section equal: yes; the same storage hash. `after-enum`: the enum type keeps its name (`public.native_enum.OrderStatus`, `typeName=OrderStatus`) and every table and column name is unchanged. Known and not addressed by this project: the `valueSet` entry is keyed by the block name, so it becomes `public.valueSet.Stage`, the `status` column's value-set reference follows, and the storage hash differs. Record exactly which entries differ; anything beyond these three is a finding |

### What you should see

- Each of 11.2, 11.7 and 11.12 holds exactly one edit that is not a name edit, and it is in the file of the declaration.
- The domain side changes (the model is `Account`, the field is `writerId`) while the tables, columns and the enum type keep their names.

### Failure modes

- A diagnostic after an applied rename.
- A contract that fails to emit, or whose storage differs from the one emitted before the rename in anything but the value-set entry key described in the compare step.
- A map attribute missing, duplicated, or moved or removed by the formatter.
- A usage of the renamed symbol left with the old name.

### Restore

`git status --porcelain` shows no change from this scenario; `$M/project` still holds the pre-flight text (the driver writes only into the copies).

## Scenario 12 — Renames that get no map attribute

**What you're proving from the user's seat:** the attribute appears only where it keeps a database name. Where it would be wrong or pointless, the rename changes names and nothing else.

**Covers:** DoD-12

**Isolation:** `tmpdir` (nothing is applied or written).

**Oracle:** project spec, cross-cutting requirements "Nothing else gets one" and "A rename to the current name adds nothing", and "When a map attribute is added" ("when the declaration has no `map` attribute").

**Preconditions:** pre-flight done, scratch project B in place. Own server session.

### Steps

```bash
node projects/lsp-rename/qa/driver/qa-driver.mjs $C $M/project \
  projects/lsp-rename/qa/driver/map-none.json | tee $M/out/map-none.txt
```

Every step expects name edits only: no line starting with `insert`, no `@map` in a new text.

| Step | File, cursor | New name | Declaration kind |
|---|---|---|---|
| 12.1 | `post.prisma`, `aut\|hor   auth.User` | `writer` | relation field holding the foreign key |
| 12.2 | `auth.prisma`, `pos\|ts Post[]` | `articles` | back-relation field |
| 12.3 | `shop.prisma`, `model Bu\|g` | `Defect` | model with `@@base` |
| 12.4 | `auth.prisma`, `namespace au\|th` | `identity` | namespace |
| 12.5 | `roles.prisma`, `role app_us\|er` | `member` | `role` block (its descriptor does not set `nameIsStorageName`) |
| 12.6 | `shop.prisma`, `model Ord\|er {` | `Purchase` | model that has `@@map("orders")` |
| 12.7 | `shop.prisma`, `no\|te   String` | `remark` | field that has `@map("order_note")` |
| 12.8 | `auth.prisma`, `model Us\|er` | `User` | rename to the current name |

### Failure modes

- A map attribute in any of these edits.
- A second map attribute on 12.6 or 12.7.

## Scenario 13 — Navigation and diagnostics on a `pg.enum(…)` argument

**What you're proving from the user's seat:** the enum name inside `pg.enum(…)` behaves like any other reference: F12 goes to the `native_enum`, the usages list contains it, a typo is reported once, and a reference the interpreter refuses is still a reference the editor can follow.

**Covers:** slice `type-constructor-refs`, done conditions on navigation and on the transitional refusal.

**Isolation:** `tmpdir` (edits exist only in the driver's and the server's memory).

**Oracle:** slice spec `projects/lsp-rename/slices/type-constructor-refs/spec.md`: "Go-to-definition, hover, find references and rename then work on such a name with no change of their own"; "an unknown name: `PSL_UNRESOLVED_REFERENCE`, `Cannot find entity "X"`, anchored on the argument"; the table "What changes for schema authors", row "an entity of another namespace": "the same diagnostic; navigation and rename work on the name".

**Preconditions:** pre-flight done, scratch project B in place. Own server session.

### Steps

```bash
node projects/lsp-rename/qa/driver/qa-driver.mjs $C $M/project \
  projects/lsp-rename/qa/driver/enum-refs.json | tee $M/out/enum-refs.txt
```

| Step | Action | Expected |
|---|---|---|
| 13.1 | definition, `shop.prisma`, `pg.enum(Order\|Status)` | `native_enum <<OrderStatus>> {` |
| 13.2 | references, same position, declaration included | the declaration and `status pg.enum(<<OrderStatus>>)` |
| 13.3 | references, `native_enum Order\|Status`, declaration excluded | `status pg.enum(<<OrderStatus>>)` alone |
| 13.4 | prepareRename, `pg.enum(Order\|Status)` | the range of `OrderStatus` inside the parentheses, placeholder `OrderStatus` |
| 13.5 | `didChange` on `shop.prisma`: `pg.enum(OrderStatus)` → `pg.enum(NoSuchEnum)` | — |
| 13.6 | diagnostics | exactly one, in `shop.prisma`, on the argument: `PSL_UNRESOLVED_REFERENCE Cannot find entity "NoSuchEnum"` |
| 13.7 | `didChange` back | — |
| 13.8 | `didChange` on `session.prisma`: add `status pg.enum(OrderStatus)` to `model Session` inside `namespace auth` | — |
| 13.9 | diagnostics | exactly one, in `session.prisma`: `PSL_UNKNOWN_ENTITY_REF`, `Field "Session.status" type constructor "pg.enum(OrderStatus)" does not resolve — no entity named "OrderStatus" was found in namespace "auth"` (the diagnostic `main` gives for an entity of another namespace); none in `shop.prisma` |
| 13.10 | definition, `session.prisma`, `pg.enum(Order\|Status)` | `native_enum <<OrderStatus>> {` in `shop.prisma` |

### What you should see

- 13.6: one line, not two.
- 13.9 and 13.10 together: the interpreter refuses the reference while the editor still follows it.

### Failure modes

- No definition or an empty usage list on the argument.
- Two diagnostics for the unknown name, or one that is not anchored on the argument.
- No refusal in 13.9, or a refusal that makes 13.10 return nothing.

### Restore

`git status --porcelain` shows no change from this scenario.

## Operator steps: VS Code — not run by the agent runner

These need an editor UI. The runner marks them "not run" in the report; the operator records the outcome.

**Covers:** DoD-10 (project Definition of Done, "Manual check in VS Code")

**Isolation:** `external`

**Preconditions:** a VS Code window with the Prisma 8 extension pointed at this branch's build, opened on the scratch project of the pre-flight. Open `post.prisma` and `extra.prisma` only; leave `auth.prisma` and `session.prisma` closed until a step says otherwise. Undo each rename (Ctrl/Cmd+Z in every changed file, or `git checkout`-style restore of the scratch files) before the next step.

| Step | Action | Expected |
|---|---|---|
| V1 | In `post.prisma`, cursor on `User` in `auth.User`; press **F2** | The rename box opens pre-filled with `User`, not `auth.User`. |
| V2 | Type `Account`, press Enter | `post.prisma` reads `auth.Account`. `auth.prisma` (`model Account`) and `session.prisma` (`user   Account`) are changed too although they were not open: VS Code opens them as modified tabs or shows them changed. `model Account` in `auth.prisma` now ends with a blank line and `@@map("User")` before its closing brace. No error appears in the Problems view. Run **Format Document** on `auth.prisma`: the `@@map("User")` line does not move. |
| V3 | Undo; open `auth.prisma`; repeat from the declaration, `User` in `model User` | The same three places change. |
| V4 | F2 on `id` in `auth.prisma` (`id    Int    @id`), new name `uid`; undo; F2 on `id` in `references: [id]` in `post.prisma` | Both change `User.id` and the two `references: [id]` entries, and the field in `auth.prisma` reads `uid    Int    @id @map("id")`. `Session.id` and `Post.id` stay. |
| V5 | F2 on `auth` in `namespace auth` (`auth.prisma`), new name `identity`; undo; F2 on `auth` in `auth.User` (`post.prisma`) | Both change the two `namespace` block names and the qualifier. No map attribute is added. |
| V6 | In `extra.prisma`, F2 on `Role` in `enum Role`, new name `Rank`; undo; F2 on `Role` in `role Role` | Both change the enum name and the field type. No map attribute is added to the enum. |
| V7 | F2 on `relation` in `@relation` | VS Code refuses: no rename box, and its message that the element cannot be renamed. |
| V8 | F2 on `User`, type `1st`, press Enter | VS Code shows the server's message, `"1st" is not a valid PSL identifier`. No file changes. |
| V9 | F2 on `Member` in `model Member` (`extra.prisma`), type `Post`, press Enter | The rename is applied, with `@@map("Member")` added to the renamed model. The Problems view shows `Duplicate declaration of "Post"`. Undo restores the project. |
| V10 | F2 on `User` in `model User`, type `User` again, press Enter | Nothing changes: no `@@map` is added. |
| V11 | In `post.prisma`, F2 on `author` (the relation field), new name `writer` | The field is renamed; no `@map` is added. |
| V12 | Open scratch project B of the pre-flight. In `shop.prisma`, F2 on `OrderStatus` in `native_enum OrderStatus`, new name `Stage` | The block is renamed and gets `@@map("OrderStatus")`. Check that `status pg.enum(OrderStatus)` in `model Order` is renamed too and that the Problems view stays empty. |

## Operator steps: playground — not run by the agent runner

**Covers:** DoD-8 (project Definition of Done, "Rename works in `apps/lsp-playground`")

**Isolation:** `external`

**Preconditions:** `pnpm --filter lsp-playground... run --if-present build`, then `pnpm --filter lsp-playground start` on this branch with a freshly seeded scratch project (delete `apps/lsp-playground/.playground/scratch/` first). Open `http://localhost:5295/`. `customer.prisma` is shown; do not click any other sidebar entry before step P1.

| Step | Action | Expected |
|---|---|---|
| P1 | Cursor on `Customer` in `model Customer`; press **F2**, type `Client`, press Enter | The editor shows `model Client {`, and the model now ends with a blank line and `@@map("Customer")`. No "Rename failed to apply edits" message. In the WebSocket frames: `textDocument/rename`, a `textDocument/didOpen` for `order.prisma`, then `textDocument/didChange` for both files. |
| P2 | Select `order.prisma` in the sidebar | The `customer` field reads `customer   Client        @relation(…)`. No second `didOpen` for `order.prisma`. No error marker in the file. |
| P3 | Select `customer.prisma` again | Still `model Client {`. |
| P4 | In `order.prisma`, F2 on `catalog` in `catalog.Product`, new name `shop` | Both `namespace` block names (one per file) and the qualifier change; switching files shows `namespace shop` in each. No map attribute is added. |
| P4a | In `customer.prisma`, F2 on `name` in `model Client`, new name `fullName` | The field reads `fullName String @map("name")`. Click **Format**: the attribute stays on the field. |
| P5 | F2 on `relation` in `@relation` | The editor refuses the rename. |

## Sign-off coverage map

| AC ID | Scenario(s) covering it |
|---|---|
| DoD-1 | 1 to 6 (capabilities line, client with `prepareSupport`), 7 (client without) |
| DoD-2 | 1, 2, 3 |
| DoD-3 | 4 (enum block), 10 (named type, composite type and enums of the demo schema, consistency only); generic block CI only |
| DoD-4 | 5; cross-space reference CI only |
| DoD-5 | 6 |
| DoD-6 | 3, 6, 7, 9; row "new name equals the current name" and row `auth.auth` CI only |
| DoD-7 | (not manual-QA scope) — see "Scenarios deliberately not in this script" |
| DoD-8 | P1 to P5, P4a (operator) |
| DoD-9 | (not manual-QA scope) |
| DoD-10 | V1 to V12 (operator) |
| DoD-11 | (CI) |
| DoD-12 | 1, 2, 4, 11, 12; cases that need fixtures the real target does not offer (a field typed by a cross-space model, a control stack without `map`) CI only |
| DoD-13 | 11 (formatting through the server); the remaining positions CI only |
| DoD-14 | 11 (SQL, through `contract emit`); Mongo CI only |
| DoD-15 | 11 |
| Slice `type-constructor-refs`: rename of a `native_enum` edits its `pg.enum(…)` usages; navigation on the argument; one diagnostic for an unknown name; transitional refusal | 11 (steps 11.11 to 11.15), 13 |
