# ADR 320 — Each target package exports its minimum server version

**Status:** Accepted
**Date:** 2026-11-17
**Supersedes in part:** [ADR 222 — Version support policy](ADR%20222%20-%20Version%20support%20policy.md) (where the database server floor is declared and how drift is checked) and the "Enforcement" section of [ADR 248 — PostgreSQL floor lowered to 15](ADR%20248%20-%20PostgreSQL%20floor%20lowered%20to%2015.md)

---

## Decision

Each target package declares its minimum supported database server version as a constant in its own source, exported from a `server-version` entry point:

```ts
// packages/3-targets/postgres/1-target/src/core/server-version.ts
export const POSTGRES_MIN_SERVER_VERSION = '15';

// packages/3-targets/mongo/1-target/src/core/server-version.ts
export const MONGO_MIN_SERVER_VERSION = '8.0';
```

```ts
import { POSTGRES_MIN_SERVER_VERSION } from '@internal/target-postgres/server-version';
```

A target's `package.json` carries no Prisma configuration or metadata. The floors themselves are unchanged: PostgreSQL 15 and MongoDB 8.0.

## Why

Prisma 8 reads configuration from `prisma.config.ts`, where packages are imported. It does not read keys from a package's `package.json`, and a target package should not hold one there. A key in `package.json` looks like an extension point to anyone writing their own target, and they copy it, though nothing reads it.

A constant in the target's source is code the target owns. Tests can import it, and its value is checked by the type checker like any other export.

## How drift is checked

The CLI keeps its own copy, `MIN_SERVER_VERSION` in `packages/1-framework/3-tooling/cli/src/commands/init/templates/env.ts`, which the `prisma orm init` templates use for the `.env.example` comment and the "Requirements" section of the generated quick reference. The framework domain may not name a target package, not even in its tests, so the CLI cannot import the target constants.

The drift check is therefore the integration test `test/integration/test/cli.init-min-server-version.test.ts`. The integration test package depends on the CLI and on every target, and it asserts that the CLI's copy equals each target's exported constant. Integration tests are required in the merge queue, so a floor change that updates one value and not the other cannot merge.

To change a database floor:

1. Change the constant in the target's `src/core/server-version.ts`.
2. Change `MIN_SERVER_VERSION` in the CLI's `env.ts` to match.
3. For PostgreSQL, change the `postgres:<version>` service-container image tags in `.github/workflows/ci.yml` and the image in `docker-compose.yaml`.

## Consequences

- An outside author writing a target finds no `package.json` key to copy.
- The CLI still holds a copy of each floor. Removing it needs the init command to learn a target's floor from the target itself, which is part of making `prisma orm init` work for any target, and is not decided here.
- The drift check runs in the merge queue rather than on every pull request push.

## Alternatives considered

- **Keep the CLI unit test, reading the target's source file as text.** The CLI test would have to read a target's TypeScript file and pull the value out with a pattern. That is fragile and still couples the framework's tests to a target's file layout.
- **Add a minimum server version field to the target descriptor.** The init command could then read it from the target, and the CLI copy would go. That changes a shared framework type, and belongs with the design of a target-independent `prisma orm init`.
- **Keep the value in `package.json` under a new key name.** It would still be configuration in `package.json`, which Prisma 8 does not use.
