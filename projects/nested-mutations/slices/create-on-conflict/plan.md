## Dispatch plan

Slice spec: `projects/nested-mutations/slices/create-on-conflict/spec.md`. Seven dispatches in three PRs, sequential. Tests first in each. Graph tests assert printed graphs; behaviour is asserted by integration tests on Postgres and SQLite, never by SQL text.

### PR 1 — options and `'skip'`

#### Dispatch 1: the options argument and its rejections

- **Outcome:** The mutator's `create` takes `{ onConflict, conflictOn? }` in both overloads and the descriptor carries it; the types offer `'skip'` on one-to-many relations only and no `'connect'` yet; parsing rejects, while the graph is built, `'skip'` on to-one and many-to-many (`ORM.RELATION_MUTATION_UNSUPPORTED`), an unknown `onConflict` value or `conflictOn` field (`ORM.RELATION_MUTATION_INVALID`), either value on a relation whose target is a variant stored in its own table (`ORM.RELATION_MUTATION_UNSUPPORTED`), and `'connect'` for now (`ORM.RELATION_MUTATION_UNSUPPORTED`). Type tests and unit tests for each.
- **Builds on:** The spec's chosen design; main at `34c2277210`.
- **Hands to:** A parsed nested `create` that carries validated options, which the translation ignores so far.
- **Focus:** `types.ts`, `relation-mutator.ts`, `relation-mutations.ts` / the translation's input checks. `CreateConflictOptions` and top-level `createAll` unchanged.

#### Dispatch 2: rows that cannot conflict

- **Outcome:** One function decides, from storage rows after create defaults, the conflict keys and the columns the parent link fills in, whether each row can conflict, per the spec's table; top-level `createAll` and `createAndCount` with `onConflict: 'skip'` reject a row that cannot with `ORM.ARGUMENT_INVALID` before any statement; an `upgrade-instructions/pending/` entry for app authors describes the change. Unit tests for the function (own value, ORM default, parent-link value, `null`, auto-increment, database default, `conflictOn` given and omitted), integration tests for the top-level rejection.
- **Builds on:** Main's `#resolveConflictSkip` and `createRowOf`.
- **Hands to:** The row check, callable from the nested translation with the parent-link columns.
- **Focus:** No nested behaviour yet.

#### Dispatch 3: `'skip'` on one-to-many

- **Outcome:** Nested `create(rows, { onConflict: 'skip', conflictOn? })` on a one-to-many relation in `create()` and `update()` inserts the rows that do not collide and leaves colliding rows unchanged and unlinked; a skipped row's relation callbacks do not run; a row that cannot conflict is rejected with `ORM.RELATION_MUTATION_INVALID`; `createAll`'s capability checks apply. Graph tests for rows with and without callbacks; integration tests on Postgres and SQLite, including an unrelated existing row that matches the conflict columns; the README paragraph for `'skip'`. PR 1 gates pass: package tests and typecheck, `pnpm lint`, `pnpm lint:deps`, the cast ratchet, `pnpm test:integration` for the touched suites on both targets.
- **Builds on:** Dispatches 1 and 2.
- **Hands to:** PR 1, ready to open.
- **Focus:** `addChildOwned` / `addChildInserts` / `nestedCreate` in `nested-mutations.ts`; batching as `createAll`.

### PR 2 — `'connect'`

#### Dispatch 4: `'connect'` on child-held relations

- **Outcome:** On one-to-many and child-held one-to-one, nested `create` with `'connect'` sends one insert per row with `ON CONFLICT (<conflict columns>) DO UPDATE SET <link columns> = excluded.<link columns>`: a colliding row is linked to the parent with its other fields unchanged, a row from another parent moves, a non-colliding row is inserted and linked; the row's relation callbacks run under the returned row; without `insertOnConflictTarget` the `upsert` check refuses a row that can also collide on another key; a row that cannot conflict is rejected. The runtime rejection of `'connect'` from dispatch 1 is lifted for these layouts only. Graph tests; integration tests on both targets, including an unrelated row matched by the conflict columns.
- **Builds on:** Dispatch 3's translation entry and dispatch 2's row check.
- **Hands to:** The `'connect'` conflict clause and the per-row insert, which dispatch 5 reuses with a different `SET`.
- **Focus:** The conflict action in `mutation-statements.ts`; `requireOnlyCollidingKey` shared with `upsertGraph`.

#### Dispatch 5: `'connect'` on parent-held and many-to-many relations

- **Outcome:** On N:1, parent-held one-to-one and many-to-many, `'connect'` inserts with `DO UPDATE SET <first conflict column> = excluded.<column>`, reads the row back by its conflict columns (collapsed by the read-back rule with `returning`), and links it: the parent's foreign key on parent-held relations, a junction insert with plain junction `connect`'s conflict clause on many-to-many. The types offer `'connect'` on every layout; the runtime rejection of dispatch 1 is removed. Graph tests with and without `returning`; integration tests on both targets in `create()` and `update()`, including an already-linked many-to-many target and an unrelated row matched by the conflict columns; the README paragraph for `'connect'`. PR 2 gates pass as in dispatch 3.
- **Builds on:** Dispatch 4.
- **Hands to:** PR 2, ready to open, and every layout the ports need.
- **Focus:** `addParentOwned`, `addJunctionOwned`, `readBack`; the D19 checks without `returning`.

### PR 3 — ports

#### Dispatch 6: `connectOrCreate` ports

- **Outcome:** `nested_connect_or_create.rs` (6), `prisma_11731.rs` (2), `if_node_siblig_dep_regression.rs` (1) each have a disposition: ported and passing, ported and failing with a `failing.md` entry, or unported with a ledger entry naming only what is still missing (the two tests with nested writes inside top-level `upsert`); fixtures emitted; checklist boxes in `projects/port-all-tests/checklists/engines-writes.md` updated.
- **Builds on:** Dispatch 5.
- **Hands to:** The `connectOrCreate` dispositions.
- **Focus:** Ports written from the upstream source at `e922089b`, per `test/integration/test/ports/README.md`.

#### Dispatch 7: `createMany`, pagination and the remaining dispositions

- **Outcome:** `nested_create_many.rs` (5, the `no_error_on_dups_when_skip_dups` entry removed from `engines/non-ported.md`), the three `m2m_many_children_*` tests of `nested_pagination.rs`, and `prisma_27452.rs` (1) each have a disposition, as in dispatch 6; checklists in `engines-writes.md`, `engines-queries.md` and `engines-new-raw.md` updated; `pnpm fixtures:check` and the ported suites pass on both targets.
- **Builds on:** Dispatches 3 and 5 (`'skip'`), dispatch 6's fixture layout.
- **Hands to:** PR 3, ready to open; the slice-DoD condition met.
- **Focus:** A pagination test that also needs a missing read feature is left unported with a ledger entry naming it.
