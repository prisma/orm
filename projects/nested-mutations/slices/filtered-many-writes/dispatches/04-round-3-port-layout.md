# Brief: filtered-many-writes D4 round 3 — port layout per the port project's rules

## Task

The round-2 ports are accepted as faithful, complete over the matrix and passing. Their layout does not follow two rules of `projects/port-all-tests/spec.md` and its engine implementer brief, which earlier briefs in this slice did not carry. Restructure the layout only; test bodies, fixtures' content, assertions and run counts do not change.

## What to change

1. **One self-contained directory per upstream source file.** Per `projects/port-all-tests/briefs/engine-implementer.md` § "Per-source-file recipe" and `spec.md` line 132: the upstream path without `.rs` maps to the suite directory, with its own `_fixture/`, and a schema shared by two suites is duplicated into each. So:
   - `test/integration/test/ports/engines/writes/nested_mutations/already_converted/nested_update_many_inside_update/` with its test files and `_fixture/<variant>/` for the 81 schemas it uses;
   - `.../already_converted/nested_delete_many_inside_update/` likewise, with its own copies of the schemas it uses.
   No file in one suite directory imports from the other.
2. **No shared matrix helper.** `spec.md` § non-goals: "No provider-matrix generator, no schema templating engine; each ported test is a plain vitest test". Remove `relation_link_matrix.ts`. Register the runs with loops written inline in each test file, as `test/integration/test/ports/prisma/functional/relation-mode-gh-m-to-n/` does. Body modules that only hold test bodies for typing reasons may stay, inside the suite directory that uses them.
3. **Several test files per suite directory are acceptable** (one per relation pair), named after the suite, so the databases keep starting in parallel.
4. **The D1 port** (`combining_different_nested_mutations/`) already has its own directory; check it against the same recipe and adjust only if it deviates.
5. **Checklist dispositions:** update the paths in the 14 entries. The reviewer has ticked those boxes for faithfulness; leave the ticks as they are and change only the path text.

## Out

- Any change to test bodies, seed data, assertions, titles, or fixture schemas.
- `packages/`, the shared port harness, `projects/port-all-tests/spec.md` and its briefs.

## Completed when

- [ ] The two suite directories exist as described; nothing under one imports from the other; `relation_link_matrix.ts` is gone.
- [ ] The same 846 matrix runs pass, plus the D1 port.
- [ ] The 14 checklist paths are updated.
- [ ] The validation gates pass.

## Validation gates

- In `test/integration`: `pnpm typecheck`, `pnpm lint`, `pnpm test test/ports/engines/writes/nested_mutations`
- `pnpm fixtures:check`

Report the wall-clock time and the committed fixture size after the split.
