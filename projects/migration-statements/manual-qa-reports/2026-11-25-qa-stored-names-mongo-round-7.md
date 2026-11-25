# Manual QA — stored-name renames on MongoDB, round 7

Date: 2026-11-25. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `5ce6b0ce3e`. Script: `projects/migration-statements/slices/stored-name-renames/manual-qa-pr2.md`. Earlier round: `2026-11-25-qa-stored-names-mongo-round-6.md` in this folder.

Status: done. No document was lost, duplicated or put under the wrong model in any run. Every move case from round 6 still passes. Round 6 findings 19–23 are fixed, and what was left of 16 and 17 is fixed. All new cases pass when the printed text is followed. Four new wording warnings (findings 24–27), no blockers.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 6 helpers reused (`setup.sh`, `c.sh`, `p.sh`, `q.sh`, `ins-move.mjs`). Round 7 projects are `wip/qa-mongo/r7a`–`r7s`; new contracts `ctr/r7*.prisma`; move snippets `r7*-move.txt`.
- Each move was typed from the printed example, with a filter on a field only the moving model stores. To stop an apply, I inserted a document with a wrong type, bypassing validation.
- Helper note: `c.sh` hides a failed `contract emit`, because `p.sh` always exits 0. It caught me once in section 4 (an enum `@map` the Mongo contract does not accept gave "No changes detected"). Every other plan showed the expected changes, so its contract had emitted.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1a | Target exists with a validator; stop at the target's validator, fix, re-run | `r7a` | ✅ |
| 1b | Target created; moving model changes a stored name (`@map`, and a renamed field) | `r7b`, `r7c` | ✅; ⚠️ 24, 25 |
| 1c | `guests` renamed to `members` | `r7d` | ✅ |
| 1d | Moving model becomes a variant | `r7f` | ✅ |
| 1e | Variant route, two plans, with a stop and a late document | `r7e` | ✅ |
| 1f | Round 6 sections 3–4 again: two models leave, field dropped, fill, cast, target rewrite, rejected copy with a later validator update | `r7h`, `r7i`, `r7j`, `r7l`, `r7k`, `r7g`, `r7n` | ✅ |
| 2 | Round 6 findings 19–23, rest of 16 and 17 | `r7c`, `r7h`, `r7b`, `r7j`, `r7i`, `r7a`, `r7e` | ✅ all; ⚠️ 26 (rest of 19) |
| 3a | Refused renames in two source collections in one change | `r7p` | ✅; ⚠️ 27 |
| 3b | Every model leaves the source collection | `r7q` | ✅ |
| 3c | A rejected copy names the failing document's `_id` | `r7b`, `r7p`, `r7n` | ✅ |
| 4 | Plain `@@map`, `@map`, field and enum value renames | `r7s` | ✅ |

### 1. Round 6 move cases

- `r7a` (`User` → `Member @@map("members")`, `Admin.level @map("rank")`, `Guest` already in `members`): the route is now in paragraphs, each copy call on its own lines. Move at the start, with bypass. A bad `User` (`name: 42`) stopped it at `validator.members.update`, which named the `_id`. Fixed with the printed mongosh command, re-ran. End: `users` `[{a@x, rank 3}]`; `members` U1, U2, G1, Bad once each. Next plan "No changes detected".
- `r7b` (`members` new, `name @map("full_name")`): "right after the creation of collection "members"", no bypass, `$set`/`$unset` stages. A bad `User` (`name: 7`) stopped the copy (section 3c). Fixed it in `users`, re-ran: `3 of 4 operation(s)`. End: `members` U1, U2, Bad with `full_name` only; `users` the `Admin`. Next plan empty.
- `r7c` (`--rename User:Member --rename Member.name:Member.fullName`): left out both, as the refusal says. `4 operation(s)`; `members` U1, U2 with `fullName`. Next plan empty.
- `r7d` (`guests` → `members`): "right after the rename of collection "guests" to "members"", with bypass. `5 operation(s)`. End: `members` U1, U2, G1; `users` the `Admin`. Next plan empty.
- `r7f` (`User` becomes `Member @@base(Person, "member")`): stage `{ $set: { kind: { $literal: "member" } } }`, with bypass. End: U1, U2 with `kind: "member"`, G1 `kind: "guest"`. Next plan empty.
- `r7e` (variant route: `Note` leaves `tasks` for `notes`, `Feature` removed): the sentence about the first contract now comes before the steps. First plan with `Feature` kept, move at the start. A bad `Note` (`body: 7`) stopped it at `validator.notes.update`. Fixed it in `notes`, added `note three` to `tasks`, re-ran: applied, and `note three` was moved too. Second plan asked for `--delete Feature`; given, it deleted the feature document. End: `tasks` the bug only; `notes` all four notes and `jot`. Next plan empty.
- Also repeated, each followed to the end with an empty next plan: two models leave `users` (`r7h`, `7 operation(s)`); dropped field (`r7i`); fill refused, done in an earlier migration (`r7j`, G1 `score: 0`, U1 without it); cast on a shared field refused, done earlier with `--delete Guest.code` (`r7l`, U1 `code: "abc"`, G1 `code: 5`); cast on a field only `Guest` stores still plans with the move (`r7k`); target field rename refused, done earlier (`r7g`, G1 `mail`, U1 `email`); copy without the bypass rejected, fixed by adding the option (`r7n`).

