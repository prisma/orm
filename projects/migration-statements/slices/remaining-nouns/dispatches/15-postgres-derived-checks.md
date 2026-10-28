# Dispatch 15 — Postgres derives a check for the discriminator column and for each value object column

**Plan:** [`../plan-pr3.md`](../plan-pr3.md) · **ADR:** ADR 309 decisions 2 and 3, and the plan's decisions on the `jsonpath` predicate and on value objects that contain themselves · **Grounding:** `wip/pr3-grounding.md` § D · **Builds on:** dispatch 12 · **Branch:** `tml-3537-value-objects-storage`

## Outcome

On a managed Postgres table:

- **Discriminator column.** A `membership` check with the values of the `<Base>.<field>` value set, rendered and named as an enum's membership check is. An enum-typed discriminator keeps only the enum's check (plan decision 2).
- **Value object column.** A new check kind whose name differs from the membership check on the same column (add it to `CHECK_KIND_SUFFIX` in `schema-ir/src/naming.ts`; pick the suffix from existing vocabulary and say why). Its expression is one strict `jsonpath` predicate that must hold, written so a NULL result fails: `"col" IS NULL OR jsonb_path_match("col", 'strict …') IS TRUE` for a nullable column, without the `IS NULL` arm for a required one. The predicate states, for each member, what the SQL ORM's JSON can hold:
  - the column is an object (or, for a list column, an array of objects);
  - each required member is present; a nullable member may be absent or JSON `null`;
  - no other key;
  - each scalar member's JSON type, from a codec-to-JSON-type table in the Postgres target (text, timestamps and UUIDs are `string`; integers and floats are `number`; booleans are `boolean`; JSON members are anything). For a codec the table does not know, check presence only, and list those codecs in the report;
  - lists, with element nullability;
  - enum members: the storage value set's values;
  - nested value objects, inlined. A value object that contains itself is checked in full down to where the cycle starts, and any object is accepted below, as the MongoDB validator does.
- The family resolves nested value objects from storage and hands the target a resolved definition, so the target needs no contract access. Extend the renderer input type in both places it is declared (`target-authoring-hooks.ts` and `check-expressions.ts`), or better, declare it once where both can import it.
- Non-managed tables get none of these checks, as for enum checks today (`stripDerivedChecksFromNonManagedTables` picks up a new kind through `CHECK_KIND_SUFFIX`).
- `contract print` does not print the new checks as `@@check` (`psl-print/model-attributes.ts`), so the print round trip stays lossless. `contract infer` on a live table with such a check prints it as an authored `@@check`, since infer produces no value objects; say so in the Data Contract docs or the infer docs.
- Check whether the SQL ORM writes SQL `NULL` or JSON `null` for an absent nullable value object column, and make the predicate accept both for a nullable column and neither for a required one.

## Do

1. **Tests first, red before each change, on PGlite:** for each shape (flat, nullable member, list member with and without nullable elements, enum member, nested, list of nested, nullable column, list column, a value object that contains itself), a row the ORM writes is accepted and a row with a missing key, an extra key, a wrong JSON type or a value outside an enum is refused. The discriminator check refuses a value no variant has. Unit tests for the rendered SQL text and the check names.
2. A new SQL fixture with nested and list members for these tests (`test/integration/test/sql-orm-client/fixtures/` or next to the Postgres target tests, whichever the existing derived-check tests use).
3. Implement.
4. Planner and verify: confirm `db update` from an empty database creates the checks, and `db verify` is clean afterwards, on PGlite.

## Do not

- Do not re-emit committed fixtures or examples, and do not change the example migrations (dispatch 16).
- Do not change MySQL or SQLite: they derive no checks today.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Only named files inside `test/integration` with `pnpm test <file>`.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory; save slow output under `wip/` and read the file.
- No comments where the code can say it; no bare `as` casts in production code; no `any`; no file extensions in imports; no backwards-compatibility exports; framework packages name no family or target; do not branch on target in family code. No invented nouns; a new name goes in the report with candidates.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- Typecheck, lint and `test --coverage` pass in `target-postgres`, `sql-contract-ts`, `schema-ir`, and every other package this dispatch touches; `lint:deps`; `lint:ratchets`; `fixtures:check` is expected to fail until dispatch 16, so list what it would change.

## Report

Plain English, short sentences: the check kind and suffix, an example predicate for a nested value object, the codec table and the codecs it does not know, the NULL finding, the test that was red first for each change, the checks, what is still red, and the commits.
