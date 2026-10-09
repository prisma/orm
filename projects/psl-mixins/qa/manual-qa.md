# Manual QA — psl-mixins (reusable member sets for PSL blocks)

> **Be the user.** You are a schema author. You write `model mixin Timestamps { … }`, include it with `+Timestamps`, run `prisma contract emit`, read the errors you get when you make a mistake, format the file, migrate a database, and edit the schema in an editor that talks to `prisma lsp --stdio`.
>
> **Out of scope of this script.** Re-running any workspace test suite or CI gate. Every step here runs the *built CLI* (`packages/1-framework/3-tooling/cli/dist/bin.mjs`) in a project on disk that loads the real Postgres target through its own `prisma.config.ts`, or drives `prisma lsp --stdio` of that same build.
>
> **Spec:** `projects/psl-mixins/spec.md` (project); slice specs under `projects/psl-mixins/slices/*/spec.md`
> **User-level description:** `docs/architecture docs/adrs/ADR 269 - PSL mixins.md`; skill text `skills/prisma-8/references/contract.md`, section "Workflow — Mixins (shared members)"
> **Branch:** `psl-mixin-completion`

## Table of contents

| # | Scenario | What it proves | Isolation | Covers |
|---|---|---|---|---|
| 1 | Emit a schema with mixins and the same schema written inline | A `model` mixin in two models, an `enum` mixin and a `policy_select` mixin in two policies emit a `contract.json` that is byte-identical to the inline one | tmpdir | DoD-1, DoD-2 |
| 2 | Move an inclusion | The members appear where the `+` line is: `contract print` and the enum member list follow the move | tmpdir | DoD-3 |
| 3 | Read every error **(judgement, negative control)** | Each mistake a user can make with a mixin is refused by `contract emit` with a message that says what is wrong, at the right line and column | tmpdir | DoD-4, DoD-5, DoD-7 |
| 4 | A relation in a mixin of another namespace | The relation in `auth.Owned` targets `auth.User` even when the including model's namespace has its own `User` | tmpdir | DoD-1 (qualified), ADR "resolved where written" |
| 5 | `@default(+1)` | A plus sign directly before a digit is still a number | tmpdir | slice `mixin-grammar` |
| 6 | Format a messy schema | `contract format` prints the declaration and the inclusion in one canonical form; a second run changes nothing; the contract is unchanged | tmpdir | DoD-8 |
| 7 | Migrate a database from the mixin schema | Plan and apply against a local Postgres; tables, indexes and both policies exist; the inline schema then needs no operation | tmpdir | (journey; no AC) |
| 8 | Diagnostics in the editor | Two of the errors arrive for the right file and range and clear when the text is fixed | tmpdir | DoD-4 |
| 9 | Go-to-definition and find references | From an inclusion, a qualified inclusion and the declaration, across two files | tmpdir | DoD-9 |
| 10 | Hover | On a mixin name with and without a `///` comment, and on the keyword of a `policy_select` mixin | tmpdir | slice `mixin-navigation` |
| 11 | Rename a mixin and a mixin's field | Declaration and inclusions change, no `@@map`; a field rename adds one `@map("<old>")`; the contract after applying the edits is the contract from before | tmpdir | DoD-9 |
| 12 | Completion after `+` | In a model, an enum and a policy block; after `+auth.`; no mixin of another keyword, none already included, none out of reach; `+` is a trigger character | tmpdir | DoD-10 |
| 13 | Completion and signature help inside a mixin body | A mixin body answers as a block of its keyword does; no item is a top-level keyword | tmpdir | slice `mixin-completion` |
| 14 | Keys a mixin already provides | A policy block that includes a mixin with `roles` and `using` is not offered those keys | tmpdir | slice `mixin-completion` |
| 15 | Semantic tokens | A mixin body is tokenised; `+auth.Timestamps` yields a namespace token and a type token | tmpdir | slice `mixin-navigation` |
| 16 | A `type` mixin | The fourth block kind: a composite type with a mixin emits the inline contract | tmpdir | DoD-1, DoD-2 |
| 17 | Edit a mixin and its inclusion in two open files | Deleting a mixin that is still included, restoring it, and adding a mixin that exists only in an unsaved buffer | tmpdir | (journey; no AC) |
| 18 | Exploratory: 20 minutes of things a user tries next | Shapes the scenarios above do not enumerate | tmpdir | (no AC; charter) |
| V | Operator steps: VS Code | Typing `+` in the editor opens the completion list; not run by the agent runner | external | DoD-10 |

> Scenario 3 is the **negative control** for the guards this project adds; its coverage boundary is stated there. Scenarios 3, 10 and 13 are **judgement** scenarios with an explicit oracle. Scenarios 7 and 17 are **journey** scenarios. Scenario 18 is **exploratory**.
>
> AC IDs are the items of "Project Definition of Done" in `projects/psl-mixins/spec.md`, numbered in the order they are written after the team-DoD floor item: DoD-1 declare and include for four block kinds, DoD-2 inline equivalence, DoD-3 field order, DoD-4 diagnostics at the inclusion, DoD-5 a reference in a mixin to a field it does not declare, DoD-6 no call site reads members from a syntax node, DoD-7 `mixin X { }` and `model mixin { }`, DoD-8 formatter, DoD-9 go-to-definition and rename, DoD-10 completion after `+`, DoD-11 `prisma-7` grammar option, DoD-12 ADR and feature list.

## Scenarios deliberately not in this script

| AC | Why it is not a manual-QA scenario |
|---|---|
| DoD-6 — no production call site reads block members from a syntax node | A code search; the reviewer checks it. |
| DoD-11 — the `prisma-7` grammar option | The scratch projects are Prisma 8 projects. A Prisma 7 schema is read through a different contract source that needs its own project; the parser tests cover the three forms. |
| DoD-12 — ADR and feature list | A file read; the reviewer checks it. |
| DoD-2 for MongoDB | The scratch projects use the Postgres target. Covered by the Mongo interpreter tests. |
| A mixin for a block kind of a third-party extension | `policy_select` is an extension-defined block kind of the Postgres target and goes through the same block-spec path. No second extension is installed in the scratch projects. |
| The playground | Needs a browser; no agent runner step. |
| Team-DoD floor | CI gates. |

## Pre-flight

1. From the repository root: `git status --porcelain` shows nothing under `packages/` or `apps/`.
2. Build the workspace: `pnpm build`. The run must use this build. Building only the CLI is not enough: the scratch projects load the Postgres target through `@prisma/orm-postgres`, which is outside the CLI's build graph.
3. Confirm the entry exists: `ls packages/1-framework/3-tooling/cli/dist/bin.mjs`.
4. Create the scratch projects outside the repository:

```bash
R=$(pwd)
C=$R/packages/1-framework/3-tooling/cli/dist/bin.mjs
D=$R/projects/psl-mixins/qa/driver
Q=<a new directory outside the repository>
node $D/make-scratch.mjs $Q $R/examples/prisma-8-demo/node_modules
```

`make-scratch.mjs` writes the files listed in `driver/scratch.json` and links `node_modules` of `examples/prisma-8-demo` into each project (it provides `@prisma/cli-engine`, `@prisma/orm-postgres`, `@prisma/dev` and `pg`). Every project has this `prisma.config.ts`, the one `prisma orm init` writes for a Postgres project, reduced to the contract path:

```ts
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({ contract: './contract.prisma' }),
});
```

The projects:

