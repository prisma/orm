# Brief: filtered-many-writes D5 — remaining ports and ledger corrections

## Task

Port the seven remaining upstream tests in this slice's scope, with the same rules as D4, and correct the two ledger entries that name a nested operation this slice has delivered.

## Scope

**In — ports:**

| Upstream file (under `query-engine-tests/tests/`) | Tests | Port into (under `test/integration/test/ports/engines/`) |
| --- | --- | --- |
| `writes/unchecked_writes/unchecked_nested_update_many.rs` | `allow_write_non_prent_inline_rel_sclrs`, `disallow_write_parent_inline_rel_sclrs`, `allow_write_autoinc_id` | `writes/unchecked_writes/` |
| `writes/top_level_mutations/delete_many.rs` | `nested_delete_many` only | `writes/top_level_mutations/delete_many/` |
| `new/regressions/prisma_8265.rs` | `nested_update_many_timestamps` | `new/regressions/` |
| `queries/filters/filter_unwrap.rs` | `many_filter` | `queries/filters/filter_unwrap/` |

**In — ledgers and checklists:**
- `allow_write_autoinc_id_cockroachdb` (fourth test of the unchecked file) is a CockroachDB-only variant. Record it in the suite's non-ported file with that reason; it is not ported.
- Delete `test/integration/test/ports/engines/non-ported/queries/filters/filter_unwrap/filter_unwrap.md` once `many_filter` is ported, and correct its checklist entry in `projects/port-all-tests/checklists/engines-queries.md`, which currently reads as non-ported.
- Rewrite `test/integration/test/ports/prisma/non-ported/functional/blog-update/blog-update.md` so its reason names only what is still missing: the single-row nested `update` on `profile`. Nested `updateMany` is no longer missing. Adjust the matching checklist line's reason text if it repeats the old reason.
- Append the disposition text to each affected checklist entry (`engines-writes.md`, `engines-new-raw.md`, `engines-queries.md`). Leave every box unticked that is unticked today; the reviewer ticks them. `many_filter` is already ticked as non-ported: change its disposition text and leave the tick for the reviewer to confirm.

**Out:**
- Any change under `packages/`. A port that shows a behaviour gap is reported, not worked around.
- The other tests in `delete_many.rs`, `prisma_8265.rs` and the other files; only the ones named.
- MongoDB variants.

## The standard these ports are held to

Read first, in full: `projects/port-all-tests/spec.md` (§ "No workarounds — THE hard gate", the non-goals, and the layout rules) and `projects/port-all-tests/briefs/engine-implementer.md`. That brief is written for `queries/` batches; everything in it applies here except its paths (`queries/` → the directories in the table above), its checklist file, and its case-500 cutoff. Where it and this brief differ on anything else, it wins, with these stated exceptions:

- **Layout:** one self-contained directory per upstream source file, named after the file without `.rs`, with its own `_fixture/` (variants under `_fixture/<variant>/`). The table's "port into" column gives the parent directory; the suite directory is the file name. No shared matrix helper; loops are written inline in the test file.
- **Every macro expansion is ported.** If a test uses `relation_link_test` or another schema generator, derive the full list from the generator and port every schema with every lookup key it names.
- **Each ported test is run individually** once, as that brief's recipe says, in addition to the directory run.
- **`contains` / `startsWith` / `endsWith`:** the project owner granted one exception for this project's ports: `contains` may be written as `like('%x%')` where the string operator is incidental to what the test checks and the seed data has no `%` or `_`. State each use in your report with the reason it is incidental. Where the string operator is the subject of the test, the rule stands and the test is non-ported.
- **Dispositions:** in this project you write the disposition text into the checklist entry and leave the box unticked; the reviewer ticks after an independent run. There is no inbox file.

## What these tests pin

- `disallow_write_parent_inline_rel_sclrs`: upstream rejects nested `updateMany` data that sets the foreign key linking the child to the parent (code 2009). Prisma 8 rejects it with `ORM.RELATION_MUTATION_INVALID`. Assert that, plus the type error where the fixture is an emitted contract.
- `allow_write_non_prent_inline_rel_sclrs`: setting another relation's foreign key through nested `updateMany` is allowed, including setting it to null.
- `allow_write_autoinc_id`: nested `updateMany` may write an autoincrement id.
- `nested_update_many_timestamps`: nested `updateMany` sets `@updatedAt` fields. This is the first test that exercises update defaults for nested `updateAll` on a database; D2 covered it with a stub only. If it fails, that is a behaviour gap in D2: stop and report it.
- `many_filter`: nested `deleteMany` with an `in` filter on child rows.

## Completed when

- [ ] The seven ports exist and are passing, or `test.fails` with an `engines/failing.md` entry.
- [ ] `filter_unwrap.md` is deleted; `blog-update.md` names only the single-row nested `update`; the CockroachDB variant has its non-ported line.
- [ ] Every affected checklist entry carries its disposition text.
- [ ] `rg -n "updateMany|deleteMany" test/integration/test/ports/prisma/non-ported test/integration/test/ports/engines/non-ported test/integration/test/ports/engines/non-ported.md` shows no entry whose stated reason is a missing nested `updateMany` or `deleteMany`. List what the search returns in your report.
- [ ] The validation gates pass.

## Standing instruction

Stay focused on the goal; control scope. Anything that pulls you off the goal halts and surfaces.

## Operational metadata

- **Time-box:** 90 minutes. Overrun → halt and surface with what is done.
- **Halt conditions:** a port needs a source change; `nested_update_many_timestamps` fails; a schema cannot be expressed in Prisma 8 PSL.

## Validation gates

- In `test/integration`: `pnpm typecheck`, `pnpm lint`, and `pnpm test` on the port directories you added
- `pnpm fixtures:check`
