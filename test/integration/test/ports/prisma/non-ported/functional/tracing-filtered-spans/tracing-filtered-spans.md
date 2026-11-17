# Non-ported — tracing-filtered-spans

- `packages/client/tests/functional/tracing-filtered-spans/tests.ts` › `should filter out spans and their children based on name` — with PrismaInstrumentation `ignoreSpanTypes` (operation/compile/db_query patterns), `$connect`+findMany leaves only `prisma:client:connect`+`prisma:client:serialize` (empty for engineType 'client') [providers: all] — Prisma 8 has no public OpenTelemetry instrumentation or `ignoreSpanTypes` span-filtering surface, so the named parent/child span filtering behavior cannot be exercised