| Directory | Used by | Content |
|---|---|---|
| `emit/mixin`, `emit/inline`, `emit/moved` | 1, 2 | The schema below with mixins, the same schema inline, and the mixin schema with two inclusions moved |
| `errors/project` | 3, 18 | Config only; `emit-cases.mjs` writes one `contract.prisma` per case |
| `ns/mixin`, `ns/inline-auth`, `ns/inline-local` | 4 | A relation mixin in `namespace auth` and its two inline readings |
| `sign` | 5 | Signed number defaults |
| `format` | 6 | A badly spaced schema |
| `db` | 7 | `emit/mixin` with a database connection and a migrations directory, plus `dev-db.mjs` and `query-db.mjs` |
| `type/mixin`, `type/inline` | 16 | A composite type with and without a mixin |
| `lsp/project`, `lsp/after-mixin-rename`, `lsp/after-field-rename` | 8 to 15, 17, 18 | The three-file editor project and two copies that receive renamed text |

### `emit/mixin/contract.prisma`

```prisma
// use prisma-8

model mixin Timestamps {
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now())

  @@index([createdAt])
}

enum mixin BaseRoles {
  ADMIN = "admin"
  USER  = "user"
}

enum Role {
  @@type("pg/text@1")
  +BaseRoles
  GUEST = "guest"
}

namespace public {
  model Profile {
    id        Int    @id
    +Timestamps
    ownerName String
    role      Role

    @@rls
  }

  model Document {
    id        Int    @id
    ownerName String
    +Timestamps

    @@rls
  }

  policy_select mixin OwnerRead {
    roles = [app_user]
    using = sql`"ownerName" = current_user`
  }

  policy_select profile_owner_read {
    target = Profile
    +OwnerRead
  }

  policy_select document_owner_read {
    target = Document
    +OwnerRead
  }
}

namespace unbound {
  role app_user {}
}
```

The policy syntax is the one of `examples/supabase/src/contract.prisma`. The role is declared in the schema because the scratch project has no Supabase pack to supply one, and the predicate uses `current_user` because `auth.uid()` exists only on Supabase.

`emit/inline/contract.prisma` has no mixin: `Profile` has `id`, `createdAt`, `updatedAt`, `ownerName`, `role`, then `@@index([createdAt])` and `@@rls`; `Document` has `id`, `ownerName`, `createdAt`, `updatedAt`, then the same two attributes; `Role` has `ADMIN`, `USER`, `GUEST`; each policy has `target`, `roles`, `using`.

`emit/moved/contract.prisma` is the mixin schema with `+Timestamps` moved to the end of `Profile`'s fields and `+BaseRoles` moved below `GUEST`.

### The editor project, `lsp/project`

Its `prisma.config.ts` lists three inputs, `./shared.prisma`, `./app.prisma` and `./policies.prisma`, the way `projects/lsp-rename/qa/manual-qa.md` does.

#### `shared.prisma`

```prisma
// use prisma-8
namespace auth {
  /// Creation and modification times.
  model mixin Timestamps {
    createdAt DateTime @default(now())
    updatedAt DateTime @default(now())

    @@index([createdAt])
  }

  model User {
    id Int @id
  }
}

namespace billing {
  model mixin Priced {
    price Int
  }
}

model mixin SoftDelete {
  deletedAt DateTime?
}

model mixin Tenanted {
  tenantId Int
}

enum mixin BaseRoles {
  ADMIN = "admin"
  USER  = "user"
}

enum mixin ExtraRoles {
  AUDITOR = "auditor"
}
```

#### `app.prisma`

```prisma
// use prisma-8
enum Role {
  @@type("pg/text@1")
  +BaseRoles
  GUEST = "guest"
}

model Account {
  id   Int  @id
  role Role
  +auth.Timestamps
  +SoftDelete
  +Tenanted

  @@index([tenantId])
}

model Invoice {
  id     Int @id
  amount Int
  +auth.Timestamps
  +Tenanted
}

model Draft {
  id    Int    @id
  title String
}
```

#### `policies.prisma`

```prisma
// use prisma-8
namespace public {
  model Profile {
    id        Int    @id
    ownerName String

    @@rls
  }

  model Document {
    id        Int    @id
    ownerName String

    @@rls
  }

  policy_select mixin OwnerRead {
    roles = [app_user]
    using = sql`"ownerName" = current_user`
  }

  policy_select mixin ToAppUser {
    roles = [app_user]
  }

  policy_select profile_owner_read {
    target = Profile
    +OwnerRead
  }

  policy_select document_owner_read {
    target = Document
    +OwnerRead
  }

  policy_select document_any_read {
    target = Document
    +ToAppUser
    using  = sql`true`
  }

  policy_select profile_plain_read {
    target = Profile
  }
}

namespace unbound {
  role app_user {}
}
```

### The tools in `projects/psl-mixins/qa/driver`

`qa-driver.mjs` is the rename QA driver (`projects/lsp-rename/qa/driver/qa-driver.mjs`) with four request kinds added. It spawns `node <cli> lsp --stdio` in the project directory, sends `initialize` and `initialized`, prints the advertised capabilities (the second line lists the completion trigger characters), and runs the steps of a JSON file in order. A request step opens its own file if it is not open yet and finds the cursor from a marked anchor: the anchor text must occur exactly once in the file and `|` is the cursor. An anchor may span lines to make it unique. What was added:

1. `completion`: sends `textDocument/completion`, as invoked or, with `"trigger": "+"`, as triggered by that character. Prints one line per item: label, kind, detail, and the inserted text when it differs from the label. `"present"` and `"absent"` list labels; the driver prints one `check present … : yes|NO` or `check absent … : yes|NO (offered)` line for each. A `NO` is a failed expectation.
2. `signatureHelp`: prints each signature label, its documentation and the active parameter.
3. `hover`: prints the hover range and the content.
4. `semanticTokens`: requests the tokens of the whole file and prints those on the anchor's line and the following `"lines" - 1` lines as `line:column "text" type (modifiers)`.
5. A `diagnostics` step also prints the range of each diagnostic as the source line with `<<…>>` around the covered text.
6. A `change` step whose `replace` text does not occur in the file stops the driver, so that a step cannot silently do nothing.

The other step kinds (`open`, `change`, `diagnostics`, `definition`, `references`, `prepareRename`, `rename` with `"apply": true`, `format`, `save`) are described in `projects/lsp-rename/qa/manual-qa.md`. Nothing is written to disk except by a `save` step.

```bash
node $D/qa-driver.mjs <cli entry> <project dir> <steps.json>
```

`emit-cases.mjs <cli entry> <project dir> <cases.json> [case id]` writes each case's schema to `contract.prisma` in the project, runs `prisma contract emit --format human --no-color`, and prints the exit code and every source diagnostic line (`contract.prisma:<line>:<column> <code>: <message>`) followed by the source line and a caret under the column. For a case that emits, it prints the contract values named in the case's `print` list.

`compare-storage.mjs` is the one of the rename QA, unchanged. `dev-db.mjs` starts the `@prisma/dev` Postgres server (PGlite) and writes its connection string to `database-url.txt`; `query-db.mjs` runs SQL statements against it. Both are copied into `$Q/db` so that they resolve `@prisma/dev` and `pg` from that project.

Step ids in the JSON files are `<scenario>.<step>` and match the tables below.

## Scenario 1 — Emit a schema with mixins and the same schema written inline

**What you're proving from the user's seat:** replacing repeated members by a mixin changes nothing in what the project emits. This is the central promise of the feature, checked on real emitted files rather than on in-memory objects.

**Covers:** DoD-1, DoD-2

