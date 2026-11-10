# Dispatch 3 — 4a's refusal goes; parity is tested; docs and the upgrade note

**Slice:** [`../spec.md`](../spec.md) · **Plan:** [`../plan.md`](../plan.md) · **Branch:** `tml-3553-ts-validator-pr2` · **Builds on:** dispatch 2 ([`02-typescript-builder-derives.md`](./02-typescript-builder-derives.md))

## Outcome

A field rename and a field removal on a TypeScript MongoDB contract plan and apply like PSL. The side-by-side test proves the two surfaces emit the same storage. Docs no longer say TypeScript contracts have no validator. A TypeScript user can follow the upgrade note as printed.

## What to build

1. **Remove 4a's temporary refusal.** Delete `packages/3-mongo-target/1-mongo-target/src/core/migrations/same-hash-field-changes.ts`, its call in `mongo-planner.ts` and its tests. Its journey `test/integration/test/cli-journeys/same-hash-field-changes.mongo.e2e.test.ts` (H1, H2) asserts the refusal: rewrite it to assert that a field rename (`--rename`) and a field removal (`--delete`) on a TypeScript contract plan, apply with `db migrate`, and leave the documents renamed or without the field. Remove the refusal's text from `docs/architecture docs/subsystems/7. Migration System.md` and anything else `git grep -n -i "same.hash"` finds outside released upgrade notes. If an error code existed only for the refusal, remove it and its error-reference entry.
2. **Parity, for good.** Remove the `validator` and `storageHash` strip in `test/integration/test/authoring/side-by-side-contracts.test.ts` (around lines 280–330) so it compares the whole storage.
3. **Docs and skill.**
   - `skills/prisma-8/references/contract.md` (around line 313): it says a TypeScript Mongo contract has no collection validator. Make it say both surfaces derive the same validator.
   - The MongoDB Family doc (`docs/architecture docs/subsystems/10. MongoDB Family.md`): the validator section covers both surfaces and the TypeScript refusals.
   - `git grep -n -i "no collection validator\|carries no collection validator\|no validator"` in `docs/`, `skills/` and package READMEs; fix every current statement. Leave released upgrade notes (`upgrade-instructions/releases/**`, `skills/prisma-8/upgrading/**/8.0.0-rc.*`) as they are.
4. **The app upgrade note.** Refine `upgrade-instructions/pending/mongo-typescript-contract-validator/app/instructions.md` (written in dispatch 2). It must say, in order:
   - What changes: a TypeScript MongoDB contract now gets a closed collection validator, and its storage hash changes once.
   - What is refused when the contract is built, with each message: a field whose codec has no MongoDB data type, a root model without a valid `_id` (keep this item's wording easy to change; Will is deciding whether a declared non-ObjectId `_id` stays allowed), an enum a validator cannot list, an embed of a model with variants.
   - The risk: MongoDB does not check existing documents when a validator is added, but every later write to a document must produce a valid one. A query, using `$jsonSchema` with `$nor`, that lists the documents that would fail, for each collection, taken from the emitted `contract.json`.
   - Steps: re-emit; run the query; fix or move the failing documents; apply with `db update`, or `migration plan` then `db migrate`; `db verify` is clean.
   - That the earlier advice in the rc.17 notes (use a TypeScript contract to avoid the validator) no longer works.
   - Detection patterns for `check:upgrade-coverage`.
5. **Follow the note as printed** on a TypeScript project against mongodb-memory-server or a local `mongod`: emit before, insert documents including one that would fail, upgrade, run the note's query, fix, apply, verify. Record the commands and output in `projects/migration-statements/manual-qa-reports/4p-upgrade-note.md`. Fix the note wherever following it fails or misleads.

## Done when

- The rewritten journey passes and fails if the refusal is put back (check by restoring it temporarily).
- The side-by-side test passes with nothing stripped.
- The QA report shows the note followed as printed, ending with `db verify` clean.
- Checks: `pnpm build`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm check:error-reference`, `pnpm lint:throws`, `pnpm lint:casts`, `pnpm check:upgrade-coverage`, `pnpm lint:docs` if it exists; lint and `pnpm test --coverage` in every touched package; every integration and e2e file under `test/integration` that mentions MongoDB, by name in groups, and the MongoDB journeys by name.
