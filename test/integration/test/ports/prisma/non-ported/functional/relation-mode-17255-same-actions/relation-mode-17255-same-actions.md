# Non-ported — relation-mode-17255-same-actions

Source: `packages/client/tests/functional/relationMode-17255-same-actions/tests.ts`
(prisma/prisma@a6d0155). 1:1 + 1:1 graph with the SAME referential action on both relations
(`Main.alice` owns `Main.aliceId`; `Bob.main` owns `Bob.mainId @unique`). Upstream matrix runs
actions [DEFAULT, Cascade, NoAction, Restrict] (SetNull/SetNull filtered out) × relationMode
[foreignKeys, prisma]. Only the Cascade / relationMode=foreignKeys nested-`disconnect` case is
ported (passing) under `test/ports/prisma/functional/relation-mode-17255-same-actions/`.

Two gap classes below.

## No nested `delete` mutator

Prisma 8's nested-update relation mutator exposes only `create`/`connect`/`disconnect` — there
is no nested `delete` mutator (`RelationMutation` union in
`packages/3-extensions/sql-orm-client/src/types.ts` is `Create | Connect | Disconnect`; the
factory in `relation-mutator.ts` has no `delete`). The nested-`delete` referential-action behaviour
under test cannot be expressed. One line per source test (each runs across all portable
foreignKeys actions).

- `packages/client/tests/functional/relationMode-17255-same-actions/tests.ts` › `not-original > onUpdate: Restrict, NoAction, SetNull > relationMode=foreignKeys [update] main with nested delete alice should fail` [describeIf onUpdate∈{Restrict,NoAction,SetNull}, testIf foreignKeys] — `main.update({ data: { alice: { delete: true } } })` throws a FK/required-relation violation and leaves main/bob/alice rows unchanged — no nested `delete` mutator.
- `packages/client/tests/functional/relationMode-17255-same-actions/tests.ts` › `not-original > onDelete: DEFAULT > [update] main with nested delete alice should succeed` [describeIf onDelete=DEFAULT, foreignKeys] — nested `alice.delete` nulls `Main.aliceId`, deletes alice '1', leaves bob unchanged — no nested `delete` mutator.
- `packages/client/tests/functional/relationMode-17255-same-actions/tests.ts` › `not-original > onDelete: Cascade > [update] main with nested delete alice should succeed` [describeIf onDelete=Cascade, foreignKeys] — nested `alice.delete` cascades: bob count −1, main/alice/bob '1' all deleted — no nested `delete` mutator.

## No relationMode=prisma emulation

Prisma 8 has no client-side relationMode=prisma referential-action emulation; it relies on DB
foreign keys. Every `relationMode=prisma` matrix entry is non-ported. One line per source test,
mode=prisma.

- `packages/client/tests/functional/relationMode-17255-same-actions/tests.ts` › `not-original > onUpdate: Restrict, NoAction, SetNull > relationMode=foreignKeys [update] main with nested delete alice should fail` [mode=prisma] — no relationMode=prisma emulation (and no nested `delete` mutator).
- `packages/client/tests/functional/relationMode-17255-same-actions/tests.ts` › `not-original > onDelete: DEFAULT > [update] main with nested delete alice should succeed` [mode=prisma] — no relationMode=prisma emulation (and no nested `delete` mutator).
- `packages/client/tests/functional/relationMode-17255-same-actions/tests.ts` › `not-original > onDelete: Cascade > [update] main with nested delete alice should succeed` [mode=prisma] — no relationMode=prisma emulation (and no nested `delete` mutator).
- `packages/client/tests/functional/relationMode-17255-same-actions/tests.ts` › `not-original > onDelete: Cascade > [update] main with nested disconnect alice should succeed` [mode=prisma] — no relationMode=prisma emulation. (The foreignKeys variant of this test is the ported passing case.)
