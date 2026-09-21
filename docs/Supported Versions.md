# Supported versions

This page states the minimum versions of each runtime, database, and tool that Prisma 8 supports. These are hard floors, not "tested with" suggestions: versions below the listed minimums are untested and unsupported.

See [ADR 222](./architecture%20docs/adrs/ADR%20222%20-%20Version%20support%20policy.md) for the rationale and the policy that governs how these floors change over time. The PostgreSQL floor was lowered from 17 to 15 by [ADR 248](./architecture%20docs/adrs/ADR%20248%20-%20PostgreSQL%20floor%20lowered%20to%2015.md), which also records what PostgreSQL 16 and 17 would offer and the market data behind the choice.

## Runtime

| Runtime | Minimum version |
|---|---|
| Node.js | 24 |
| Bun | 1.2 |
| Deno | 2.0 |

Node.js is the primary supported runtime. Bun and Deno are supported on a best-effort basis; if you encounter a Bun- or Deno-specific issue, please file an issue and include your runtime version.

## Database servers

| Database | Minimum version |
|---|---|
| PostgreSQL | 15 |
| MongoDB | 8.0 |

The minimum version for each database is declared in the corresponding target package's `package.json` (`prismaNext.minServerVersion`) and mirrored in the CLI's `MIN_SERVER_VERSION` constant. A workspace-level test asserts these never drift. The `prisma orm init` scaffold generates a `.env.example` with a `# Requires <db> >= <version>` comment so fresh users see the requirement before they connect.

## TypeScript

**Minimum: 5.9**

TypeScript is declared as an optional peer dependency on every published package. "Optional" means Prisma 8 does not require you to install TypeScript — plain-JS consumers are unaffected. When TypeScript is present, version 5.9 or newer is required to get accurate types.

The minimum TypeScript version is the source-of-truth constant `MIN_TYPESCRIPT_PEER` in `scripts/validate-typescript-peer.mjs`. A CI lint gate (`pnpm lint:manifests`) verifies that every publishable package's peer declaration matches this constant.

## Consumer `tsconfig` requirements

Your project's `tsconfig.json` must set:

```jsonc
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

The `prisma orm init` command configures these automatically. If you are integrating Prisma 8 into an existing project, the `prisma orm init --merge-tsconfig` flag applies these options non-destructively.

## Module system

Prisma 8 is ESM-only. Every published package is `"type": "module"` and ships only `.mjs` entry points. CommonJS consumers (`require()`, `"type": "commonjs"`) are not supported.
