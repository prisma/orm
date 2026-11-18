# non-ported: issues-13405-mongo-raw-itx

Source: `packages/client/tests/functional/issues/13405-mongo-raw-itx/tests.ts`

Regression test for #13405 and #14543: Prisma Client's MongoDB-specific raw-command methods
(`findRaw`, `aggregateRaw`, `$runCommandRaw`) work inside an interactive transaction (`$transaction`),
and iTX commit/rollback behave correctly when raw commands are involved.
Prisma 8 mongo has no `findRaw`, `aggregateRaw`, or `$runCommandRaw` equivalent on any public surface.

- `packages/client/tests/functional/issues/13405-mongo-raw-itx/tests.ts` › `mongo raw queries should work inside iTX > findRaw` — subject: `findRaw` inside an iTX inserts a document then retrieves it using a raw MongoDB filter — non-ported (Prisma 8 mongo ORM has no `findRaw` surface; `mongoRaw` provides `aggregate`/`insertOne` etc. but no `findRaw`)
- `packages/client/tests/functional/issues/13405-mongo-raw-itx/tests.ts` › `mongo raw queries should work inside iTX > aggregateRaw` — subject: `aggregateRaw` inside an iTX inserts a document then retrieves it using a raw aggregation pipeline — non-ported (Prisma 8 mongo ORM has no `aggregateRaw` surface)
- `packages/client/tests/functional/issues/13405-mongo-raw-itx/tests.ts` › `mongo raw queries should work inside iTX > runCommandRaw` — subject: `$runCommandRaw` inside an iTX issues a raw `insert` command and returns its result — non-ported (Prisma 8 mongo ORM has no `$runCommandRaw` / `runCommandRaw` surface)
- `packages/client/tests/functional/issues/13405-mongo-raw-itx/tests.ts` › `iTX functionality should work when using mongo raw queries > commit` — subject: an iTX that uses `$runCommandRaw` to insert a document commits correctly, making the document visible to a subsequent `findRaw` outside the transaction — non-ported (both `$runCommandRaw` and `findRaw` are absent from Prisma 8's mongo surface)
- `packages/client/tests/functional/issues/13405-mongo-raw-itx/tests.ts` › `iTX functionality should work when using mongo raw queries > rollback` — subject: an iTX that uses `$runCommandRaw` and then throws rolls back, making the inserted document invisible to a subsequent `findRaw` outside the transaction — non-ported (both `$runCommandRaw` and `findRaw` are absent from Prisma 8's mongo surface)
