# non-ported: extensions/pdp

Source: `packages/client/tests/functional/extensions/pdp.ts`

Every test in this file exercises `$extends` query extensions in combination with Prisma's data-proxy
(Prisma Accelerate / PDP) transport: `customDataProxyFetch` hooks, `_runtimeDataModel`, engine-hash
headers, batch-request interception, and `$parent` inside interactive transactions — most are gated on
`TEST_DATA_PROXY`. Prisma 8 has neither a `$extends` client-extension surface NOR a Prisma
Accelerate/data-proxy transport (zero hits for `$extends`/`getExtensionContext`/`defineExtension`/
`customDataProxyFetch` across `packages/` outside node_modules/dist). The subject of each test is
inexpressible on both counts.

- `packages/client/tests/functional/extensions/pdp.ts` › `_runtimeDataModel is available on the client instance and provides model info` — subject: `_runtimeDataModel` (internal Accelerate/driver-adapter surface) is accessible inside a model extension's context — non-ported (no `$extends` client-extension surface; subject is `_runtimeDataModel` access inside model extensions / Prisma Accelerate/PDP internal)
- `packages/client/tests/functional/extensions/pdp.ts` › `Prisma-Engine-Hash headers is present when sending a request` — subject: the `Prisma-Engine-Hash` header is sent on data-proxy requests, testable via `customDataProxyFetch` in a query extension — non-ported (no `$extends` client-extension surface AND no data-proxy transport; subject is data-proxy header injection via `$extends` query extension, TEST_DATA_PROXY)
- `packages/client/tests/functional/extensions/pdp.ts` › `changing http headers via custom fetch` — subject: HTTP request headers can be mutated via `customDataProxyFetch` in a query extension — non-ported (no `$extends` client-extension surface AND no data-proxy transport; subject is HTTP header mutation via `$extends` query extension, TEST_DATA_PROXY)
- `packages/client/tests/functional/extensions/pdp.ts` › `confirm that custom fetch cascades like a middleware` — subject: multiple `customDataProxyFetch` hooks from chained query extensions compose correctly — non-ported (no `$extends` client-extension surface AND no data-proxy transport; subject is `$extends` query extension `customDataProxyFetch` middleware chaining, TEST_DATA_PROXY)
- `packages/client/tests/functional/extensions/pdp.ts` › `allows to override customDataProxyFetch for the whole batch` — subject: `customDataProxyFetch` can intercept batch data-proxy requests — non-ported (no `$extends` client-extension surface AND no data-proxy transport; subject is batch request interception via `$extends` query extension, TEST_DATA_PROXY)
- `packages/client/tests/functional/extensions/pdp.ts` › `an overridden method can call its parent and the itx is respected` — subject: a query extension method calling `$parent` respects interactive transactions — non-ported (no `$extends` client-extension surface AND no data-proxy transport; subject is `$parent` method invocation inside ITX via query extension, TEST_DATA_PROXY)
- `packages/client/tests/functional/extensions/pdp.ts` › `an overridden method can call its parent and the itx with a query extension is respected` — subject: ITX respect for `$parent`-calling query extensions with additional query extensions in the chain — non-ported (no `$extends` client-extension surface AND no data-proxy transport; subject is query extension + `$parent` + ITX interaction, TEST_DATA_PROXY)
- `packages/client/tests/functional/extensions/pdp.ts` › `customDataProxyFetch for batches stacks` — subject: `customDataProxyFetch` hooks from multiple query extensions stack correctly on batch data-proxy requests — non-ported (no `$extends` client-extension surface AND no data-proxy transport; subject is stacking of `$extends` query extensions' `customDataProxyFetch` on batches, TEST_DATA_PROXY)
