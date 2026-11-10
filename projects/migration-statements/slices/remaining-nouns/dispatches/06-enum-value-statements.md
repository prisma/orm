# Dispatch 6 — enum values can be named in statements

**Slice:** [`../spec.md`](../spec.md) § "Statement grammar" and § "What each statement does", Enum values · **Plan:** [`../plan.md`](../plan.md) § PR 2 · **Branch:** `tml-3537-enum-values` (exists, from `origin/main`)

## Outcome

`--rename Status.ARCHIVED:Status.RETIRED` and `--delete Status.ARCHIVED` are understood as statements about an enum value. The framework resolves them against the origin and destination contracts, a resolved enum value rename reaches the family planner as its own statement kind, and a data-loss question can be about an enum value. No planner acts on them yet; dispatch 8 does that.

## Rules from the spec

- An enum value is named through its enum, by the member name the contract source uses: `Status.ARCHIVED`. The namespace prefix is allowed and needed only when several namespaces declare an enum of that name (`public.Status.ARCHIVED`).
- One resolving reading wins; several are refused with a message naming each reading, as for namespaces and models today. A model, value object and enum cannot share a name in a namespace, so `Status.ARCHIVED` is rarely ambiguous; when it is, the refusal says to qualify it.
- Both sides of a rename name a value of the same enum. A rename into another enum is refused.
- The old member name must exist in the origin enum and not in the destination; the new one in the destination and not in the origin, as for every rename.
- Native Postgres enums have no domain enum, so these statements never name one; nothing changes for them.

## Do

1. **Read the code first:** the resolver (`packages/1-framework/3-tooling/cli/src/control-api/statements/resolve-statements.ts`), the parsers beside it, the statement and subject types in `packages/1-framework/1-core/framework-components/src/control/migration-statements.ts`, and `plan-questions.ts`. The domain enum shape is in `packages/1-framework/0-foundation/contract/src/domain-types.ts`. Package paths moved on main recently; use the current tree.
2. **Tests first, red before each change:** the parser and resolver accept the two- and three-name forms and refuse the cases above with clear messages; `describeMigrationStatement` writes `rename enum value "Status.ARCHIVED" to "Status.RETIRED"`; JSON output names each side as a coordinate, consistent with the other statement kinds; a data-loss subject for an enum value has text `Status.ARCHIVED`, matching what `--delete` takes; every exhaustive switch over statement kinds and subject kinds handles the new kinds.
3. **MongoDB** refuses an enum value statement with one `statementRefused` message, as it refuses a namespace rename.
4. **The SQL family planner** receives the new statement kind and, for now, refuses it with one message saying enum value statements are planned in a later change of this branch. Dispatch 8 replaces that.
5. **Names:** reuse the existing vocabulary of the statement and subject types. Where a new type or kind needs a name, follow the pattern of its siblings (`model`, `field`, `namespace`). Say in your report every new exported name.
6. **Docs:** Migration System § Statements, the grammar paragraph only.

## Do not

- Do not plan any operation for an enum value. That is dispatches 7 and 8.
- Do not add enum value support to value objects; that is PR 4.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Only named files inside `test/integration` with `pnpm test <file>`.
- Use the shell's Node and `pnpm`. Never `npx`.
- No comments where the code can say it; no bare `as` casts in production code; no file extensions in imports; no backwards-compatibility exports; framework packages name no family or target.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.
- Save slow command output under `wip/` and read the file.

## Done when

- Typecheck; lint and `test --coverage` in framework-components, cli, family-sql (its current package name), and the Mongo target; `lint:deps`; `lint:ratchets`; `check:error-reference`.

## Report

Plain English, short sentences: the grammar rule and its refusal texts, the new kinds and names, the test that was red first for each change, the gates with results, anything the brief did not cover, and the commits.