**Isolation:** `tmpdir`

**Oracle:** ADR 269, "At a glance": "The emitted contract is the same as if every member had been written in the block that includes it." The comparison is `cmp` on two files written by `prisma contract emit`.

**Preconditions:** pre-flight done.

### Steps

```bash
for d in mixin inline; do
  (cd $Q/emit/$d && node $C contract emit --output-path $Q/out/emit-$d --format human --no-color; echo "emit $d exit $?")
done
cmp $Q/out/emit-mixin/contract.json $Q/out/emit-inline/contract.json && echo "contract.json: byte-identical"
cmp $Q/out/emit-mixin/contract.d.ts $Q/out/emit-inline/contract.d.ts && echo "contract.d.ts: byte-identical"
sha256sum $Q/out/emit-mixin/contract.json $Q/out/emit-inline/contract.json
grep -c mixin $Q/out/emit-mixin/contract.json
```

### What you should see

- Both emits exit 0 and print the same `storageHash` and `profileHash`.
- Both `cmp` lines print, and the two checksums are equal.
- `grep -c mixin` prints `0`: the contract does not record mixins.

### Failure modes

- An emit that fails or warns about the mixin schema only.
- Any byte of difference between the two `contract.json` files or the two `contract.d.ts` files.
- The word `mixin`, or a mixin's name, in the emitted contract.

## Scenario 2 — Move an inclusion

**What you're proving from the user's seat:** the members land where you wrote the `+` line, not at the top or the bottom of the block.

**Covers:** DoD-3

**Isolation:** `tmpdir`

**Oracle:** ADR 269, "Position decides order": "The mixin's members are placed where the inclusion is written. That order is what the symbol table, the binder and the interpreters read, and it shows where order is kept: in enum member lists and in `contract print`."

**Preconditions:** scenario 1 completed (reads `$Q/out/emit-mixin`).

### Steps

```bash
(cd $Q/emit/mixin && node $C contract print --format human --no-color) > $Q/out/print-mixin.txt 2>&1
(cd $Q/emit/moved && node $C contract print --format human --no-color) > $Q/out/print-moved.txt 2>&1
diff $Q/out/print-mixin.txt $Q/out/print-moved.txt
(cd $Q/emit/moved && node $C contract emit --output-path $Q/out/emit-moved --format human --no-color > /dev/null 2>&1; echo "emit moved exit $?")
diff $Q/out/emit-mixin/contract.json $Q/out/emit-moved/contract.json
```

`contract print` loads the contract from the source and prints it as PSL, so it shows the order the interpreter produced. `contract.json` stores a model's fields and a table's columns as objects with sorted keys, so it cannot show field order; it stores enum members as a list, which can.

### What you should see

- `print-mixin.txt`: `Profile` lists `id`, `createdAt`, `updatedAt`, `ownerName`, `role`; `Document` lists `id`, `ownerName`, `createdAt`, `updatedAt`; `Role` lists `ADMIN`, `USER`, `GUEST`. No `mixin` and no `+` line: the printer does not produce mixins (a stated non-goal).
- The first `diff`: in `Profile`, `createdAt` and `updatedAt` move below `role`; in `Role`, `GUEST` moves above `ADMIN`. `Document` is unchanged.
- The second `diff`: only the enum differs, in the `members` list (`GUEST` first), the generated check expression that lists the values, the names derived from it, and the hashes. Nothing under a table's `columns` or a model's `fields` differs.

### Failure modes

- Mixed-in fields printed at the start or the end of the block regardless of the inclusion's position.
- A member order in the moved schema that is not the source order.

## Scenario 3 — Read every error (judgement, negative control)

**What you're proving from the user's seat:** when you get a mixin wrong, `contract emit` stops, and the message tells you what is wrong and where, in words you can act on without reading the ADR.

**Covers:** DoD-4, DoD-5, DoD-7

**Isolation:** `tmpdir`

**Oracle:** ADR 269, sections "Decision" and "Semantics", and project spec decision 13: errors raised while inclusions are replaced point at the inclusion; "`mixin X { … }` and `model mixin { … }` are errors that say what a mixin declaration needs"; "When the block's own member follows the inclusion that provided the name, the error is at that member"; "a field whose type names a mixin is an unresolved reference"; "A field named in one of the mixin's attributes must be a field the mixin declares". For the wording, the oracle is the reader: each message must be true, name the mixin or member involved, and not contradict another message of the same run.

**Coverage boundary:** each case plants one mistake in an otherwise valid schema and proves the guard fires for that shape on the Postgres target through `contract emit`. It does not prove the guard for every block kind (cases 3.13 to 3.15 repeat three of them for `enum` and `policy_select`), nor for combinations of two mistakes in one block.

**Preconditions:** pre-flight done.

### Steps

```bash
node $D/emit-cases.mjs $C $Q/errors/project $D/error-cases.json | tee $Q/out/errors.txt
```

| Case | Mistake | Expected: exit 2 and one diagnostic | At |
|---|---|---|---|
| 3.1 | `+Timestamp`, no such mixin | `PSL_UNRESOLVED_REFERENCE: Cannot find mixin "Timestamp"` | the `+` of the inclusion |
| 3.2 | `+Audit`, and `Audit` is a model | `PSL_UNRESOLVED_REFERENCE: "Audit" is a model, not a mixin` | the inclusion |
| 3.3 | an `enum` mixin included in a model | `PSL_INVALID_MODEL_MEMBER: Mixin "BaseRoles" is for "enum" blocks, not "model" blocks` | the inclusion |
| 3.4 | `+Timestamps` twice in one model | `PSL_INVALID_MODEL_MEMBER: Mixin "Timestamps" is already included in this block` | the second inclusion |
| 3.5 | the model declares `createdAt`, then includes `Timestamps` | `PSL_DUPLICATE_DECLARATION: Mixin "Timestamps" provides "createdAt", which "User" already has` | the inclusion |
| 3.6 | the model includes `Timestamps`, then declares `createdAt` | `PSL_DUPLICATE_DECLARATION: Duplicate declaration of "createdAt"` | the model's own `createdAt` |
| 3.7 | `+Timestamps` inside `model mixin Audited` | `PSL_INVALID_MODEL_MEMBER: A mixin cannot include another mixin` | the inclusion inside the mixin |
| 3.8 | `mixin Timestamps { … }` with no keyword | `PSL_INVALID_DECLARATION: A mixin starts with the keyword of the block it is for, for example "model mixin Timestamps"`, and nothing else: no `Unsupported top-level block "mixin"` and no diagnostic for a member of its body | the word `mixin` |
| 3.9 | `model mixin { … }` with no name | `PSL_INVALID_DECLARATION: Expected a mixin name after "mixin"` | the word `mixin` |
| 3.10 | `stamp Timestamps`, a field typed with a mixin | `PSL_UNRESOLVED_REFERENCE: "Timestamps" is a mixin; a type reference must name a model, composite type, enum, or named type` | the type |
| 3.11 | `@@unique([tenantId, id])` in a mixin; `id` is the including model's field | `PSL_UNRESOLVED_REFERENCE: Cannot find field "id" on "Tenanted"` | `id` inside the mixin's attribute |
| 3.12 | two mixins both provide `createdAt` | `Mixin "Created" provides "createdAt", which "User" already has` | the second inclusion |
| 3.13 | an enum declares `ADMIN`, then includes a mixin with `ADMIN` | `Mixin "BaseRoles" provides "ADMIN", which "Role" already has` | the inclusion |
| 3.14 | a policy declares `roles`, then includes a mixin with `roles` | `Mixin "OwnerRead" provides "roles", which "profile_owner_read" already has` | the inclusion |
| 3.15 | a `policy_select` mixin included in a `policy_update` block | `Mixin "OwnerRead" is for "policy_select" blocks, not "policy_update" blocks` | the inclusion |
| 3.16 | `+Timestamps` in `namespace public`; the mixin is in `namespace auth` | `Cannot find mixin "Timestamps"` | the inclusion |
| 3.17 | `+auth.Timestamps`; the mixin is at the top level, not in `auth` | `Cannot find mixin "auth.Timestamps"` | the inclusion |
| 3.18 | a mixin and a model both named `Timestamps` | `PSL_DUPLICATE_DECLARATION: Duplicate declaration of "Timestamps"` | the second declaration's name |
| 3.19 | `namespace mixin Shared { … }` and `types mixin Aliases { … }` | two diagnostics: `A mixin cannot be declared for "namespace"` and `A mixin cannot be declared for "types"` | each keyword |
| 3.20 | a mixin whose field has an invalid `@default(nope())`, included by two models | the interpreter's error twice, both at the member in the mixin (ADR, "Consequences": once per including block) | inside the mixin |
| 3.21 | the same mixin, included by nothing | exit 0 (ADR, "Consequences": no family interpreter reads a mixin that nothing includes) | — |
| 3.22 | `mixin Timestamps { }` with no keyword, and a model that includes it | two diagnostics: the one of 3.8 at the word `mixin`, and `PSL_UNRESOLVED_REFERENCE: Cannot find mixin "Timestamps"` at the inclusion. The keyword-less block is not a mixin, so the inclusion finds none | the declaration and the inclusion |

