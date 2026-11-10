# Slice plan — 3b, PR 3: value objects are storage entities, and a discriminator column names a value set

**Spec:** [`spec.md`](./spec.md) decision 1 · **ADR:** ADR 309 (approved by Will, 2026-10-21) · **Linear:** [TML-3537](https://linear.app/prisma-company/issue/TML-3537) · **Branch:** `tml-3537-value-objects-storage`, from `origin/main` · **Grounding:** `wip/pr3-grounding.md` (gitignored, in this worktree; code references at main 9979a2d6ca)

This PR changes the contract shape. It adds no statements; PR 4 adds the value object and variant statements on top of it.

## Decisions taken while planning (record each in ADR 309 in this PR)

- **The discriminator value set is SQL only.** On MongoDB the collection validator already pins each variant's discriminator value, so a change there already changes the storage hash.
- **An enum-typed discriminator keeps the enum's value set and check.** The column has one `valueSet` slot, and the enum already restricts it; a variant value outside the enum is already refused.
- **A clash between an enum's value set and a discriminator's is refused, and nothing else.** Enum value sets are keyed by the enum's name and a discriminator's by `<Base>.<field>`. Only an enum named exactly like a discriminator's key, in the same storage namespace, clashes. No authoring surface produces that today: PSL names are identifiers, and the SQL TypeScript builder has no polymorphism, so only a hand-written contract definition reaches it. The build still refuses it as a safeguard, naming both and saying to rename the enum. Enum names and members are otherwise unrestricted (Will, 2026-10-23: do not limit enum names to avoid a rare clash).
- **The Postgres value object check is one strict `jsonpath` predicate**, written so a NULL result fails (`IS TRUE`). The ADR's `?&` and `-` operators are not used.
- **A value object that contains itself** is checked as the MongoDB validator does: fully down to where the cycle starts, any object below.
- **Value object fields have no separate stored names**; they are stored under their own names in both families.
- **The example migrations change** (Will, 2026-10-23): each `examples/prisma-8-demo` migration that introduces a value object or a variant gains the operations that create the new checks. Users get an upgrade script for their own projects (Will, 2026-10-23).

## Gate for every dispatch

As for PR 2: typecheck; lint and `test --coverage` in every touched package; `lint:deps`; `lint:ratchets`; `fixtures:check` when contracts or rendering change; `check:error-reference`; `check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD` when a fragment is added. Integration and journeys by named file only. The reviewer runs code on PGlite and mongodb-memory-server, not only reads it.

## Dispatches

| # | Outcome | Builds on |
| --- | --- | --- |
| 10 | Contract shape and validators: a storage-plane value object entity in both families, a domain field referring to it by a storage coordinate (the first reference from domain to storage), validation across the two planes, the JSON schema, and the framework accessors | — |
| 11 | A plan whose storage hash changes but that has no operations is written and applied: `migration plan` writes it, `db migrate` and `db update` move the marker, on Postgres, SQLite and MongoDB | — |
| 12 | Authoring and build in both families write value objects into storage (SQL PSL, Mongo PSL, Mongo TS builder, Prisma 6 reader), and SQL PSL writes the discriminator value set and its column reference before the storage hash is computed; a clash between an enum's value set and a discriminator's is refused; the MongoDB validator derivation reads value objects from storage | 10 |
| 13 | Emit and types: `contract.d.ts` types read value objects from the storage plane, with a defaulted type parameter so contracts without value objects emit the same text | 10 |
| 14 | Runtime and tools read value objects through the domain field's reference: the SQL and Mongo ORMs and query builders, the CLI statement resolver, `contract print`, `contract infer`, verification | 12, 13 |
| 15 | Postgres derived checks: the discriminator membership check, and the value object `jsonpath` check for every shape SQL authoring produces, starting from a test per shape on PGlite; a new SQL fixture with nested and list members; contract print and infer recognise the new checks | 12 |
| 16 | Re-emit every fixture and committed contract; the `prisma-8-demo` migrations gain the operations that create the new checks; the app and extension upgrade fragments with a script that rewrites a user's contract snapshots and keeps their manifests' hashes consistent, validated by running it on a project with a real migration history; ADR 309, ADR 172 and ADR 178 notes, Data Contract and MongoDB Family docs, the skill | 11, 14, 15 |
| 17 | Journeys, docs and the PR text | 16 |

**Order:** 10 and 11 first (11 is independent); then 12 and 13; then 14 and 15; then 16; then 17. Then the two-reviewer `/drive-code-review`, fixes, manual QA, the PR.

**Risk notes from grounding:** the SQL PSL interpreter resolves polymorphism after the storage hash is computed (dispatch 12 must move the discriminator facts into the build); every `contract.d.ts` may change if the field-types expression changes (dispatch 13); existing rows with extra keys fail the new check at apply (upgrade notes, dispatch 16); the snapshot rewrite in the upgrade script changes storage hashes, so the script must rewrite the snapshot directories and every manifest that names them, or leave old snapshots readable (dispatch 16 decides, from the `data-type-in-contract` fragment of the rc.14 to rc.15 release, which rewrote contracts before).