### 2. Round 6 findings

- 16 ✅. The validator-check stop now ends "An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again."
- 17 ✅. The first-contract sentence comes before the steps, and the route is in short paragraphs.
- 19 ✅. The refusal quotes the statements as typed: "Leave out --rename User:Member and --rename Member.name:Member.fullName". See finding 26 for the one part left.
- 20 ✅. Both parts now say "before the plan's own operations on collection "users"", and one line at the end says "Both dataTransforms go in that one migration.ts. Run it to emit its ops.json, and apply it once with db migrate."
- 21 ✅. A rejected copy now says "The rejected document has _id ObjectId(…): find it with db.getCollection("users").find({ _id: … })", and offers "fix that document in its source, or change the pipeline". Fixing the source worked (`r7b`, `r7p`).
- 22 ✅. With `--rename User:Member`, the fill refusal is now printed in the same run, with its advice.
- 23 ✅. The route says "Its $unset stage deletes field "email" and its values from the moved documents, since the model they become does not store it."

### 3. New cases

3a, two source collections (`r7p`): `User` leaves `users` for `members` (exists), `Post` leaves `posts` for `articles` (new). One refusal lists both, with a part "For model "User"" (at the start, with bypass) and "For model "Post"" (right after the creation of `articles`, no bypass), then one "apply it once". I pasted both. A bad `Post` (`body: 9`) stopped the copy into `articles`; the message named its `_id`, which was the bad document. Fixed it in `posts`, re-ran: `6 of 8 operation(s)`. End: `users` the `Admin`; `members` U1, G1; `posts` the draft; `articles` p1 and the fixed one. Next plan empty. See finding 27.

3b, every model leaves `users` (`r7q`: `User` → `Member` in `members`, `Staff` → `Crew` in new `crew`): the route says to plan without the statements "and answer its question about models "User" and "Staff" with the --delete it offers: the copies below run before the plan drops collection "users", so they keep the documents". Followed: the plan asked, I gave `--delete Staff --delete User`, and pasted both moves before `dropCollection('users')`. A bad `User` stopped it at the `members` validator, after both copies; `users` was empty and still there. Fixed, re-ran: `4 of 7 operation(s)`. End: `users` dropped; `members` U1, G1, Bad; `crew` S1. Next plan empty.

3c, the `_id` in a rejected copy: in `r7b` and `r7p` it was the bad source document; in `r7n` it was the first `User`, which the old `members` validator rejects. The `find` query in each points at the source collection.

### 4. Other stored-name outputs

`r7s` (one model, not shared): `@@map("users")` → `"accounts"`, `name @map("full_name")`, enum value `USER` → `MEMBER`. Without a statement the plan asks, offering `--rename Role.USER:Role.MEMBER` or `--delete Role.USER`. With the rename: "Rename collection users to accounts", "Rename field name to full_name", "Replace value "USER" with "MEMBER"", validator update. Applied; documents read back with `full_name` and `role: "MEMBER"`. A later `--rename User.email:User.mail` planned and applied a field rename. Status up to date. No regression.

## Findings

Round 6 findings 19–23 are fixed, and so is what was left of 16 and 17. The four below are wording warnings; none stops the user or loses data.

### 24. ⚠️ The printed copy call loses its indentation

Every project. Each line of the example starts with `→ ` at the same depth, so `{ $match: … }` and `{ $merge: … }` are not indented under `rawAggregate("users", [`. It is still correct to copy. Wording preference.

### 25. ⚠️ A rejected copy always says to run the file with node

Projects `r7b`, `r7p`. The advice is "fix that document in its source, or change the pipeline … Run the file with node, then run the command again." Running the file is only needed after changing the pipeline. Doing it anyway is harmless. Wording preference.

### 26. ⚠️ The field statement alone still sends the user back once

Project `r7c` (the rest of round 6 finding 19). Giving only `--rename Member.name:Member.fullName` gets "Rename the origin model to "Member" with its own --rename statement before this one". Adding it gives the combined refusal, which then says to leave out both. Two runs, no dead end. Real but small.

### 27. ⚠️ With two source collections, the "leave out" paragraph is long

Project `r7p`. It joins both models' outcomes into one paragraph of about 150 words, repeating "is then removed and nothing is asked" and the validator sentence once for each model. Wording preference.

### Side note, not a finding of this change

`enum Role { ADMIN @map("admin") }` is refused on MongoDB: "an enum member takes no attributes". So enum stored-name changes on MongoDB go through a value rename, as tested.

## Cleanup

MongoDB is stopped. Scratch projects and contracts stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
