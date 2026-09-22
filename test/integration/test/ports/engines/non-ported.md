# Non-ported — prisma/prisma-engines

One entry per in-scope source test that cannot be faithfully expressed against Prisma 8. Format:

`` - `<source file>` › `<test fn>` — <what it verifies> — <specific reason it cannot be ported> ``

No grouped or generalized entries: one line per test.

<!-- entries appended per batch -->

- `query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/not_using_schema_base/nested_create_many.rs` › `no_error_on_dups_when_skip_dups` — nested createMany with skipDuplicates true ignores duplicates — Prisma 8 exposes conflict skipping as `createAll(rows, { onConflict: 'skip' })` on a collection terminal only. Nested creates inside a parent `create`/`update` take no options argument, and giving them one is out of scope for that surface, so there is no nested form of this test to port.
