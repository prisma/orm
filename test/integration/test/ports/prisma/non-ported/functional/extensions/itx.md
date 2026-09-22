# non-ported: extensions/itx

Source: `packages/client/tests/functional/extensions/itx.ts`

Every test in this file exercises `$extends` extension behavior inside interactive transactions
(`$transaction(async tx => ...)`): extension propagation into the tx client, rollback/commit via
custom extension methods, client-component availability on the tx client, and denylist/isolation-level
typing of the extended tx client. Interactive transactions themselves ARE supported in Prisma 8
(the `postgres(...).transaction(async tx => ...)` facade), but the SUBJECT of each of these tests is
the `$extends` extension interacting with the tx — and Prisma 8 has no `$extends` client-extension
surface (zero hits for `$extends`/`getExtensionContext`/`defineExtension` across `packages/` outside
node_modules/dist). Without an extension mechanism there is no faithful subject to exercise.

- `packages/client/tests/functional/extensions/itx.ts` › `client is extended in itx` — subject: the client inside an interactive transaction carries the extensions defined on the outer client — non-ported (no `$extends` client-extension surface; subject is extension propagation into interactive transaction callback clients)
- `packages/client/tests/functional/extensions/itx.ts` › `extended client in itx can rollback via normal call` — subject: a transaction started on an extended client rolls back via a normal model call that throws — non-ported (no `$extends` client-extension surface; subject is rollback behavior in transactions started on extended clients)
- `packages/client/tests/functional/extensions/itx.ts` › `extended client in itx works via normal call` — subject: an interactive transaction on an extended client commits correctly — non-ported (no `$extends` client-extension surface; subject is commit behavior for transactions on extended clients)
- `packages/client/tests/functional/extensions/itx.ts` › `extended client in itx can rollback via custom call` — subject: a transaction on an extended client rolls back when a custom extension method inside the transaction throws — non-ported (no `$extends` client-extension surface; subject is rollback triggered by extension method errors inside transactions)
- `packages/client/tests/functional/extensions/itx.ts` › `extended client in itx works via custom call` — subject: a transaction using custom extension methods commits correctly — non-ported (no `$extends` client-extension surface; subject is commit using custom extension methods in transactions)
- `packages/client/tests/functional/extensions/itx.ts` › `client component is available within itx callback` — subject: client component extension methods are accessible on the transaction client inside the callback — non-ported (no `$extends` client-extension surface; subject is availability of client component extensions on the transaction client)
- `packages/client/tests/functional/extensions/itx.ts` › `methods from itx client denylist are optional within client extensions` — subject: methods on the denylist (not available on the tx client) are typed as optional within client extensions — non-ported (no `$extends` client-extension surface; subject is optional typing of denylist methods in client extensions within ITX)
- `packages/client/tests/functional/extensions/itx.ts` › `isolation level is properly reflected in extended client` — subject: type-level — the isolationLevel option on `$transaction` is correctly typed after extending the client — non-ported (no `$extends` client-extension surface; subject is `$transaction` isolation level typing after client extension)
- `packages/client/tests/functional/extensions/itx.ts` › `itx works with extended client + queryRawUnsafe` — subject: `$queryRawUnsafe` invoked on the transaction client of an extended client inside an interactive transaction — non-ported (no `$extends` client-extension surface; additionally no `$queryRawUnsafe` raw executor)