### What you should see

- For every case the caret printed under the source line is under the token named in the "At" column.
- Each message names the mixin and, where a member is involved, the member and the including block.
- One mistake gives one diagnostic, except 3.19, 3.20 and 3.22 as described.

### Failure modes

- A mistake that emits a contract (exit 0), apart from 3.21.
- A diagnostic at a line other than the one the oracle names.
- A message that is false, that contradicts itself or another message of the same case, or that does not name what to change.
- Additional diagnostics for one mistake that add nothing a user can act on.

## Scenario 4 — A relation in a mixin of another namespace

**What you're proving from the user's seat:** a mixin means the same thing wherever it is included. A relation field written in `namespace auth` points at `auth.User` even when the including model sits next to another `User`.

**Covers:** DoD-1 (qualified inclusion), ADR 269 "Names in a mixin body are resolved where the mixin is written"

**Isolation:** `tmpdir`

**Oracle:** ADR 269, "Semantics": "A field's type is looked up from the mixin's namespace, not from the namespace of a block that includes it." `ns/inline-auth` writes the relation in `public.Post` as `owner auth.User`; `ns/inline-local` writes it as `owner User`, which is `public.User`.

**Preconditions:** pre-flight done.

`ns/mixin/contract.prisma`:

```prisma
// use prisma-8

namespace auth {
  model User {
    id Int @id
  }

  model mixin Owned {
    ownerId Int
    owner   User @relation(fields: [ownerId], references: [id])
  }
}

namespace public {
  model User {
    id Int @id
  }

  model Post {
    id Int @id
    +auth.Owned
  }
}
```

### Steps

```bash
for d in mixin inline-auth inline-local; do
  (cd $Q/ns/$d && node $C contract emit --output-path $Q/out/ns-$d --format human --no-color > /dev/null 2>&1; echo "emit $d exit $?")
done
cmp $Q/out/ns-mixin/contract.json $Q/out/ns-inline-auth/contract.json && echo "same as the auth.User reading"
diff $Q/out/ns-mixin/contract.json $Q/out/ns-inline-local/contract.json
node -e '
const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log(JSON.stringify(c.domain.namespaces.public.models.Post.relations.owner.to));
console.log(JSON.stringify(c.storage.namespaces.public.entries.table.Post.foreignKeys[0].target));
' $Q/out/ns-mixin/contract.json
```

### What you should see

- Three emits exit 0. `same as the auth.User reading` prints.
- The `diff` against `inline-local` shows `"namespace": "auth"` on the mixin side where the local reading has `"public"`, in the relation and in the foreign key, plus the storage hash.
- The last command prints `{"model":"User","namespace":"auth"}` and a foreign-key target with `"namespaceId":"auth"`.

### Failure modes

- The mixin's relation targets `public.User`.
- An "ambiguous" or "unresolved" error for `User` at the inclusion.

## Scenario 5 — `@default(+1)`

**What you're proving from the user's seat:** the new `+` token did not take the plus sign away from numbers.

**Covers:** slice `mixin-grammar`, edge case "A signed number"

**Isolation:** `tmpdir`

**Oracle:** ADR 269, "Decision": "Directly before a digit it is still the sign of a number: `@default(+1)` is `1`."

**Preconditions:** pre-flight done. `sign/contract.prisma` declares, in a `model mixin Counted` that `model Counter` includes, `plus Int @default(+1)`, `bare Int @default(1)`, `minus Int @default(-1)` and `ratio Float @default(+1.5)`.

### Steps

```bash
(cd $Q/sign && node $C contract emit --output-path $Q/out/sign --format human --no-color > /dev/null 2>&1; echo "emit exit $?")
node -e '
const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const columns = c.storage.namespaces.public.entries.table.Counter.columns;
for (const name of ["plus", "bare", "minus", "ratio"]) console.log(name, JSON.stringify(columns[name].default));
' $Q/out/sign/contract.json
```

### What you should see

`plus {"kind":"literal","value":1}`, the same for `bare`, `-1` for `minus`, `1.5` for `ratio`.

### Failure modes

- An error about an inclusion or a mixin named `1`.
- A default of `"+1"` (a string), or a missing default.

## Scenario 6 — Format a messy schema

**What you're proving from the user's seat:** the formatter knows both new forms, has one way of printing them, and does not change what the schema means.

**Covers:** DoD-8

**Isolation:** `tmpdir`

**Oracle:** project spec, DoD: "The formatter prints both new forms and formatting is idempotent on them." The canonical form is the one the ADR's examples use: `<keyword> mixin <Name> {`, members indented two spaces, an inclusion as `+<Name>` or `+<namespace>.<Name>` with no inner spaces, at the indentation of the block's other members.

**Preconditions:** pre-flight done. `format/contract.prisma` contains, among other lines, `model    mixin   Timestamps{`, `@@index( [createdAt] )`, `     +   BaseRoles`, `model mixin Owned { ownerId Int }` on one line inside `namespace auth`, `+Timestamps` at column 1 and `        +  auth . Owned`.

### Steps

```bash
cd $Q/format
cp contract.prisma $Q/out/format-0.prisma
node $C contract emit --output-path $Q/out/format-emit-before --format human --no-color > /dev/null 2>&1; echo "emit before exit $?"
node $C contract format --format human --no-color; echo "format exit $?"
cp contract.prisma $Q/out/format-1.prisma
cat contract.prisma
node $C contract format --format human --no-color; echo "format exit $?"
cmp contract.prisma $Q/out/format-1.prisma && echo "second run: no change"
node $C contract emit --output-path $Q/out/format-emit-after --format human --no-color > /dev/null 2>&1; echo "emit after exit $?"
cmp $Q/out/format-emit-before/contract.json $Q/out/format-emit-after/contract.json && echo "contract unchanged by formatting"
cd $R
```

### What you should see

