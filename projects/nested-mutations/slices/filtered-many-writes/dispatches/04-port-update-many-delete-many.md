# Brief: filtered-many-writes D4 — port the nested `updateMany` and `deleteMany` suites

## Task

Port every test of two upstream engine suites into `test/integration/test/ports/engines/writes/nested_mutations/`, following `test/integration/test/ports/README.md` and the layout of your D1 port:

- `writes/nested_mutations/already_converted/nested_update_many_inside_update.rs` — 8 tests
- `writes/nested_mutations/already_converted/nested_delete_many_inside_update.rs` — 6 tests

Upstream nested `updateMany` is written as `r.where(w).updateAll(data)` and nested `deleteMany` as `r.where(w).deleteAll()`. An upstream `updateMany`/`deleteMany` with an empty filter is `r.updateAll(data)` / `r.deleteAll()`.

## Scope

**In:**
- The 14 ports with their fixtures (`contract.prisma`, `prisma.config.ts`, emitted `generated/`).
- `test/integration/test/ports/engines/failing.md` for any port that runs but cannot pass.
- `projects/port-all-tests/checklists/engines-writes.md`: for each of the 14 entries, append the disposition text after the entry in the format the file already uses. Leave every box unticked; the reviewer ticks them.

**Out:**
- Any change under `packages/`. If a port shows that `updateAll` / `deleteAll` behave differently from what the slice spec says, stop and report it with the failing test; do not change the assertion to make it pass, and do not change the source.
- MongoDB variants.
- The other upstream suites (D5).

## How to port

- These suites use `relation_link_test(on_parent = ..., on_child = ...)`, which runs each test over a matrix of schema variants (id shapes and which side holds the link) for one pair of relation sides. Port against the variants Prisma 8's PSL can express. In D1 you found the ToMany/ToMany matrix reduced to one schema; check each pair here, since the one-to-many pairs vary which side holds the key and the id shape. Where several variants are expressible and differ in what they exercise (for example simple id versus compound id), port each as its own test over its own fixture. State in your report which variants each test was ported against and which were left out and why.
- Same schema shape, logically the same query through the nearest Prisma 8 API, same assertions. A deviation needed for determinism (an explicit `orderBy`, an explicit `select`) is acceptable and is listed in your report.
- The two tests that assert an error on a to-one relation (`one2n_rel_error_nested_um`, `o2n_rel_fail`): upstream expects code 2009 because the field does not exist in the input type. Port them asserting Prisma 8's rejection (`ORM.RELATION_MUTATION_UNSUPPORTED` at runtime, and the type error where the fixture is an emitted contract).
- `pm_cm_should_work` for `deleteMany` on many-to-many: the ORM issues no junction delete. Use junction foreign keys that cascade if that is what makes the upstream assertions hold, and say so in the report. If the upstream assertions cannot hold under any faithful fixture, it is a failing port with an `engines/failing.md` entry stating the difference.
- A port that runs and fails for a real Prisma 8 difference is `test.fails` plus a `failing.md` entry. Nothing is recorded as non-portable in this dispatch without reporting it first.

## Completed when

- [ ] All 14 upstream tests have a port that is passing, or `test.fails` with a `failing.md` entry.
- [ ] Each of the 14 checklist entries carries its disposition text, box unticked.
- [ ] The report lists, per upstream test, the variants ported and any deviation from upstream.
- [ ] The validation gates pass.

## Standing instruction

Stay focused on the goal; control scope. Anything that pulls you off the goal halts and surfaces.

## Operational metadata

- **Time-box:** 2.5 hours. Overrun → halt and surface with what is done.
- **Halt conditions:** a port needs a source change; more than two tests would be failing ports; a suite's schema cannot be expressed in Prisma 8 PSL at all.

## Validation gates

- In `test/integration`: `pnpm typecheck`, `pnpm lint`, and `pnpm test` on `test/ports/engines/writes/nested_mutations`
- `pnpm fixtures:check`
- `pnpm --filter @internal/sql-orm-client test` is not needed; no source changes.

## References

- Upstream: `prisma/prisma-engines` at `e922089b7d7502aff4249d5da3420f6fa55fc6ad`, `query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/`. The `relation_link_test` macro and its schema generator are under `query-engine/connector-test-kit-rs/` (`query-test-macros`, `query-tests-setup`); read them to learn the matrix.
- Port corpus rules: `test/integration/test/ports/README.md`; failing ledger format: `test/integration/test/ports/engines/failing.md`.
