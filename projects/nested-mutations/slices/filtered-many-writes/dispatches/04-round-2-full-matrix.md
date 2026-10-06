# Brief: filtered-many-writes D4 round 2 — full matrix, titles, fixture formatting

## Task

Bring the D4 ports of `nested_update_many_inside_update.rs` and `nested_delete_many_inside_update.rs` in line with `projects/port-all-tests/spec.md`, which the round-1 brief did not carry. The ports themselves were judged faithful in seed data, query and assertions; this round changes their coverage of the upstream matrix, their titles and their fixtures' formatting.

## What to change

1. **Port the full matrix.** That spec forbids porting part of a matrix ("Port every in-scope case"). For each of the 14 upstream tests, port every schema variant the `relation_link_test` generator produces for its `on_parent` / `on_child` pair, on the Postgres connector, including the variants round 1 left out: mixed parent and child id shapes, every reference the child key can take, and the one-to-one variants that reference a unique. Use the parent lookup key the matrix names for each variant (`p`, `p_1_p_2`, or the id) instead of always `where({ p })`. Derive the exact list from the generator in `query-tests-setup`; do not rely on the count of 24 per one-to-many pair the reviewer estimated.
2. **A variant Prisma 8 cannot express or run** is not skipped silently: it gets its own line in the suite's non-ported file with the specific reason, or is a `test.fails` with a `failing.md` entry if it runs and differs. Report each one.
3. **Rename the three titles that contain "should"** (`pm_c1_req_should_work`, `pm_c1_should_work`, `pm_cm_should_work`, in both files where they occur). The no-"should" rule applies to ports. Keep the upstream function name findable: a descriptive title that still names the upstream function without the word, and checklist disposition text that cites the new title.
4. **F3: realign the fields in every `contract.prisma` fixture** so they are formatted consistently, including the new ones.
5. **Update the 14 checklist dispositions** for the new variant counts and titles. Boxes stay unticked.

## Decisions standing (do not relitigate)

- **`contains` is ported as `like('%x%')` in these tests.** The project owner allowed it for this project's ports where the string operator is incidental to what the test checks, as it is here (the filters only select rows by a substring of `c1`..`c4`). The written port rule is not amended; this is an exception for these ports, not a change to the rule. Do not edit `projects/port-all-tests/spec.md`.
- The shared-body approach (`describe.each` over variants, typed against one variant's contract) is accepted where the body touches only fields declared identically in every variant. With mixed id shapes in the matrix, check that still holds for every variant a body runs over; where it does not, type that group against a contract that matches.
- The two rejection tests assert `ORM.RELATION_MUTATION_UNSUPPORTED` plus the type error.
- No change under `packages/`. A variant that shows a behaviour gap is reported, not worked around.

## Completed when

- [ ] Every variant the generator produces for each of the 14 tests is a passing port, a `test.fails` with a ledger entry, or an individual non-ported line with its reason. The report gives the generator-derived variant list per relation pair and the disposition of each.
- [ ] No test title under `already_converted/` contains "should".
- [ ] All fixtures are consistently formatted; `pnpm fixtures:check` passes.
- [ ] The 14 checklist entries carry the updated disposition text.
- [ ] The validation gates pass.

## Operational metadata

- **Time-box:** 3 hours. Overrun → halt and surface with what is done.
- **Halt conditions:** the generator-derived matrix exceeds roughly 60 schema shapes in total (report the number and stop before generating them); more than five variants would be `test.fails`; a variant needs a source change.
- **Run time.** Each fixture starts its own PGlite database. Report the wall-clock time of the two files after the change.

## Validation gates

- In `test/integration`: `pnpm typecheck`, `pnpm lint`, `pnpm test test/ports/engines/writes/nested_mutations`
- `pnpm fixtures:check`
