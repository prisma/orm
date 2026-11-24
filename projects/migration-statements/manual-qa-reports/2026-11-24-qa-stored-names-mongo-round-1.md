# Manual QA — stored-name renames on MongoDB, round 1

Date: 2026-11-24. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `a5e40f9cdc3e618fa3a254befec4201606dc3da7`. Script: `projects/migration-statements/slices/stored-name-renames/manual-qa-pr2.md`.

Status: done. No document was lost or moved to the wrong model by any plan the CLI wrote. Every refusal's two-plan route worked when followed to the end, under `db migrate` and `db update`. Five warnings, no blockers. The one document loss I saw came from a hand-written migration I wrote while following the advice of a refusal (finding 1).

## Setup

- `git status --short` was clean. `mise exec -- pnpm build` passed (all tasks cached).
- MongoDB 8.2.6 one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- One scratch project per scenario under `wip/qa-mongo/<name>`, each with its own database, made by `wip/qa-mongo/mk.sh`. Config is the public one: `definePrismaConfig` from `@prisma/cli-engine` and `defineConfig` from `@prisma/orm-mongo/config`, PSL contract. The CLI is the `prisma` binary of `examples/mongo-demo` (`wip/qa-mongo/p.sh`). Documents are written and read with the `mongodb` driver (`wip/qa-mongo/q.sh`). Logs are in `wip/qa-mongo/logs/`.
- `origin/main` was not run. Where I say main behaves the same, it is from the spec's "Today" column.

## Scenarios

| # | Scenario | Projects | Verdict |
| - | -------- | -------- | ------- |
| 1 | `@@map` change, both commands | `s1`, `s1u` | ✅ |
| 2 | Field `@map` on root and variant; embedded model key | `s2`, `s2e` | ✅ |
| 3 | Enum stored value, scalar and list | `s3`, `s3u` | ✅ |
| 4 | `@@map` with type change, `--rename` and `--delete` | `s4`, `s4u` | ✅ |
| 5 | Stale `--delete User` | `s5` | ⚠️ finding 4 |
| 6 | Swaps and chains | `s6a`–`s6f` | ⚠️ findings 2, 3, 5 |
| 7 | Takeover of a removed model's collection | `s7`, `s7b` | ✅ |
| 8 | `--rename` on a shared collection | `s8`, `s8b`, `s8c`, `s8d` | ⚠️ finding 1 |
| 9 | Hand rename, then `db update` with a field `@map` change | `s9` | ✅ |
| 10 | Old and new collection both present | `s10`, `s10b` | ✅ |
| 11 | Upgrade note as an app developer | — | ✅ |
| 12 | Exploratory | `x1`–`x7` | ⚠️ findings 2, 6 |

### 1. `@@map` change

`model User` with `email String @unique`, two documents, `@@map("users")` changed to `@@map("app_users")`.

```text
$ prisma migration plan --name rename
✔ Planned 1 operation(s)
└─ Rename collection users to app_users
db.getCollection("users").renameCollection("app_users");
```

`migration.ts` holds `renameCollection('users', 'app_users')`. After `db migrate`: collections `["app_users"]`, both documents, indexes `{_id:1}` and `{email:1}`, validator kept. The next `migration plan` says "No changes detected"; `db update --dry-run` says "No operations". `db update` (`s1u`) planned and applied the same single operation. Nothing was asked. ✅

### 2. Field `@map` on a root model, a variant and an embedded model

`Task` (base, `@@map("tasks")`) with variants `Bug` and `Feature`. `title @map("title")` → `"heading"`, `Bug.severity @map("severity")` → `"level"`. One `Feature` document also held a stray `severity` key (inserted bypassing the validator).

```text
├─ Rename field severity to level in collection tasks in documents whose type is "bug"
├─ Rename field title to heading in collection tasks
└─ Update validator on tasks (added: heading, level; removed: title, severity)
```

The stray key stopped the validator operation, as it should, and was left as `severity` on the `Feature` document: the variant rename touched only `bug` documents. I removed the stray key and ran `db migrate` again: "1 of 3 operation(s); the other 2 had nothing to do". End state: `{type:"bug", level:"high", heading:"crash"}`, `{type:"feature", effort:5, heading:"big"}`. Next plan empty.