- The formatted file has `model mixin Timestamps {`, `enum mixin BaseRoles {`, a three-line `model mixin Owned { … }` inside `namespace auth`, and in `model User` the lines `  +Timestamps` and `  +auth.Owned`. The trailing comment after `email String` is still there.
- `second run: no change` and `contract unchanged by formatting` both print.

### Failure modes

- A space left inside `+ auth . Owned`, or an inclusion at another indentation than the fields around it.
- An inclusion aligned into the field columns as if it were a field.
- A second run that edits the file.
- A different contract after formatting.

### Restore

`$Q/format/contract.prisma` is left formatted; `$Q/out/format-0.prisma` holds the original.

## Scenario 7 — Migrate a database from the mixin schema

**What you're proving from the user's seat:** the feature holds beyond the emitter. The tables, the index a mixin's `@@index` declares and the policies a `policy_select` mixin completes exist in a real database, and replacing the mixins by inline members afterwards needs no migration.

**Covers:** (journey; no AC)

**Isolation:** `tmpdir` (a PGlite server started from the scratch project; no external service)

**Oracle:** the DDL a user would expect from the inline schema: tables `Profile` and `Document` with the columns of scenario 1, an index on `createdAt` on each, row-level security enabled on both, and one `SELECT` policy per table for role `app_user` with the predicate `"ownerName" = current_user`.

**Preconditions:** pre-flight done. `db/prisma.config.ts` adds `db: { connection: process.env['DATABASE_URL'] ?? '' }` and `migrations: { dir: 'migrations' }` to the config above. `db/contract.prisma` is `emit/mixin/contract.prisma`.

### Steps

Start the database in a second terminal (or in the background) and leave it running:

```bash
cd $Q/db && node dev-db.mjs
```

Then:

```bash
cd $Q/db
export DATABASE_URL=$(cat database-url.txt)
node query-db.mjs "select count(*) from information_schema.tables where table_schema = 'public'" "create role app_user"
node $C contract emit --format human --no-color
node $C migration plan --name init --format human --no-color; echo "plan exit $?"
node $C db migrate --format human --no-color; echo "migrate exit $?"
node query-db.mjs \
  "select table_name, column_name from information_schema.columns where table_schema = 'public' order by 1, ordinal_position" \
  "select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1" \
  "select relname, relrowsecurity from pg_class where relname in ('Profile', 'Document') order by 1" \
  "select indexname from pg_indexes where schemaname = 'public' order by 1"
node $C db verify --format human --no-color; echo "verify exit $?"
cp $Q/emit/inline/contract.prisma contract.prisma
node $C contract emit --format human --no-color
node $C db verify --format human --no-color; echo "verify exit $?"
node $C db update --format human --no-color; echo "update exit $?"
cd $R
```

The role is created by hand because the contract declares it with `"control": "external"`: Prisma does not create roles.

### What you should see

- The first query prints a count of `0`: the database starts empty.
- `migration plan` prints nine operations: the schema, two tables, two indexes, two "Enable row-level security", two "Create RLS policy". Its DDL preview contains `CREATE POLICY … ON "public"."Profile" AS PERMISSIVE FOR SELECT TO app_user USING ("ownerName" = current_user)` and the same for `Document`.
- `db migrate` applies one migration with nine operations.
- The queries show both tables with their columns, two policies (`SELECT`, `{app_user}`), `relrowsecurity` true twice, and the two `…_createdAt_idx_…` indexes.
- `db verify` reports that marker and schema match, before and after the schema is replaced by the inline one, with the same `storageHash`.
- `db update` with the inline schema reports no operations.

### Failure modes

- A table without the mixed-in columns or index, or a policy without the roles or the predicate.
- `db verify` failing, or `db update` proposing an operation after the swap to the inline schema.

### Restore

Stop `dev-db.mjs` (Ctrl-C or `kill`). The server keeps nothing on disk outside `$Q`. `git status --porcelain` in the repository shows no change from this scenario.

## Scenarios 8 to 15 and 17 — the editor

**Isolation:** `tmpdir` (each steps file starts its own server on `$Q/lsp/project`; edits exist only in the driver's and the server's memory, except the two `save` steps of scenario 11, which write into the two copies).

**Preconditions:** pre-flight done. No dependency between the five sessions.

```bash
cd $Q/lsp
node $D/qa-driver.mjs $C project $D/diagnostics.json | tee out/diagnostics.txt
node $D/qa-driver.mjs $C project $D/navigation.json  | tee out/navigation.txt
node $D/qa-driver.mjs $C project $D/rename.json      | tee out/rename.txt
node $D/qa-driver.mjs $C project $D/completion.json  | tee out/completion.txt
node $D/qa-driver.mjs $C project $D/mixin-body.json  | tee out/mixin-body.txt
cd $R
```

The second line of each output must list `"+"` among `completion triggers`.

## Scenario 8 — Diagnostics in the editor

**What you're proving from the user's seat:** the squiggle appears under the inclusion you just broke, in the file you are editing, and goes away when you fix it.

**Covers:** DoD-4

**Oracle:** the messages of scenario 3, cases 3.1, 3.3 and 3.4; project spec decision 13 (the error points at the inclusion).

**Steps file:** `diagnostics.json`, steps 8.x.

| Step | Action | Expected |
|---|---|---|
| 8.1 | open `app.prisma`; diagnostics | none in any file |
| 8.2, 8.3 | `+SoftDelete` → `+SoftDeleted` | one, in `app.prisma`: `PSL_UNRESOLVED_REFERENCE Cannot find mixin "SoftDeleted"`, range `<<+SoftDeleted>>` |
| 8.4, 8.5 | back | none |
| 8.6, 8.7 | `+SoftDelete` → `+BaseRoles` | one, in `app.prisma`: `PSL_INVALID_MODEL_MEMBER Mixin "BaseRoles" is for "enum" blocks, not "model" blocks`, range `<<+BaseRoles>>` on the line in `Account` (line 12), not on the enum's own `+BaseRoles` |
| 8.8, 8.9 | back | none |
| 8.10, 8.11 | a second `+SoftDelete` after `+Tenanted` | one: `Mixin "SoftDelete" is already included in this block`, on the second inclusion (line 14) |
| 8.12, 8.13 | removed | none |

### Failure modes

