# Manual QA — stored-name renames, PR 2: MongoDB

> **Be the user.** Run the CLI built from this branch against a real MongoDB (mongodb-memory-server) in scratch projects, read every message as someone who has never seen this feature, and judge what the journeys cannot: whether a refusal tells you what to do next and that advice works when you follow it to the end, whether the output explains itself, and whether any document is lost, moved to the wrong model or misread.
>
> **Out of scope.** Do not run `pnpm test`, the journeys, or CI lints. Do not read the planner source to decide whether behaviour is right; decide from what the commands print and what the database holds.
>
> **Spec:** [`spec.md`](./spec.md) (MongoDB column) · **Decision:** ADR 324 · **Upgrade note:** `upgrade-instructions/pending/mongo-stored-name-renames/`

## What this tests

**Before.** On MongoDB, keeping `model User` and changing only `@@map("users")` to `@@map("app_users")` planned a drop of `users` and a create of `app_users`, and asked you to allow the data loss. A field's `@map` change unset the old key and asked; an enum member's changed stored value was removed and asked.

**Now.** The same changes are renamed with no question: `renameCollection`, a field rename, a key rename inside embedded models wherever they are stored, a stored value replacement. Swaps, chains, takeovers, a freed name reused in the same plan, and `--rename` on a shared collection are refused, each with a route. `db update` copes with a collection already renamed by hand.

## Scenarios

| # | Scenario | What it proves |
| - | -------- | -------------- |
| 1 | `@@map` change, `migration plan` then `db migrate`; and `db update` | Collection renamed with no question; documents and indexes kept; next plan empty |
| 2 | Field `@map` change on a root model and a variant; embedded model field `@map` stored in two collections | Keys renamed in every document, nothing asked, other variants untouched |
| 3 | Enum member stored value change, scalar and list field | Values replaced, nothing asked |
| 4 | `@@map` change together with a type change, a `--rename` field statement, and a removed field answered by `--delete` | Each is planned against the renamed collection; questions name the origin model and field |
| 5 | A script passing `--delete User` for a `@@map` change, as it had to before | Refused as an unused consent, with a message that says why |
| 6 | Two models swap collections; two fields swap `@map`; enum values swap; an enum chain | Refused; follow each printed route to the end; documents end under the right models |
| 7 | A removed model's collection taken by another model's `@@map` | Refused; follow the route; no document becomes another model's |
| 8 | `--rename` on a model that shares a collection with another root model | Refused; read what the text says the plan without the statement does, then do it and check that is what happens |
| 9 | `db update` after renaming the collection by hand in mongosh, with a field `@map` change in the same run | No collection operation; the field is renamed on the new collection |
| 10 | `db update` with both the old and the new collection present | Refused; follow each of the two fixes to the end |
| 11 | Upgrade note as an app developer **(judgement)** | You know what changes for you and what to remove from scripts |
| 12 | Exploratory, 20 minutes | Combinations the list missed: a variant `@map`, a discriminator typed by an enum, a value object with an enum, `--to`, no origin snapshot |

## Pre-flight

1. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`; `git status --short` shows no source changes. Note the commit you test.
2. `mise exec -- pnpm build`.
3. One scratch project per scenario under `wip/qa-mongo/`, using the CLI built from this branch. Copy the shape of `test/integration/test/fixtures/cli/` MongoDB fixtures if helpful. MongoDB from mongodb-memory-server, started by a small script under `wip/qa-mongo/` and stopped afterwards. Insert documents with a small script or mongosh-style driver calls, and read them back the same way.

## Report

Write `projects/migration-statements/manual-qa-reports/<YYYY-MM-DD>-qa-stored-names-mongo-round-<n>.md`: the commit tested; one section per scenario with what you ran, what you saw (paste outputs), and a verdict (✅ / ⚠️ / 🛑 Blocker). File every 🛑 and ⚠️ as a numbered finding with the exact commands and output, and say whether `origin/main` behaves the same when you can tell.