Embedded model (TypeScript contract, `s2e`): `Line` embedded in `Order` as `lines` (list) and `main` (single); `sku` given `.mongo({ field: 'code' })`. Planned `Rename key "sku" to "code" at path "$" in field main` and `... at path "$[*]" in field lines`, plus the validator. Every document had the key renamed, `qty` kept. An embedded model cannot be stored in two collections: the contract refuses an embed relation from a second owner, so "two places" is two fields of one collection. ✅

### 3. Enum stored value

`ARCHIVED = "archived"` → `"retired"`, on `status Status?` and `tags Status[]`. Planned two `Replace value "archived" with "retired"` operations and the validator; nothing asked. `{status:"archived", tags:["archived","active","archived"]}` became `{status:"retired", tags:["retired","active","retired"]}`; other documents unchanged. `db update` (`s3u`) the same. ✅

### 4. `@@map` change with other changes

`users` → `app_users`, `score Int?` → `Float?`, `name` → `fullName`, `nick` removed. Without statements:

```text
✘ [CLI.CONSENT_REQUIRED]
  why: Remove field name from collection app_users would lose the values of field "User.name".
       Remove field nick from collection app_users would lose the values of field "User.nick".
```

The questions name the origin model and fields and the renamed collection. With `--rename User.name:User.fullName --delete User.nick`:

```text
├─ Rename collection users to app_users
├─ Rename field name to fullName in collection app_users
├─ Cast field score in collection app_users from int to double
├─ ⚠ Remove field nick from collection app_users
└─ Update validator on app_users (changed: score; added: fullName; removed: name, nick)
```

The collection rename is not listed under "Statements applied". Result `{email, score: 3 (double), fullName: "Ada"}`. Running `node migration.ts` again wrote a byte-identical `ops.json`. `db update` (`s4u`) gave the same question and the same five operations. ✅

### 5. Stale `--delete User`

```text
$ prisma migration plan --name rename --delete User
✘ [CLI.CONSENT_UNUSED] --delete User was given but nothing in this run asked about User.
→ Remove the flag, or spell the subject the way the command names it.
```

Same on `db update`, and for `--delete User.email`. Collection `users` untouched. Refused as intended, but see finding 4. ⚠️

### 6. Swaps and chains

- **Collections swap** (`s6a`): refused with "Cannot rename collection "accounts" to "users": collection "users" is renamed in the same plan" and a route through `prisma_swap_users` / `prisma_swap_accounts`. Followed with `migration plan` + `db migrate`: two renames, then two renames back. End: `users` holds the `Account` document, `accounts` the `User` document. Next plan empty.
- **Fields swap, different types** (`s6b`): `first String @map("x")`, `age Int @map("y")` swapped. Refused on both commands; route through `prisma_swap_x` / `prisma_swap_y` followed to the end. End: `{x: 36, y: "Ada"}`, correct for the new contract. See finding 3 for the wording.
- **Fields swap, same type** (`s6c`): see finding 2.
- **Enum values swap** (`s6d`): refused on both commands with a route through `"prisma_swap"` and `"prisma_swap_"`. Followed: scalar and list values ended swapped correctly. See finding 5 for the wording.
- **Enum chain** (`s6e`): `A` `"a"`→`"b"`, `B` `"b"`→`"c"`. Refused; route followed; end `["b","c"]`.
- **Collections chain** (`s6f`): refused; route followed with `db update` this time; end `accounts` holds the `User` document, `members` the `Account` document.

### 7. Takeover

`Account` removed, `User` moves to `accounts`. Refused on both commands, with `--delete Account` too:

```text
why: Cannot rename collection "users" to "accounts": the schema being planned from already has a collection "accounts"
→ ... Make the change in two plans: first remove model "Account", or keep it and change its collection to a name nothing uses, such as "prisma_swap_accounts", and plan and apply that; then make this change and plan again.
```

Route "remove" (`s7`): step 1 asked `--delete Account`, dropped `accounts`; step 2 renamed `users` to `accounts`. Only the `User` document is in `accounts`. Route "keep and move" (`s7b`, `db update`): `accounts` → `prisma_swap_accounts`, then `users` → `accounts`. Each document stayed with its model. ✅

### 8. `--rename` on a shared collection

`User` and `Admin` both `@@map("users")`; `--rename User:Member` with `Member @@map("members")`. Refused with "collection "users" also stores model "Admin"" and a long route. I checked the "without the statement" description twice:

- Validator accepts the `User` documents (`s8`): planned `Create collection members`, `Update validator on users`; applied; `users` still holds both documents, `members` empty. As the text says.
- `User` has a field `Admin` does not (`s8b`): the validator update stopped with `MIGRATION.PRECHECK_FAILED` naming the document. As the text says.

The hand-written route is finding 1. ⚠️

### 9. Hand rename, then `db update`

Renamed `users` to `app_users` with the driver, then `@@map("app_users")` and `email @map("mail")`:

```text
├─ Drop index email_1 on app_users (email:1)
├─ Rename field email to mail in collection app_users
├─ Create index mail_1 on app_users (mail:1)
└─ Update validator on app_users (added: mail; removed: email)
```

No collection operation. Both documents now hold `mail`. Next plan empty. ✅

### 10. Both collections present

```text
why: Cannot rename collection "users" to "app_users": the database has both collections
→ ... If the rename was half done by hand, or the application wrote to collection "app_users" before db update ran, ... move into collection "users" the documents of collection "app_users" that it does not already hold ... then drop collection "app_users", and run again. If collection "users" was renamed to "app_users" by hand and the name "users" then used for another collection, ... drop collection "users", and run again; ...
```

Fix 1 (`s10`): moved the one new document into `users`, dropped `app_users`, ran again: one rename, all three documents in `app_users`. Fix 2 (`s10b`): dropped the reused `users`, ran again: no operations, marker advanced, the `User` document in `app_users`. The claim that `db update` drops collections the contract does not have is true, and it asks `--delete logs` first. ✅

### 11. Upgrade note (judgement)

`upgrade-instructions/pending/mongo-stored-name-renames/app/instructions.md` tells me what changes (no question, no by-hand rename), what to remove from scripts (`--delete User`, `--delete User.email`, `--delete Status.ARCHIVED`), how to get an empty collection, and what is now refused. It also states the same-shape swap gap (finding 2). "This needs a snapshot of the contract the database is at" does not say what happens without one; the CLI does say it (finding 6). ✅

### 12. Exploratory

- **Same-shape collection swap** (`x1`): see finding 2.
- **Discriminator typed by an enum** (`x2`): `BUG = "bug"` → `"defect"` with `@@base(Task, "defect")` is asked as `--convert Bug`, as the spec says. `--convert Bug` replaced the value. Then `Task` `@@map("tasks")` → `"work_items"` with `Bug.severity @map("sev")` → `"severity"`: one collection rename, then the variant field rename on the renamed collection. Correct.
- **Enum in a value object** (`x3`): `HOME = "home"` → `"house"` in `address Address?` and `addresses Address[]`: replaced at `$.kind` and `$[*].kind`, nothing asked, other values untouched.
- **No origin snapshot** (`x4`): see finding 6. The route works when followed.
- **`--to`** (`s1`): `migration plan --to 20261124T0121_rename^` planned `Rename collection app_users to users`; `db migrate --to b3c00d8` applied it; documents back in `users`.
- **Freed collection name reused** (`x6`): new `Guest @@map("users")` beside `User` moving to `app_users`: refused with a two-plan route. Followed: rename first, then `Create collection users`. A new field `note @map("email")` beside `email @map("mail")` was planned in the same plan, as the spec allows.
- **Shared collection moves together** (`x7`): `User` and `Admin` both to `people`: one rename. Then `Admin.email @map("mail")`: refused with "renaming the field would rename it in the documents of "User" too", and advice to keep the stored name.
- Outside this change: the contract error for an embed relation from a second owner reads `targets "__unbound__.Line" which is owned by "Order", not "__unbound__:Invoice"`. The internal `__unbound__` prefix leaks into a user message.

## Findings

### 1. ⚠️ The hand-written route for a shared-collection rename cannot be followed with what it says

Command (`s8c`, schema with `User` holding `name` and `Admin` sharing `users`, changed to `Member @@map("members")`):

```text
$ prisma migration plan --name rename --rename User:Member
→ ... With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "User" into collection "members" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.
```

`prisma migration new` writes `operations() { return []; }`. "The other operations of the change" are a `createCollection('members', …)` and a `collMod('users', …)` with full `$jsonSchema` validators, which the user must write by hand; nothing says where to get them. Nothing names an operation for moving documents. I wrote `createCollection` and `collMod` copied from a plan, a `dataTransform` with `rawAggregate([... $merge into members])` and a check, and `deleteDocuments`. I set the check's `expect` the wrong way round, the transform was skipped as already done, `deleteDocuments` then ran, and the `User` document was lost:

```text
✔ Applied 1 migration(s) (3 of 4 operation(s); the other 1 had nothing to do, since their postchecks already held)
{"users":[{"email":"admin@x.com","level":3}],"members":[]}
```

The loss is my migration's fault, but the advice sends the user into this with no guidance. A route that worked (`s8d`): run `migration plan` without the statement, then edit its `migration.ts` to add the move (`dataTransform` with no check, `$merge` into `members`) and `deleteDocuments` before the `collMod`, run the file, and `db migrate`. End: `users` holds the `Admin` document, `members` the `User` document. Suggest the message says that: plan without the statement, then add the move to that `migration.ts` before the validator update.

### 2. ⚠️ A same-shape swap is "No changes detected" on `migration plan` and refused on `db update`

Commands (`s6c`: `first String @map("x")`, `last String @map("y")` swapped; `x1`: `User` and `Account` with the same fields swap `@@map`):

```text
$ prisma migration plan --name swap
✔ No changes detected
from:  d662dfeb…
to:    d662dfeb…

$ prisma db update --dry-run
✘ [MIGRATION.PLANNING_FAILED] … Cannot rename field "x" to "y" in collection "users": field "y" is renamed in the same plan
```

The contract hash does not change, so `migration plan` writes nothing and the application then reads first names as last names, or users as accounts, with no warning. The upgrade note states this. The spec lists it as today's behaviour on main, so it is not a regression. It is still the one swap that silently misreads data, and the two commands disagree on it.

### 3. ⚠️ The field swap route says "field name" where it means the stored name

Command (`s6b`): `migration plan --name swap` after swapping `@map("x")` and `@map("y")`:

```text
→ … Make the change in two plans: first give field "User.age" the field name "prisma_swap_x" and field "User.first" the field name "prisma_swap_y", field names nothing uses, …
```

A reader can take "give field "User.age" the field name "prisma_swap_x"" as renaming the field in the schema, which is a different change. The route works when read as `@map("prisma_swap_x")`. Suggest "the stored name" or `@map("prisma_swap_x")`, as the collection route says "the collection".

### 4. ⚠️ The unused `--delete User` message does not say why nothing asked

Command (`s5`): `prisma migration plan --name rename --delete User` after `@@map("users")` → `@@map("app_users")`:

```text
✘ [CLI.CONSENT_UNUSED] --delete User was given but nothing in this run asked about User.
→ Remove the flag, or spell the subject the way the command names it.
```

A user whose script needed `--delete User` before is not told that the collection is now renamed. The second hint suggests a typo, which is not the cause. The upgrade note explains it. This is shared CLI text; main likely prints the same.

### 5. ⚠️ Smaller wording points in refusal routes

- Enum swap (`s6d`): "no order of the rewrites moves values in a cycle" is hard to parse. The suggested temporary values `"prisma_swap"` and `"prisma_swap_"` differ only by a trailing underscore.
- Collection chain (`s6f`) and enum chain (`s6e`): the route moves every member through a temporary name, though only the one that takes the freed name needs it. The route still works.

### 6. ⚠️ Without an origin snapshot, `db update` says to answer with `--rename` when no answer is needed

Command (`x4`): `db update` project, `migrations/snapshots` removed, then `@@map("users")` → `"app_users"`:

```text
$ prisma db update --no-interactive
✘ [CLI.CONSENT_REQUIRED]
  why: Drop collection users would lose the data in "users", named by its storage name because the origin contract is unknown; --delete loses that data.
       If it was renamed, keep its data instead: store the snapshot of the contract the database is at, then run this command again and answer with --rename.
       …
       2. Run `prisma db update --advance-ref <name> --dry-run` …
```

I followed steps 1 to 3 with `--advance-ref db`. After the snapshot was stored, `db update` renamed the collection with no question, so "answer with --rename" is wrong for a `@@map`-only change. It is right only when the model's name changed too. The text also does not say which name to give `--advance-ref`; `db` worked. Likely the same text on main, where `--rename` was needed.

## Cleanup

The MongoDB server is stopped. Scratch projects and logs stay under `wip/qa-mongo/` (gitignored).
