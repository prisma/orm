# One copy of the framework: the ORM slice

Linear: [TML-3724](https://linear.app/prisma-company/issue/TML-3724/literal-default-values-fail-prisma-contract-emit-when-two-versions-of). The work in the other repositories is in [plan.md](plan.md).

## At a glance

A project installs `@prisma/orm-postgres` 8.0.0-rc.19 and a `prisma` CLI that runs the ORM at rc.20. Today `prisma contract emit` fails on the first literal default with an internal error that names neither the cause nor the field:

```
✘ [CONTRACT.SOURCE_LOAD_FAILED] Failed to resolve contract source
  why: Codec pg/bool@1 takes only values of pg/bool, and was handed an object no data type constructed.
```

After this slice, every command and every client stops before it does anything, with:

```
✘ [RUNTIME.MULTIPLE_ORM_COPIES] Prisma ORM is loaded from 2 copies
  why: Values and registries made by one copy are not recognised by another, so every
       @prisma/orm-* package and the prisma CLI must use one version.
         8.0.0-rc.20  /app/node_modules/@prisma/orm-framework
         8.0.0-rc.19  /app/node_modules/@prisma/orm-postgres/node_modules/@prisma/orm-framework
→ Install the same version of every @prisma/orm-* package, and a prisma CLI that runs that version.
  `npm ls @prisma/orm-framework` shows which package brought each copy.
```

The wording above is a sketch; the implementer writes the final text to the CLI Style Guide. The pattern follows other libraries that need one copy: say that the library is loaded more than once, why that breaks, and how to find each copy. React says "more than one copy of React in the same app", graphql-js says "Ensure that there is only one instance of "graphql" in the node_modules directory", and MobX says "multiple, different versions of MobX active". The error is raised in the framework, which doesn't know the project's package manager, so the fix names the command for npm, pnpm and bun. Check each command's syntax before writing it.

## Why the copies break each other

Each folder that holds `@prisma/orm-framework` is a separate module to the runtime, with its own class definitions, even when two folders hold the same version. A default value is an instance of `DataTypeValueRecord` ([data-type.ts](../../packages/1-framework/1-core/framework-components/src/shared/data-type.ts)), marked with a private field, and a codec accepts only values carrying its own copy's field. Raw SQL defaults work across copies only because `SqlExpression` is marked with a `Symbol.for` key that every copy shares.

ADR 242 requires one copy of every internal module, because the codec and operation registries and the `instanceof` checks rely on it. So the fix is to report a second copy, not to make values cross copies. The version fixes that keep a second copy from being installed are in the `prisma` CLI and Composer repositories (see [plan.md](plan.md)).

## Chosen design

1. **Each copy records itself when it loads.** A new module in `framework-components` (`shared/framework-copies.ts`) adds its own module URL, without the query string, to a set kept on `globalThis` under `Symbol.for('prisma.orm.frameworkCopies')`. The same URL is recorded once, so a module that is evaluated again, as under `vi.resetModules`, is not a second copy. The pattern is the one [validate-once.ts](../../packages/1-framework/0-foundation/contract/src/validate-once.ts) uses.
2. **The two stacks refuse to build with more than one copy.** `createControlStack` and `createExecutionStack` call `assertOneFrameworkCopy()` from that module before anything else. The call also keeps the module, and its registration, in any bundle despite `"sideEffects": false`.
3. **The error is structured.** `RUNTIME.MULTIPLE_ORM_COPIES`, built with `runtimeError`, payload `copies: [{ folder, version }]`. `version` is read from the nearest `package.json` above each folder through `process.getBuiltinModule('node:fs')`. Where that is unavailable, the copy is listed by folder alone. The error is added to [error-reference.md](../../docs/reference/error-reference.md), which the docs site syncs.
4. **Extension-author docs state the dependency rule.** In [upgrade-extension.md](../../skills/prisma-8/references/upgrade-extension.md) and the [extension-author tools README](../../packages/0-shared/extension-author-tools/README.md):
   - Pin every `@prisma/orm-*` package at the one exact version your users' database package uses.
   - Take the target package as a peer dependency (ADR 242).
   - What `RUNTIME.MULTIPLE_ORM_COPIES` means, and how to find which package brought each copy.

## Coherence

One reviewer can hold this in one sitting. It adds one small module, two calls, one error code, a unit test, a packaging test, and two documentation edits. Reverting the PR restores today's behaviour.

## Scope

In:

- The registration module, the assertion, and the two calls.
- The error code and its error-reference entry.
- A unit test that loads the registration module from two URLs (an import with a query string is a second module instance) and checks the error and its payload.
- A packaging test in `test/integration/test/packaging/`, using the shell test kit's skewed-version stand-ins. It installs packed shells so that two copies of `@prisma/orm-framework` exist, as in the ticket's bun layout. It checks that `contract emit` on a contract with `@default(false)` fails with `RUNTIME.MULTIPLE_ORM_COPIES` and names both folders.
- The extension-author documentation above.

Deliberately out:

- Accepting values across copies. Ruled out: it hides a second copy instead of reporting it.
- Changing which ORM packages any published package takes as a peer. ADR 242's rule stands.
- The `contract.d.ts imports types from packages that are not installed: @internal/target-postgres` warning, seen in the same run. It is filed as its own ticket.
- The other three repositories ([plan.md](plan.md)).

## Edge cases already known

| Case | Required behaviour |
| --- | --- |
| npm's layout for the ticket's project: rc.19 at the top level, rc.20 nested under `prisma` | Refused. It works today only because each import happens to reach a matching copy. |
| Three folders of the same version, as bun installed rc.19 | Refused. Copies are counted by folder, not by version. |
| A workspace test that reaches `framework-components` through both its source and its `dist` | Fix the test. It already holds two copies; `scripts/lint-single-import-root.mjs` exists to prevent this. |
| An application with mismatched versions that works today | Fails when the client is created. Say so in the PR and the release notes. |

## Done when

- The ticket's bun reproduction, pinned to `@prisma/composer-prisma-cloud@0.33.0` and `prisma@8.0.0-rc.26`, prints `RUNTIME.MULTIPLE_ORM_COPIES` naming both versions.
- The same project at today's matching versions emits successfully.

## References

- ADR 242 (one copy of every internal module), ADR 239 (errors recognised by structure, not `instanceof`), ADR 254 (a data type alone constructs its values).
- Composer ADR-0046 (the ORM database package is a peer dependency); prisma-cli ADR 0004 (one CLI engine per install).

## Dispatch plan

The orchestrator writes the documentation: the error-reference entry, `upgrade-extension.md` and the extension-author tools README. Implementer dispatches:

### 1. Record copies and refuse a second one

- **Outcome:** `createControlStack` and `createExecutionStack` throw `RUNTIME.MULTIPLE_ORM_COPIES` when the framework is loaded from more than one URL, and a unit test proves it.
- **Builds on:** this spec.
- **Hands to:** the exported assertion, the error and its payload, and green package suites for `framework-components` and every package whose tests create a stack.
- **Gate:**
  - `pnpm --filter @internal/framework-components test`, `typecheck` and `lint`.
  - `pnpm lint:deps`.
  - `pnpm test:packages`, run once at the end and saved to a file, because every stack-creating test now runs the check.

### 2. One copy in this repository's own runs

Dispatch 1's check found that the repository runs two copies wherever a project imports published names. The root `prisma` bin is `@internal/cli`. Every example and app imports `@prisma/orm-postgres` and its siblings, which bundle their own framework copy. So `pnpm --filter bundle-size emit:pg` fails with `RUNTIME.MULTIPLE_ORM_COPIES`.

- **Outcome:** examples and apps run a `prisma` command that loads the CLI from the published toolchain build, so the CLI and the project share one copy.
  - `@internal/cli` gains one export subpath for `runOrmCli`. The toolchain shell forwards it as a `@prisma/orm-toolchain/cli` subpath.
  - A new private workspace package has a `prisma` bin that calls `runOrmCli` from that subpath. Nothing internal depends on it, so it adds no cycle.
  - Every example and app depends on it as a dev dependency. Their `prisma` scripts resolve to it, not to the root `@internal/cli` bin.
  - `@internal/cli`'s own test fixture (`test/fixture-app/package.json`) aliases its published database packages to the internal ones (`workspace:@internal/postgres@*`), so the CLI tests keep running from source.
  - The CLI telemetry harness runs `db init` with the new bin.
- **Builds on:** dispatch 1.
- **Hands to:** green CLI tests, CLI telemetry tests, `pnpm fixtures:check`, and every example's emit.
- **Gate:**
  - `pnpm build`, then `pnpm fixtures:check`.
  - `pnpm --filter @internal/cli test` and the CLI telemetry tests.
  - `pnpm lint:deps`.
  - Any integration or e2e test file that runs the CLI against a project importing published names, run by file.

### 3. The two-copy packaging test

- **Outcome:** a test in `test/integration/test/packaging/` installs packed shells with two copies of `@prisma/orm-framework`. It runs `contract emit` on a contract with `@default(false)` and gets `RUNTIME.MULTIPLE_ORM_COPIES` naming both folders.
- **Builds on:** dispatch 1's error.
- **Hands to:** the slice's done conditions, apart from manual QA.
- **Gate:** `pnpm --filter integration-tests test test/packaging/<new file>`, with no `--` before the path.
