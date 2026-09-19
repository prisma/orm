# Non-ported — relation-mode-gh-1-to-1

Source: `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_1-to-1.ts` (prisma/prisma@a6d0155).

Upstream matrix: provider × relationMode [foreignKeys, prisma] × referential action [DEFAULT, Cascade, NoAction, Restrict, SetNull] (applied to BOTH onUpdate and onDelete) × isSchemaUsingMap [false, true]. The ported suite covers every relationMode=foreignKeys × {Cascade, NoAction, Restrict, SetNull} × {@map=false, @map=true} cell (see `functional/relation-mode-gh-1-to-1/`). The cells below cannot be faithfully expressed.

## relationMode=prisma — no client-side referential-action emulation

Prisma 8 relies on real database foreign keys and has NO client-side relationMode="prisma" referential-action emulation. Every `testIf(isRelationMode_prisma)` / `.failing` prisma-mode test, and every MongoDB matrix entry (MongoDB runs only under relationMode=prisma in this suite), is non-portable.

- `tests_1-to-1.ts` › `1:1 mandatory (explicit) > [create] > relationMode=prisma [create] child with non existing parent should succeed` — create profile with non-existing userId succeeds under prisma emulation — Prisma 8 has no relationMode=prisma emulation.
- `tests_1-to-1.ts` › `1:1 mandatory (explicit) > [delete] > onDelete: SetNull > relationMode=prisma / SetNull: [delete] parent should throw` (`.failing`) — documents that prisma-emulated SetNull does not throw (prisma/prisma#15683) — Prisma 8 has no relationMode=prisma emulation.
- `tests_1-to-1.ts` › `1:1 mandatory (explicit) > [delete] > onDelete: SetNull > relationMode=prisma / SetNull: [deleteMany] parents should throw` (`.failing`) — same, deleteMany under prisma emulation — Prisma 8 has no relationMode=prisma emulation.
- `tests_1-to-1.ts` › all MongoDB matrix entries [provider=mongodb, mode=prisma] — the whole suite under MongoDB runs only in prisma mode — Prisma 8 has no relationMode=prisma emulation.

## DEFAULT referential-action cell — Prisma-specific implicit default

The DEFAULT matrix cell emits a `@relation` with NO `onUpdate`/`onDelete` attribute (`computeReferentialActionLine` returns an empty action line for DEFAULT). Prisma resolves a no-action relation to `onUpdate: Cascade, onDelete: Restrict`; Prisma 8 resolves a no-action relation to raw-DB `NoAction` for both (`packages/2-sql/9-family/src/core/psl-contract-infer/relation-inference.ts`, `DEFAULT_ON_DELETE`/`DEFAULT_ON_UPDATE = 'noAction'`). The DEFAULT cell's subject is Prisma's implicit no-action default, which Prisma 8 does not reproduce; the explicit NoAction cell is ported and covers NoAction faithfully.

- `tests_1-to-1.ts` › all DEFAULT-action cases (relationMode=foreignKeys, both @map variants) across the `[create]`/`[update]`/`[delete]` action-gated groups — exercise Prisma's implicit `Cascade`/`Restrict` default — Prisma 8's no-action default is raw-DB NoAction (covered by the explicit NoAction cell).

## Nested relation `update` mutator absent

- `tests_1-to-1.ts` › `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > [update] nested child [update] should succeed` — mutates a related row's own fields via `data:{ profile:{ update:{ id:'4' } } }` — Prisma 8's nested relation mutator (`packages/3-extensions/sql-orm-client/src/relation-mutator.ts`) supports only `create`/`connect`/`disconnect`; there is no nested `update` mutator to mutate a related row's fields.

## Type-half of a mixed type+runtime assertion

- `tests_1-to-1.ts` › `1:1 mandatory (explicit) > [create] > [create] child with undefined parent should throw with type error` (type-error half only) — upstream asserts BOTH a `@ts-expect-error` on `userId: undefined` AND a runtime throw. The runtime NOT NULL / FK throw IS ported (`[create] child with missing required FK throws at runtime`). The type-error half is non-portable: Prisma 8's create input legitimately accepts omitting the FK scalar `userId` at the type level (it can be supplied via the `user`/`profile` relation), so there is no compile-time type error to assert — asserting one would assert a falsehood.
