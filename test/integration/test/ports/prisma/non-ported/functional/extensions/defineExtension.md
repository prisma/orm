# non-ported: extensions/defineExtension

Source: `packages/client/tests/functional/extensions/defineExtension.ts`

Every test in this file exercises `Prisma.defineExtension` — the standalone factory for building
`$extends` extensions (client/model/result components, callback and object forms, chaining, generic
type utilities). Prisma 8 has no `$extends` client-extension surface and no `Prisma.defineExtension`
(zero hits for `$extends`/`defineExtension`/`getExtensionContext` across `packages/` outside
node_modules/dist; `packages/3-extensions/` is database extensions, not client extensions). The
subject of each test IS the `defineExtension` mechanism itself.

- `packages/client/tests/functional/extensions/defineExtension.ts` › `client - callback` — subject: `Prisma.defineExtension` works with a callback for the client component — non-ported (no `$extends`/`defineExtension` surface; subject is Prisma.defineExtension callback API for client extensions)
- `packages/client/tests/functional/extensions/defineExtension.ts` › `client - object` — subject: `Prisma.defineExtension` works with an object for the client component — non-ported (no `$extends`/`defineExtension` surface; subject is Prisma.defineExtension object API for client extensions)
- `packages/client/tests/functional/extensions/defineExtension.ts` › `model - callback` — subject: `Prisma.defineExtension` works with a callback for the model component — non-ported (no `$extends`/`defineExtension` surface; subject is Prisma.defineExtension callback API for model extensions)
- `packages/client/tests/functional/extensions/defineExtension.ts` › `model - object` — subject: `Prisma.defineExtension` works with an object for the model component — non-ported (no `$extends`/`defineExtension` surface; subject is Prisma.defineExtension object API for model extensions)
- `packages/client/tests/functional/extensions/defineExtension.ts` › `result - callback` — subject: `Prisma.defineExtension` works with a callback for the result component — non-ported (no `$extends`/`defineExtension` surface; subject is Prisma.defineExtension callback API for result extensions)
- `packages/client/tests/functional/extensions/defineExtension.ts` › `result - object` — subject: `Prisma.defineExtension` works with an object for the result component — non-ported (no `$extends`/`defineExtension` surface; subject is Prisma.defineExtension object API for result extensions)
- `packages/client/tests/functional/extensions/defineExtension.ts` › `chained` — subject: a `Prisma.defineExtension` result can be applied multiple times and chained — non-ported (no `$extends`/`defineExtension` surface; subject is chaining of Prisma.defineExtension-created extensions)
- `packages/client/tests/functional/extensions/defineExtension.ts` › `invalid` — subject: calling `Prisma.defineExtension` with an invalid configuration throws — non-ported (no `$extends`/`defineExtension` surface; subject is Prisma.defineExtension validation of invalid configs)
- `packages/client/tests/functional/extensions/defineExtension.ts` › `generic model - callback via default` — subject: a generic model extension created via `Prisma.defineExtension` with a default type parameter works — non-ported (no `$extends`/`defineExtension` surface; subject is generic model extension typing in Prisma.defineExtension callback form)
- `packages/client/tests/functional/extensions/defineExtension.ts` › `generic model - object via default` — subject: a generic model extension created via `Prisma.defineExtension` with a default type parameter (object form) works — non-ported (no `$extends`/`defineExtension` surface; subject is generic model extension typing in Prisma.defineExtension object form)
- `packages/client/tests/functional/extensions/defineExtension.ts` › `generic client - object via default` — subject: a generic client extension created via `Prisma.defineExtension` (object form) works — non-ported (no `$extends`/`defineExtension` surface; subject is generic client extension typing in Prisma.defineExtension object form)
- `packages/client/tests/functional/extensions/defineExtension.ts` › `generic client - generic type utilities` — subject: `Prisma.Args`/`Prisma.Result`/`Prisma.Exact` etc. usable within a generic client extension created via `Prisma.defineExtension` — non-ported (no `$extends`/`defineExtension` surface; subject is Prisma generic type utilities in Prisma.defineExtension client extensions)
