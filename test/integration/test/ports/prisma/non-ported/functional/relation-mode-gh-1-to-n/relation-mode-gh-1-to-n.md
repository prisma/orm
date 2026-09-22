# Non-ported — relation-mode-gh-1-to-n

Source: `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_1-to-n.ts` (prisma/prisma@a6d0155).

Upstream matrix: provider × relationMode [foreignKeys, prisma] × referential action [DEFAULT, Cascade, NoAction, Restrict, SetNull] (applied to BOTH onUpdate and onDelete) × isSchemaUsingMap [false, true]. The ported suite covers every relationMode=foreignKeys × {Cascade, NoAction, Restrict, SetNull} × {@map=false, @map=true} cell (see `functional/relation-mode-gh-1-to-n/`). The cells below cannot be faithfully expressed.

## relationMode=prisma — no client-side referential-action emulation

Prisma 8 relies on real database foreign keys and has NO client-side relationMode="prisma" referential-action emulation. Every `testIf(isRelationMode_prisma)` prisma-mode test, and every MongoDB matrix entry (MongoDB runs only under relationMode=prisma in this suite), is non-portable.

- `tests_1-to-n.ts` › `1:n mandatory (explicit) > [create] > relationMode=prisma - [create] categoriesOnPostsModel with non-existing post and category id should succeed with prisma emulation` — create post with non-existing authorId succeeds under prisma emulation — Prisma 8 has no relationMode=prisma emulation.
- `tests_1-to-n.ts` › all MongoDB matrix entries [provider=mongodb, mode=prisma] — the whole suite under MongoDB runs only in prisma mode — Prisma 8 has no relationMode=prisma emulation.

## DEFAULT referential-action cell — Prisma-specific implicit default

The DEFAULT matrix cell emits a `@relation` with NO `onUpdate`/`onDelete` attribute. Prisma resolves a no-action relation to `onUpdate: Cascade, onDelete: Restrict`; Prisma 8 resolves a no-action relation to raw-DB `NoAction` for both (`packages/2-sql/9-family/src/core/psl-contract-infer/relation-inference.ts`, `DEFAULT_ON_DELETE`/`DEFAULT_ON_UPDATE = 'noAction'`). The DEFAULT cell's subject is Prisma's implicit no-action default; the explicit NoAction cell is ported and covers NoAction faithfully.

- `tests_1-to-n.ts` › all DEFAULT-action cases (relationMode=foreignKeys, both @map variants) across the action-gated `onUpdate: DEFAULT, Cascade` and `onDelete: …` groups — exercise Prisma's implicit `Cascade`/`Restrict` default — Prisma 8's no-action default is raw-DB NoAction (covered by the explicit NoAction cell).

## DEFERRABLE FK — no raw DDL / no array-form $transaction

- `tests_1-to-n.ts` › `1:n mandatory (explicit) > [delete] > onDelete: NoAction > relationMode=foreignKeys - [delete] parent and child in "wrong" order a transaction when FK is DEFERRABLE should succeed` [postgres/sqlite, mode=foreignKeys] — the subject is DEFERRABLE FK constraints: it `$executeRaw`s `ALTER TABLE … ALTER CONSTRAINT … DEFERRABLE INITIALLY DEFERRED`, then runs a batch `$transaction([delete child, delete parent, delete child])` in "wrong" order. Prisma 8 exposes no raw DDL/`ALTER` surface and no array-form `$transaction`, so making the FK deferrable and deleting parent/child in "wrong" order within one transaction is inexpressible.

## Type-half of a mixed type+runtime assertion

- `tests_1-to-n.ts` › `1:n mandatory (explicit) > [create] > [create] child with undefined parent should throw with type error` (type-error half only) — upstream asserts BOTH a `@ts-expect-error` on `authorId: undefined` AND a runtime throw. The runtime NOT NULL / FK throw IS ported (`[create] child with missing required FK throws at runtime`). The type-error half is non-portable: Prisma 8's create input legitimately accepts omitting the FK scalar `authorId` at the type level (it can be supplied via the `author`/`posts` relation), so there is no compile-time type error to assert.

## Upstream placeholder (not a real test)

- `tests_1-to-n.ts` › `1:n mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > [update] parent id with non-existing id should throw` — `test.todo(...)` placeholder with no body/assertions — nothing to port.
