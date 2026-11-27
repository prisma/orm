# Slice 2: the facades pass on only what an application uses

One pull request. The project's purpose and rules are in [../spec.md](../spec.md); the decision for each path is in [../audit.md](../audit.md).

## Why

Each facade passes the platform packages on under its own name, whole: every path of the contract package, the component package, the general helpers, the family's control package, the target. `@prisma/orm-postgres` has 167 paths this way, and each would be promised until Prisma 9. An application uses 32 of them.

## What changes

1. **`packages/0-shared/publish-surface/src/shells.ts`** lists, for each forwarded package, the subpaths a facade passes on, instead of forwarding the package whole. The list is the audit's "keep" rows for `@prisma/orm-postgres`:

   - Generated and stored files: `contract-types`, `migration`, `contract/types`, `family-contract/types`, `target/codec-types`, `target/operation-types`, `target/migration`, and for a contract space's migrations `family/control` and `target/planner-target-details`.
   - Application code: `adapter/column-types`, `builder/runtime`, `builder/types`, `components/runtime`, `family-runtime`, `orm-client`, `target/codec-ids`, `target/full-text`, `target/runtime`, `vite-plugin-contract-emit`, and `migration-tools/{aggregate,hash,io,spaces}`.
   - The facade's own code, which does not change: `config`, `contract-builder`, `control`, `family`, `init`, `runtime`, `serverless`, `static`, `target`.

   `utils` is not passed on at all. The other four facades follow the same list, plus the MongoDB facade's own query modules (`orm`, `query-builder`, `value`, `query-ast/execution`).

2. **The examples, docs and skills** change each import of a removed path:
   - Code that is an extension (the extension packages of `examples/multi-extension-monorepo`, the in-application extension `examples/prisma-8-demo/src/extensions/engagement-stats.ts`) imports the platform package, as an extension author does, and its example lists that package.
   - Application code that imports a general helper (`utils/casts`, `utils/structured-error`) stops: an application does not need Prisma for a cast.
   - Application code that turns out to need a removed path is a finding for the audit. Either the path is kept, with its reason, or the application changes.

3. **Records for the API check**: one `path` record per removed path in each facade's `api-breaks.json`, with a reason that says what the import changes to.

4. **Upgrade instructions** for applications and extension authors list each removed path and its replacement, with a script where the change is one import line for another.

## To settle while building

- `driver/runtime`: the control plane imports `suppressIdleConnectionErrors` from it. If an application needs that function to run on a serverless platform, the facade keeps a way to reach it (the framework also exports it); otherwise the control plane changes.
- `components/ir`, `components/control`, `contract/enum-accessor`, `relational-core/ast`, `relational-core/aggregate-descriptor-registry`: imported by the examples' tests and their in-application extension. Each is either an extension author's import (it moves to the platform package) or an application's (it is kept).

## Outside this repository

- The control plane's four imports (`adapter/control`, `driver/control`, `target/control`, `driver/runtime`) change to `@prisma/orm-postgres/control`'s `createPostgresControlClient`, or to the platform packages. A pull request in prisma/pdp-control-plane, merged before this slice is released.
- Composer's import of `family-contract/canonicalization-hooks` changes to `@prisma/orm-family-sql/contract/canonicalization-hooks`, which Composer's extension pack is allowed to use as an extension author. A pull request in prisma/composer, merged before this slice is released.

## Done when

- `@prisma/orm-postgres` exports exactly the paths listed above, and the other facades exactly their lists.
- Every example builds and passes in CI.
- The API check passes, with each removed path recorded.
- A drive code review of the final commit is clean.
