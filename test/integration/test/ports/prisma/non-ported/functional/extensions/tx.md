# non-ported: extensions/tx

Source: `packages/client/tests/functional/extensions/tx.ts`

Every test in this file exercises `$extends` extension behavior inside array/batch `$transaction([...])`:
rollback/commit via normal and custom extension methods, isolation-level typing, and tuple
destructuring of the batch result on an extended client. Prisma 8 has no `$extends` client-extension
surface (zero hits for `$extends`/`getExtensionContext`/`defineExtension` across `packages/` outside
node_modules/dist), and separately the array/batch `$transaction([...])` form is itself absent (only
the interactive callback facade exists). The subject of each test is inexpressible.

- `packages/client/tests/functional/extensions/tx.ts` › `extended client in tx can rollback via normal call` — subject: a batch `$transaction([...])` on an extended client rolls back correctly — non-ported (no `$extends` client-extension surface; subject is rollback in array-form `$transaction` on extended clients)
- `packages/client/tests/functional/extensions/tx.ts` › `extended client in tx works via normal call` — subject: a batch `$transaction([...])` on an extended client commits correctly — non-ported (no `$extends` client-extension surface; subject is commit in array-form `$transaction` on extended clients)
- `packages/client/tests/functional/extensions/tx.ts` › `extended client in tx can rollback via custom call` — subject: rollback of an array-form transaction when a custom extension method throws — non-ported (no `$extends` client-extension surface; subject is custom extension method rollback in array-form `$transaction`)
- `packages/client/tests/functional/extensions/tx.ts` › `extended client in tx works via custom call` — subject: commit of an array-form transaction using custom extension methods — non-ported (no `$extends` client-extension surface; subject is custom extension method commit in array-form `$transaction`)
- `packages/client/tests/functional/extensions/tx.ts` › `isolation level is properly reflected in extended client` — subject: type-level — `$transaction` isolation level typing is correct on extended clients — non-ported (no `$extends` client-extension surface; subject is `$transaction` isolation level typing on extended clients)
- `packages/client/tests/functional/extensions/tx.ts` › `type inference allows for destructuring the array` — subject: type-level — the return type of a batch `$transaction` on an extended client can be destructured as a tuple — non-ported (no `$extends` client-extension surface; subject is type-level tuple destructuring of array-form `$transaction` results on extended clients)
