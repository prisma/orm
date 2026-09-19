# Non-ported — relation-mode-17255-mixed-actions

Source: `packages/client/tests/functional/relationMode-17255-mixed-actions/tests.ts`
(prisma/prisma@a6d0155). Schema is hardcoded MIXED (`Main.alice` = SetNull-on-delete /
Cascade-on-update, owns `Main.aliceId`; `Bob.main` = Cascade-on-delete / Cascade-on-update, owns
`Bob.mainId @unique`). The matrix action only selects WHICH row runs; the schema does not vary.
Upstream runs once per DB under BOTH relationMode [foreignKeys, prisma] (two postgres entries, both
Cascade/Cascade label over the same hardcoded mixed schema). The nested-`disconnect` case under
relationMode=foreignKeys is ported (passing) under
`test/ports/prisma/functional/relation-mode-17255-mixed-actions/`.

## No nested `delete` mutator

Prisma 8's nested-update relation mutator exposes only `create`/`connect`/`disconnect` — there
is no nested `delete` mutator (`RelationMutation` union in
`packages/3-extensions/sql-orm-client/src/types.ts`; factory in `relation-mutator.ts`). The
nested-`delete` behaviour under test cannot be expressed.

- `packages/client/tests/functional/relationMode-17255-mixed-actions/tests.ts` › `original > [update] main with nested delete alice should succeed` [mode=foreignKeys] — `main.update({ data: { alice: { delete: true } } })`; upstream expects SetNull on `Main.aliceId` (per the mixed schema), alice '1' deleted, bob count unchanged — no nested `delete` mutator.

## No relationMode=prisma emulation

Prisma 8 has no client-side relationMode=prisma referential-action emulation; it relies on DB
foreign keys. Both relationMode=prisma matrix entries are non-ported.

- `packages/client/tests/functional/relationMode-17255-mixed-actions/tests.ts` › `original > [update] main with nested delete alice should succeed` [mode=prisma] — no relationMode=prisma emulation (and no nested `delete` mutator).
- `packages/client/tests/functional/relationMode-17255-mixed-actions/tests.ts` › `original > [update] main with nested disconnect alice should succeed` [mode=prisma] — no relationMode=prisma emulation. (The foreignKeys variant of this test is the ported passing case.)