- A diagnostic published for `shared.prisma` (the mixin's file) instead of the including file.
- A range that covers the whole block or only the name without the `+`, or a diagnostic that stays after the fix.

## Scenario 9 — Go-to-definition and find references

**What you're proving from the user's seat:** F12 on an inclusion opens the mixin, in whichever file it is; the usages list of a mixin has the declaration and every inclusion.

**Covers:** DoD-9

**Oracle:** project spec, "Place in the larger world": "The inclusion's operand is a bound reference and the mixin name is a declared symbol, so the existing go-to-definition, rename and hover providers apply to them"; decision 12 (a reference to a mixed-in field resolves to the mixin's field).

**Steps file:** `navigation.json`, steps 9.x.

| Step | Request | Expected |
|---|---|---|
| 9.1 | definition, `app.prisma`, `+Soft\|Delete` | `shared.prisma`: `model mixin <<SoftDelete>> {` |
| 9.2 | definition, `app.prisma`, `+auth.Time\|stamps` (in `Account`) | `shared.prisma`: `model mixin <<Timestamps>> {` |
| 9.3 | definition, `app.prisma`, `+au\|th.Timestamps` | `shared.prisma`: `namespace <<auth>> {` |
| 9.4 | definition, `app.prisma`, `+Base\|Roles` | `shared.prisma`: `enum mixin <<BaseRoles>> {` |
| 9.5 | definition, `policies.prisma`, `+Owner\|Read` | `policy_select mixin <<OwnerRead>> {` |
| 9.6 | definition, `app.prisma`, `@@index([tenant\|Id])` | `shared.prisma`: `<<tenantId>> Int`, the field in the mixin |
| 9.7 | references with declaration, `shared.prisma`, `model mixin Time\|stamps` | three: `+auth.<<Timestamps>>` at `app.prisma` lines 11 and 21, and the declaration |
| 9.8 | references with declaration, from the inclusion in `Account` | the same three |
| 9.9 | references without declaration, from the declaration | the two inclusions |
| 9.10 | references with declaration, `+Soft\|Delete` | the inclusion and the declaration |
| 9.11 | references with declaration, `policy_select mixin Owner\|Read` | the declaration and both `+<<OwnerRead>>` |
| 9.12 | references with declaration, `shared.prisma`, `tenant\|Id Int` | the field and `@@index([<<tenantId>>])` in `app.prisma` |
| 9.13 | references with declaration, `namespace au\|th` | the namespace block and the qualifier of both `+<<auth>>.Timestamps` |
| 9.14 | definition from the declaration's own name | the declaration |

### Failure modes

- No target from an inclusion, or a target that is the including block.
- A range that includes the `+` or the qualifier.
- An inclusion missing from a usage list, or a different list depending on where the cursor was.

## Scenario 10 — Hover

**What you're proving from the user's seat:** hovering an inclusion tells you what kind of mixin it is and shows the comment its author wrote.

**Covers:** slice `mixin-navigation`

**Oracle:** slice spec `projects/psl-mixins/slices/mixin-navigation/spec.md`; the hover of a model name on the same build, which shows the declaration header in a `prisma` code block followed by the `///` comment.

**Steps file:** `navigation.json`, steps 10.x.

| Step | Hover on | Expected |
|---|---|---|
| 10.1 | `+auth.Time\|stamps` in `app.prisma` | `model mixin Timestamps` and "Creation and modification times."; the range is the name only |
| 10.2 | `+Soft\|Delete` | `model mixin SoftDelete`, no documentation |
| 10.3 | the declaration's name `Time\|stamps` | as 10.1 |
| 10.4 | the keyword of `policy_se\|lect mixin OwnerRead` | the description of the `policy_select` block kind ("Defines a row-level security policy controlling which rows can be selected.") |
| 10.5, 10.6 | the name of the policy mixin, at the declaration and at an inclusion | `policy_select mixin OwnerRead` |
| 10.7 | the word `mi\|xin` | record what is shown; nothing is specified |
| 10.8 | `+Base\|Roles` | `enum mixin BaseRoles` |
| 10.9 | `tenant\|Id` in `@@index` of the including model | the field as written in the mixin: `tenantId Int` |
| 10.10 | the key `ro\|les` inside the policy mixin's body | the `roles` entry's type and description, as in a `policy_select` block |

### Failure modes

- No hover on an inclusion, or one that says `model` without `mixin`.
- The `///` comment missing at the inclusion.

## Scenario 11 — Rename a mixin and a mixin's field

**What you're proving from the user's seat:** F2 on a mixin renames it everywhere and changes nothing in the database. F2 on a field of a mixin behaves like F2 on a model's field: every use changes, and one `@map` keeps the column name.

**Covers:** DoD-9

**Isolation:** `tmpdir` (two `save` steps write into `$Q/lsp/after-mixin-rename` and `$Q/lsp/after-field-rename`)

**Oracle:** project spec decision 12 ("rename and go-to-definition work across including blocks"); the rename rules of `projects/lsp-rename/spec.md`: a map attribute is added only where the rename would change a database name. A mixin has no database name. The contract comparison uses `prisma contract emit` on the saved text.

**Steps file:** `rename.json`. Run it from `$Q/lsp` (the `save` targets are relative), then:

```bash
cd $Q/lsp
for d in project after-mixin-rename after-field-rename; do
  (cd $d && node $C contract emit --output-path $Q/lsp/out/contract-$d --format human --no-color > /dev/null 2>&1; echo "emit $d exit $?")
done
cmp out/contract-project/contract.json out/contract-after-mixin-rename/contract.json && echo "mixin renames: contract.json byte-identical"
diff out/contract-project/contract.json out/contract-after-field-rename/contract.json
node $D/compare-storage.mjs out/contract-project out/contract-after-mixin-rename out/contract-after-field-rename
cd $R
```

| Step | Action | Expected |
|---|---|---|
| 11.1 | open `app.prisma`; diagnostics | none |
| 11.2 | prepareRename, `+Soft\|Delete` | the range of `SoftDelete` without the `+` |
| 11.3 | rename → `Archivable`, apply | two name edits: the inclusion, and the declaration in `shared.prisma`, which is not open. No insertion |
| 11.4 | diagnostics | none |
| 11.5 | rename `+auth.Time\|stamps` → `Stamps`, not applied | three name edits: both inclusions (the qualifier `auth` untouched) and the declaration |
| 11.6 | rename from the declaration → `Stamps`, apply | the same edit as 11.5 |
| 11.7, 11.8 | diagnostics; references on the new name | none; the three renamed positions; "same positions as the applied edit: yes" |
| 11.9 | rename `policy_select mixin Owner\|Read` → `OwnerOnly`, apply | three name edits, no insertion |
| 11.10 | rename `enum mixin Base\|Roles` → `CoreRoles`, apply | two name edits, no insertion |
| 11.11, 11.12 | diagnostics; save to `after-mixin-rename` | none |
| 11.13 | rename `@@index([tenant\|Id])` in `app.prisma` → `orgId`, not applied | the edit of 11.14 |
| 11.14 | rename `tenant\|Id Int` in the mixin → `orgId`, apply | the field name in `shared.prisma`, `@@index([<<tenantId -> orgId>>])` in `app.prisma`, and one insertion ` @map("tenantId")` after `Int` on the field's line in the mixin |
| 11.15 | diagnostics | none |
| 11.16, 11.17 | format both files | `orgId Int @map("tenantId")` stays; the inclusion lines are not touched |
| 11.18 | save to `after-field-rename` | — |
| 11.19 | rename `create\|dAt` in `Stamps` → `madeAt`, not applied | the field, `@@index([createdAt])` inside the mixin, and one ` @map("createdAt")` |
| 11.20 | rename the key `ro\|les` of the policy mixin | `null`: entry keys are not renameable |
| 11.21 | rename the mixin to `User`, a name `namespace auth` already has | the edit is returned, as for any other declaration (rename QA, scenario 9) |
| emit, compare | | three emits exit 0. `mixin renames: contract.json byte-identical` prints. After the field rename the `diff` shows the domain field `tenantId` replaced by `orgId` in `Account` and `Invoice`, with `"column": "tenantId"` kept; `compare-storage.mjs` prints "storage names equal: yes; storage section equal: yes" and one storage hash for all three |

### Failure modes

- A `@@map` or `@map` in an edit that renames a mixin.
- An inclusion or an `@@index` argument left with the old name; a second `@map`; a `@map` on the including model instead of the mixin's field.
- A diagnostic after an applied rename.
- A storage difference after any of the renames.

### Restore

`$Q/lsp/project` still holds the pre-flight text; only the two copies were written.

## Scenario 12 — Completion after `+`

**What you're proving from the user's seat:** typing `+` in a block opens a list of exactly the mixins you could include there.

**Covers:** DoD-10

**Oracle:** project spec, DoD: "completion after `+` offers the mixins whose keyword matches the enclosing block, and no others"; slice spec `projects/psl-mixins/slices/mixin-completion/spec.md` (a mixin the block already includes is not offered; a namespace is offered as a qualifier only when it holds a mixin that could be offered; `+` is a trigger character).

**Steps file:** `completion.json`. Each completion step is preceded by a `change` step that types the text and followed by one that removes it.

| Step | Where | Expected items | Must be absent |
|---|---|---|---|
| capabilities | — | `completion triggers` contains `"+"` | — |
| 12.2 | `+` typed in `model Draft` (triggered by `+`) | `SoftDelete`, `Tenanted`, and the namespaces `auth` and `billing` (inserting `auth.` and `billing.`) | `BaseRoles`, `ExtraRoles` (enum), `OwnerRead`, `ToAppUser` (policy), `Timestamps`, `Priced` (not reachable without a qualifier), `User`, `Account` (not mixins) |
| 12.3 | the same position, invoked by hand | the same list | — |
| 12.5 | `+auth.` | `Timestamps` only | `User`, `SoftDelete`, `Priced` |
| 12.7 | `+billing.` | `Priced` only | — |
| 12.9 | `+So`, invoked | contains `SoftDelete` (the client filters by prefix) | `BaseRoles` |
| 12.12 | `+` typed in `model Invoice`, which includes `auth.Timestamps` and `Tenanted` | `SoftDelete`, `billing` | `Tenanted` (already included), `auth` (its only mixin is already included), `Timestamps` |
| 12.15 | `+` typed in `enum Role`, which includes `BaseRoles` | `ExtraRoles` only | `BaseRoles`, every model mixin, `auth`, `billing` |
| 12.18 | `+` typed in `policy_select profile_plain_read` | `OwnerRead`, `ToAppUser` | every model and enum mixin, `auth`, `billing` |
| 12.21 | `+` typed in `document_any_read`, which includes `ToAppUser` | `OwnerRead` | `ToAppUser` |
| 12.24 | `+` typed inside `model mixin SoftDelete` | record; a mixin cannot include a mixin, so an empty list is the consistent answer | `SoftDelete`, `Tenanted` |
| 12.26 | diagnostics after the last change | none: every typed line was removed |

### Failure modes

- Any `check … : NO` line in the output.
- An item whose detail does not say which kind of mixin it is.
- An empty list where the table expects items.

## Scenario 13 — Completion and signature help inside a mixin body

**What you're proving from the user's seat:** writing the body of a mixin feels like writing the block it is for: the same types, attributes, arguments and keys are offered.

**Covers:** slice `mixin-completion` ("Complete and show signatures inside a mixin body as in a block of its keyword")

**Oracle:** the answer the same build gives at the corresponding position of an ordinary block. Steps 13.28, 13.31 and 13.34 ask at such positions as controls.

**Steps file:** `mixin-body.json`, steps 13.x. Every completion step lists `model`, `namespace`, `enum` and `type` as absent.

| Step | Position | Expected |
|---|---|---|
| 13.2 | a field's type in `model mixin SoftDelete` (`flag \|`) | scalar types (`Boolean`, `DateTime`, `Int`, `String`), models (`Account`); no mixin name (`SoftDelete`, `Tenanted`), no `mixin` |
| 13.28 | control: a field's type in `model Draft` | the same number of items as 13.2 |
| 13.4 | after `@` on a mixin's field | field attributes: `default`, `id`, `map`, `unique` |
| 13.6 | signature help inside `@default(\|)` on a mixin's field | the `@default(…)` signature with its description |
| 13.7 | completion inside `@default(\|)` | default values: `now`, `autoincrement`, `uuid`, `true`, `false` |
| 13.9 | after `@@` in the mixin body | model attributes: `index`, `unique`, `id`, `map` |
| 13.11 | inside `@@index([\|])` in `SoftDelete` (which now has `deletedAt` and `flag`) | `deletedAt`, `flag`; not `id`, `tenantId`, `createdAt` |
| 13.12 | signature help inside `@@index(\|[])` | the `@@index(…)` signature |
| 13.14 | inside `@@index([\|createdAt])` of `auth.Timestamps` | `createdAt`, `updatedAt` only |
| 13.15 | signature help on the existing `@default(now())` in `Timestamps` | the `@default(…)` signature |
| 13.17 | an empty line in `enum mixin BaseRoles` | record; 13.34 is the control in `enum Role` |
| 13.20 | an empty line in `policy_select mixin ToAppUser`, which has `roles` | entry keys `target`, `using`; not `roles` |
| 13.22 | the value of `target = \|` in the policy mixin | `Profile`, `Document` |
| 13.24 | inside `roles = [\|]` in the policy mixin | the same list as 13.31, the control in `profile_plain_read` |
| 13.26 | hover on the key `roles` in the policy mixin | the entry's type and description |

### Failure modes

- Any `check … : NO` line.
- A top-level keyword offered inside a mixin body.
- A field of an including model offered inside the mixin's `@@index([ ])`.
- A list in the mixin body that differs from its control.
- No signature inside a mixin body.

## Scenario 14 — Keys a mixin already provides

**What you're proving from the user's seat:** in a policy that includes a mixin, the editor does not suggest a key that would be a duplicate-member error.

**Covers:** slice `mixin-completion`

**Oracle:** ADR 269, "A member provided twice is an error"; slice spec `mixin-completion`.

**Steps file:** `mixin-body.json`, steps 14.x.

| Step | Position | Expected |
|---|---|---|
| 14.2 | an empty line in `profile_owner_read` (`target`, `+OwnerRead`, which provides `roles` and `using`) | neither `roles` nor `using` nor `target` |
| 14.5 | control: an empty line in `profile_plain_read` (`target` only) | `roles` and `using`; not `target` |
| 14.8 | an empty line in `document_any_read` with its own `using` removed (`target`, `+ToAppUser`, which provides `roles`) | `using`; not `roles`, not `target` |
| 14.10 | diagnostics | none |

### Failure modes

- `roles` or `using` offered in 14.2, or `roles` in 14.8.
- `using` missing in 14.8.

## Scenario 15 — Semantic tokens

**What you're proving from the user's seat:** a mixin is coloured like the block it is for, and an inclusion like a type reference.

**Covers:** slice `mixin-navigation`, "Semantic tokens"

**Oracle:** slice spec `mixin-navigation`: "A mixin body is tokenised by the walker for its keyword"; "An inclusion … is tokenised as a type reference: a namespace qualifier is `namespace`, the name is `type`. The `+` is part of the first token, the way `@` and `@@` are part of an attribute's first token."

**Steps file:** `navigation.json`, steps 15.x.

| Step | Lines | Expected |
|---|---|---|
| 15.1 | `model mixin Timestamps {` and its body | `model` keyword, `mixin` keyword, `Timestamps` type (declaration); per field a property (declaration), a type and a decorator; `@@index` decorator and `createdAt` property |
| 15.2 | `+auth.Timestamps`, `+SoftDelete`, `+Tenanted` in `Account` | `"+auth"` namespace and `"Timestamps"` type; `"+SoftDelete"` type; `"+Tenanted"` type |
| 15.3 | `policy_select mixin OwnerRead {` and its body | `policy_select` keyword, `mixin` keyword, `OwnerRead` type (declaration); `roles` and `using` properties with their values |
| 15.4 | `+OwnerRead` in a policy | `"+OwnerRead"` type |
| 15.5 | `enum mixin BaseRoles {` and its body | `enum` keyword, `mixin` keyword, the name, one property and one string per member |
| 15.6 | control: `model Account {` and two fields | the tokens of an ordinary model, for comparison with 15.1 |
| 15.7 | diagnostics | none |

### Failure modes

- No token on a line of a mixin body.
- `mixin` tokenised as a type or a name.
- An inclusion with no token, or a qualified inclusion with one token for the whole name.

## Scenario 16 — A `type` mixin

**What you're proving from the user's seat:** composite types, the fourth block kind the ADR names, take mixins too.

**Covers:** DoD-1, DoD-2

**Isolation:** `tmpdir`

**Oracle:** as scenario 1.

**Preconditions:** pre-flight done. `type/mixin/contract.prisma` declares `type mixin Geo { lat Float  lng Float }` and `type Address { street String  +Geo  city String }`, used by `model Shop`; `type/inline` writes the four fields in `Address`.

### Steps

```bash
for d in mixin inline; do
  (cd $Q/type/$d && node $C contract emit --output-path $Q/out/type-$d --format human --no-color > /dev/null 2>&1; echo "emit $d exit $?")
done
cmp $Q/out/type-mixin/contract.json $Q/out/type-inline/contract.json && echo "contract.json: byte-identical"
```

### What you should see

Two emits exit 0 and the `cmp` line prints.

### Failure modes

- An error at `+Geo`, or a composite type without `lat` and `lng`.

## Scenario 17 — Edit a mixin and its inclusion in two open files

**What you're proving from the user's seat:** with the mixin's file and the including file both open and neither saved, the editor follows every edit: deleting a mixin marks its inclusions, restoring it clears them, and a mixin that exists only in an unsaved buffer can be completed and included.

**Covers:** (journey; no AC)

**Oracle:** the editor must agree with what `contract emit` would say about the same text (scenario 3, case 3.1), and the files on disk are never read once a buffer is open.

**Steps file:** `diagnostics.json`, steps 17.x (same session as scenario 8; both files are open from 17.0 on).

| Step | Action | Expected |
|---|---|---|
| 17.1, 17.2 | delete the whole `model mixin SoftDelete` block in `shared.prisma` | one diagnostic, in `app.prisma`: `Cannot find mixin "SoftDelete"` at `+SoftDelete`; none in `shared.prisma` |
| 17.3, 17.4 | definition and hover on the now dangling `+Soft\|Delete` | no target, no hover |
| 17.5, 17.6 | delete the inclusion in `app.prisma` | none |
| 17.7 to 17.9 | type the mixin back in `shared.prisma`, then the inclusion in `app.prisma` | none |
| 17.10 | add `model mixin Fresh { freshAt DateTime }` to `shared.prisma` (never saved) | — |
| 17.11, 17.12 | type `+` in `model Draft` in `app.prisma` | the list contains `Fresh` |
| 17.13 to 17.15 | complete to `+Fresh`; diagnostics; definition | none; the declaration in the unsaved `shared.prisma` buffer |
| 17.16, 17.17 | rename the declaration by hand to `Fresher` | one diagnostic in `app.prisma`: `Cannot find mixin "Fresh"` |
| 17.18, 17.19 | fix the inclusion to `+Fresher` | none |

### Failure modes

- A diagnostic computed from the text on disk instead of the open buffer.
- A stale diagnostic after the fix, or a diagnostic in the wrong file.

### Restore

Nothing was written. `diff -r` of `$Q/lsp/project` against a fresh `make-scratch.mjs` output shows no change.

## Scenario 18 — Exploratory: things a user tries next

**Charter.** Explore mixins through `contract emit`, `contract print`, `contract format` and the language server with the scratch projects for 20 minutes, to discover shapes that surprise: declarations and inclusions in unusual places or spellings, mixins that carry attributes which must be unique per table, relation mixins, and edits that leave the schema half-written.

**Covers:** (no specific AC; surfaces unknowns)

**Isolation:** `tmpdir`

**Time budget:** 20 minutes.

**Starting points.** Two files of probes are provided so that a run can be repeated; add to them freely.

```bash
node $D/emit-cases.mjs $C $Q/errors/project $D/explore-cases.json | tee $Q/out/explore-emit.txt
(cd $Q/lsp && node $D/qa-driver.mjs $C project $D/explore.json | tee out/explore.txt)
```

`explore-cases.json`: a field named `mixin`; a model whose body is one inclusion; an empty mixin; a block on one line; comments around an inclusion; a mixin with `@@map` in two models (with its inline control); an unused mixin with an unknown type; an inclusion at the top level and in a `types` block; `model mixin { }`; a lone `+`; relation mixins with back relations; the same `@@index` from a mixin and from the model (with its inline control); a hyphenated mixin name.

In `explore.json`, step X.24 (the declaration changed to `mixin Tenanted {` while two models include it) is expected to give one `PSL_INVALID_DECLARATION` in `shared.prisma`, `Cannot find mixin "Tenanted"` at each of the two inclusions in `app.prisma`, and `Cannot find field "tenantId" on "Account"` at the `@@index` argument; X.26 is expected to show none after the keyword is typed back.

`explore.json`: rename of a namespace that qualifies inclusions; an invalid new name; `prepareRename` on the word `mixin`; navigation inside a mixin body; rename to an existing name; completion after `model ` and at the top level; LSP formatting of a badly spaced inclusion; a member added to a model that a mixin already provides; an inclusion typed inside a mixin; the declaration changed to `mixin Tenanted {` while two models include it; hover on a mixin's field and attribute.

**Notes capture:** write what you tried, what surprised you, and anything that felt off. Findings are classified in the report the same way as those of the scripted scenarios.

## Operator steps: VS Code — not run by the agent runner

1. Build and install the extension as `projects/lsp-rename/qa/manual-qa.md`, "Operator steps: VS Code", describes, and open `$Q/lsp/project`.
2. In `app.prisma`, inside `model Draft`, type `+` on a new line. The suggestion list opens without Ctrl-Space and shows `SoftDelete`, `Tenanted`, `auth`, `billing`.
3. Accept `auth`; the text is `+auth.` and the list reopens with `Timestamps`.
4. Ctrl-click `Timestamps`; `shared.prisma` opens at the declaration.
5. Press F2 on it, type `Stamps`, accept. Both files change; neither shows a problem.

## Sign-off coverage map

| AC ID | Scenario(s) covering it |
|---|---|
| DoD-1 — declare and include, four block kinds, top level and namespace, unqualified and qualified | 1, 4, 16 |
| DoD-2 — inline equivalence | 1, 16 (and 4, 7 as journeys) |
| DoD-3 — field order follows the inclusion's position | 2 |
| DoD-4 — diagnostics at the inclusion | 3, 8 |
| DoD-5 — a reference in a mixin to a field it does not declare | 3 (case 3.11) |
| DoD-6 — no call site reads members from a syntax node | (code search; not manual-QA scope) — see "Scenarios deliberately not in this script" |
| DoD-7 — `mixin X { }` and `model mixin { }` | 3 (cases 3.8, 3.9, 3.22) |
| DoD-8 — formatter | 6 |
| DoD-9 — go-to-definition and rename | 9, 11 |
| DoD-10 — completion after `+` | 12, V |
| DoD-11 — `prisma-7` grammar option | (parser tests; not manual-QA scope) — see "Scenarios deliberately not in this script" |
| DoD-12 — ADR and feature list | (file read; not manual-QA scope) — see "Scenarios deliberately not in this script" |
