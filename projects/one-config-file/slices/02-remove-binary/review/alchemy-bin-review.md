# Review: alchemy bin resolution (`fix/alchemy-bin-resolution`)

Range: `one-config-file/remove-binary...fix/alchemy-bin-resolution` in the `wip/composer` clone (6 commits). Reviewed as a principal engineer: failure modes, blast radius, operability.

## Summary

The fix is correct for the bug it targets. Composer no longer depends on a `node_modules/.bin/alchemy` link, which pnpm creates only for direct dependencies. QA run 2 shows `prisma dev` reaching ready in a plain pnpm project with no direct `alchemy` dependency. Moving the dev stack file's `localState` import behind `@prisma/composer/local-target` is the right second half: the app cannot resolve `alchemy` under pnpm either. The deploy stack file already imports only `@prisma/composer` entries.

The main problem is a claim, not the code. The guide, the skill and the `nodeExecutable` doc comment say Alchemy runs under Node whenever `prisma` runs under Bun. That is not true. Alchemy's own launcher (`node_modules/alchemy/bin/cli.js`) switches to Bun whenever `npm_execpath` or `npm_config_user_agent` names Bun. That covers `bun run <script>` and `bunx`, and QA run 4 shows the switch happening. Composer controls which runtime starts the launcher, not which runtime Alchemy ends up on.

Checks run: `bun test` in `packages/0-framework/3-tooling/cli` (223 pass, 1 skip) and `packages/0-framework/1-core/core` (239 pass); root `pnpm lint`, `pnpm typecheck` and `pnpm lint:casts` all exit 0, with no diagnostics in changed files.

Questions from the brief that resolved with no finding:

- `DEPLOY.NODE_MISSING` is registered in ADR-0044 and named in the guide and the skill. No other code list exists: no typed union, and no test that enumerates codes. Nothing else needs updating.
- The `local-target` re-export follows the exports-entrypoints rule: the file contains only re-exports and a comment. It does not breach ADR-0017. `/local-target` is a control-plane subpath (`architecture.config.json`), not an authoring entry, so no app bundle reaches it through the import graph.
- CI does not depend on Bun running Alchemy. The examples' `deploy` scripts run under `pnpm run`, and the e2e action (`.github/actions/deploy-verify-destroy/action.yml` line 51) runs `bun …/prisma` from a shell step. Neither sets Bun markers, so Alchemy runs under the first `node` on PATH. The old `.bin/alchemy` `#!/usr/bin/env node` shebang did the same, so CI behaviour is unchanged.

## Findings

### F01 (Medium): the docs say Alchemy always runs under Node, but Alchemy's launcher switches to Bun on its own

Location: docs/guides/deploying.md lines 51-56 and 112-116; skills/prisma-composer-core-concepts/SKILL.md lines 302-305 and 332-336; packages/0-framework/3-tooling/cli/src/run-alchemy.ts lines 90-95.

Issue: Composer starts `alchemy/bin/cli.js` with Node. That launcher then re-execs itself under Bun when `npm_execpath` contains `bun` or `npm_config_user_agent` starts with `bun/`. A Bun user who puts the documented form into a `package.json` script and runs `bun run deploy` gets Alchemy under Bun, which contradicts the guide. QA run 4 (`bunx prisma`) shows exactly this: the host runs under Node and Alchemy under Bun. Commit 222dffda says the old shebang kept Alchemy on Node "on purpose". Alchemy's launcher shows the opposite intent: it follows Bun when Bun invoked it.

Suggestion: First decide whether Alchemy on Node is a requirement. Nothing in the range or the QA shows a failure under Bun; the examples previously ran it under Bun under the same conditions. If it is not a requirement, say what actually happens: "Composer starts Alchemy with Node; Alchemy moves itself to Bun when you run through `bun run` or `bunx`." Then drop the "even when `prisma` runs under Bun" guarantee. If it is a requirement, remove the Bun markers from the child's environment, explain why in the ADR, and add a test for it.

### F02 (Low): "Shorter forms do not work" is contradicted by the QA

Location: docs/guides/deploying.md lines 51-56; SKILL.md lines 304-305.

Issue: In QA runs 4 and 5, `bunx prisma` and `bunx --bun prisma` both reach ready. They run but put the host or Alchemy on a different runtime. The guide blames only Bun's `node` shim for `bunx --bun`. Because of F01, the `bunx` environment markers would move Alchemy to Bun even if Composer skipped the shim. The limitation is documented, not silently wrong, but the stated cause is incomplete.

Suggestion: Reword to "these forms run, but `prisma` or Alchemy ends up on a different runtime", and fold in the F01 explanation. Do not add shim detection (for example, comparing the PATH `node` against `process.execPath`): the launcher would switch to Bun anyway.

### F03 (Low): the local-target entry now loads alchemy for every importer, and its public types depend on alchemy

Location: packages/0-framework/1-core/core/src/exports/local-target.ts lines 10-13.

Issue: `@internal/core/local-target` used to import only `effect/Layer`. It now imports `alchemy/State/LocalState` (effect FileSystem, alchemy telemetry metrics, the HTTP state API). `execute-log.ts` (`prisma log`) and the prisma-cloud local target now load that code too. Both CLI executors are loaded lazily, so the cost is small. Separately, `@prisma/composer/local-target` is a published subpath, so bumping the alchemy pin can now change Composer's public type surface. Nothing marks `localState` as meant only for the generated stack file.

Suggestion: Mark it `@internal` in a one-line doc comment, or move it to its own subpath used only by the generated file. Replace the three-line `//` comment with that doc comment.

### F04 (Low): the "no direct alchemy import" check covers only the dev stack

Location: packages/0-framework/3-tooling/cli/src/dev/__tests__/generate-dev-stack.test.ts lines 21-25; packages/0-framework/3-tooling/cli/src/__tests__/generate-stack.test.ts (no matching assertion).

Issue: The deploy stack file has the same pnpm constraint and currently satisfies it, but no test fails if someone adds an `alchemy` import to it.

Suggestion: Add `expect(content).not.toContain("from 'alchemy")` to `renderStackFile()`'s module-root test.

### F05 (Low): the resolver's real-world inputs are untested

Location: packages/0-framework/3-tooling/cli/src/run-alchemy.ts lines 27-70; packages/0-framework/3-tooling/cli/src/__tests__/run-alchemy.test.ts lines 25-118.

Issue: `makeTmpDir` resolves symlinks first, so no test reaches Composer through a symlink, which is the normal pnpm layout (`node_modules/@prisma/composer -> .pnpm/...`). Only QA covers the `realpathSync` step. Three cases have no tests: a string `bin`, an object `bin` without an `alchemy` key, and a `bin` that names a missing file. Also, `realpathSync(fromFile)` throws a raw `ENOENT`, not `DEPLOY.ALCHEMY_BIN_MISSING`, when `import.meta.url` is not a file on disk (bundled or virtual file systems).

Suggestion: Add a symlinked-Composer test and the three `bin` cases. Catch the `realpathSync` error and raise the structured error instead.

### F06 (Low): the `ALCHEMY_BIN_MISSING` fix text is wrong in some layouts

Location: packages/0-framework/3-tooling/cli/src/run-alchemy.ts lines 60-67.

Issue: Under Yarn PnP there is no `node_modules`, so the walk always fails, and "Reinstall your dependencies" sends the user in a loop. ADR-0017 lists PnP as a supported layout for loading the config. The old `.bin` lookup failed under PnP too, so this is not a regression.

Suggestion: Resolve with `import.meta.resolve('alchemy')` (honours the `import` and `bun` conditions and loader hooks), then walk up to the directory whose `package.json` is named `alchemy`. Otherwise, say in the fix text that PnP is unsupported.

### F07 (Low): Windows PATH handling is partly guessed

Location: packages/0-framework/3-tooling/cli/src/run-alchemy.ts lines 96-105.

Issue: The `PATH` key lookup ignores case, which is correct. But quoted entries such as `"C:\Program Files\nodejs"` are not unquoted, so `existsSync` misses them. `NodeRuntime.platform` can be injected, yet the split uses the host's `path.delimiter` and `path.join`, so a test with `platform: 'win32'` on POSIX would split on `:`. Ignoring `PATHEXT` is fine because Node always ships `node.exe`.

Suggestion: Strip surrounding quotes from each entry. Either use `path.win32` / `path.posix` according to `runtime.platform`, or drop `platform` from `NodeRuntime`.

### F08 (Low): deleting the `.cmd` shim test removed the only check that special characters in arguments arrive unchanged

Location: packages/0-framework/3-tooling/cli/src/__tests__/run-alchemy.test.ts lines 279-328.

Issue: The deleted Windows test passed the stage `spaces & symbols` and asserted the child received it literally. Without a shim, `cross-spawn` no longer goes through `cmd.exe`, so the main risk is gone. Still, no test on any platform now passes a stage containing shell metacharacters.

Suggestion: Use `spaces & symbols` as the stage in the existing capture test, which runs on every platform, including the Windows CI job.

## Deferred

- When the host runs under Bun, the first `node` on PATH may be older than 22.18. Alchemy's launcher then prints its own "use a newer node" error, and Composer runs no version check. Under a Node host the host's own engine check covers this.
- Any host that is neither Node nor Bun (for example Deno) passes its own `execPath` as "node". Out of scope until such a host is supported.
- Alchemy's update notice tells users to run `pnpm add alchemy@…`, which is wrong for Composer users because `@prisma/composer` pins alchemy (QA note). That belongs upstream or behind an environment variable that turns the notice off.
- Each package resolves its own alchemy: the CLI from `@prisma/composer-cli`, the stack file from `@prisma/composer`. They share one copy only because every package pins `2.0.0-beta.78`. A check that the pins stay equal would prevent two copies from appearing after an uneven bump.

## Verdict

Approve after F01 is fixed. F01 is a documentation and comment correction, plus a decision on whether Node is actually required. F02 to F08 are small and can land in this PR or right after it. No finding blocks the bug fix itself.

## Round 2 verification

Range `origin/main...HEAD` in `wip/composer-alchemy-bin` (head 2ac4bea1, 14 commits, rebased). Checks: `bun test` in the cli package (238 tests, 0 fail, 1 skip) and core (240 pass); root `pnpm lint` and `pnpm typecheck` exit 0, no diagnostics in changed files. `git diff 34968220 HEAD -- packages` is empty, so the second strict-pnpm QA run covers the reviewed code.

| ID | Status | Evidence |
| --- | --- | --- |
| F01 | FIXED | e7adf94e, 0a1072bf: guide § Runtime table, SKILL.md and the `nodeExecutable` doc comment now say the launcher may move to Bun under `bunx` / `bun run`. |
| F02 | FIXED | Same commits: the table gives the runtime of `prisma` and of Alchemy for each invocation instead of "shorter forms do not work". |
| F03 | FIXED (cost accepted) | b2fd0ce2: `devState()` replaces the raw `localState` re-export. Its return type `AlchemyStateLayer` was already public through the state descriptor's `create()`, so no new Alchemy type reaches the subpath. Importing `/local-target` still loads Alchemy's file store; both importers load lazily. |
| F04 | FIXED | `generate-stack.test.ts` "imports alchemy only through @prisma/composer". |
| F05 | FIXED | `alchemy-bin.test.ts`: symlinked strict-pnpm layout, string `bin`, `bin` without the key, missing bin file, missing app directory (the `realpathSync` error is now caught). |
| F06 | FIXED | `alchemy-bin.ts` fix text says Yarn Plug'n'Play is unsupported. |
| F07 | FIXED | 34d28bb0: quoted PATH entries are unquoted; `path.win32` / `path.posix` follow `runtime.platform`; PATHEXT honoured; win32 tests run on POSIX. |
| F08 | FIXED | `run-alchemy.test.ts` `spawnCommandLine()` capture test passes stage `spaces & symbols` on every platform. |
| D01 | FIXED | a1b34d43: `resolveAlchemyBin(appDir)` anchors at the app's `@prisma/composer`; QA run 2 shows the child is the `alchemy` beside `@prisma/composer`, not beside `@prisma/composer-cli`. |
| D02 | ACCEPTED-AS-IS | Core cannot hold `node:` imports (core-model.md invariant 5). The lookup no longer uses `@internal/cli`'s own location, so the undeclared-dependency concern is gone: it reads the app's install, not the CLI package's. |
| D03 | PARTIAL, accepted | The walk stays. The module comment gives the reason (alchemy exports neither `package.json` nor its bin and has no `require` condition, which I confirmed in the installed manifest; Bun has no `module.findPackageJSON`). The first step uses Node's resolver. The ADR-0007 addendum does not mention the walk; the module comment is enough. |
| D04 | ACCEPTED-AS-IS | The cross-package manifest test is gone. After D01 a pin mismatch costs disk space, not correctness. See F11 for what the removal leaves unrecorded. |
| D05 | FIXED | 2ac4bea1: deploy-cli.md § Runtime paragraph and step 7 link; local-dev.md links instead of repeating. |
| D06 | FIXED | a1b34d43: adapters return `commandLine`; `reproduceCommand()` prints it (`run-alchemy.test.ts` "is the command line the adapter started", `operations.test.ts`); ADR-0007 addendum. |
| D07 | FIXED | `resolveAlchemyBin`, `HostRuntime`, `readPackageJson`; ADR-0044 note that `dev` raises the `DEPLOY` converge codes. |
| D08 | FIXED | Same as F03. |

### Questions from the brief

- **`@prisma/composer/package.json` and the exports map.** It works because `@prisma/composer`'s hand-maintained exports map has `"./package.json": "./package.json"` (an unconditional string, so the `require` condition `createRequire` uses matches). It has been there since the package took that name (8d495c60), so every published version has it. Removing it would break the lookup, and the test "resolves the alchemy installed with a workspace app" (real `examples/orm-demo`, real workspace `@prisma/composer`) would fail, so the dependency is covered.
- **Version skew (D01).** The child's `alchemy` and the stack file's `alchemy` are now the same by construction: the stack file sits in `<cwd>/.prisma-composer/`, so its `@prisma/composer` import resolves exactly as `createRequire(<cwd>/package.json)` does, and Node and Bun both resolve `alchemy` from `@prisma/composer`'s real path by walking the `node_modules` above it, which is the walk `alchemyPackageDirAbove` does. A different `@prisma/composer-cli` version no longer matters for the Alchemy copy. The remaining skew, the CLI's inlined core writing `PRISMA_COMPOSER_CONTAINER_*` for the app's `@prisma/composer` to read, existed before this PR and is out of scope.
- **Header command.** The headers name `<node> <bin of the alchemy @prisma/composer depends on> …`, which is not copy-pasteable, but the ADR-0007 addendum amends the promise to "the failure output prints the exact command", and the bisection property holds with it. Acceptable.
- **`commandLine` quoting.** See F09.
- **`devState()` typing.** See F03 row.
- **`@prisma/composer-cli` still needs `alchemy`.** See F11.
- **Strict-pnpm QA.** Credible: `hoist-pattern=`, fresh install from packed tarballs, no `.pnpm/node_modules` and no root `alchemy`, child path logged, dev reaches `ready`. Deploy and destroy were not run under strict pnpm; they share `alchemyCommandLine` with dev, so I accept that.

### F09 (Low): the printed reproduce command expands `$` and backticks

Location: `packages/0-framework/3-tooling/cli/src/run-alchemy.ts` `shellArg`.

Issue: Arguments outside `[\w@%+=:,./\\-]` are wrapped with `JSON.stringify`, which produces POSIX double quotes. Inside double quotes the shell still expands `$` and backticks. `git check-ref-format` accepts `$`, backticks and `;` in a stage, so `--stage 'a$HOME'` prints `"a$HOME"`, and pasting it runs a different stage. The only test uses a path with a space.

Suggestion: Wrap in single quotes and escape an embedded `'` as `'\''`. Add a test with a stage containing `$` and `'`. Windows `cmd` quoting is a separate question; printing POSIX form everywhere is fine if the doc comment says so.

### F10 (Low): the guide and the skill still say Composer finds alchemy "from its own location"

Location: `docs/guides/deploying.md` lines 126-127; `skills/prisma-composer-core-concepts/SKILL.md` line 339.

Issue: Since a1b34d43 the lookup starts from the app's `@prisma/composer`, not from Composer's own location. deploy-cli.md § Runtime is correct; these two describe the first version.

Suggestion: Say "the `alchemy` that your app's `@prisma/composer` depends on, found from the app directory".

### F11 (Low): nothing records why `@prisma/composer-cli` declares `alchemy`

Location: `packages/9-public/composer-cli/package.json` line 22.

Issue: The lookup no longer reads `@prisma/composer-cli`'s `alchemy`, and the dropped manifest test was the only place that tied the declaration to a reason. The packed dist still imports `alchemy` (3 chunks) and `alchemy/State/LocalState`, through inlined core code. A future reader may remove the dependency as unused; the workspace's hoisted layout would hide the break, and only strict-pnpm users would see it. `check-cli-engine-pin.mjs` scans dist specifiers for the engine only.

Suggestion: One sentence in deploy-cli.md § Runtime (or the composer-cli `tsdown.config.ts` comment): the CLI's inlined core imports `alchemy`, so the package declares it even though the child uses the app's copy.

### Verdict

Ready for approval. Every round-1 finding is fixed or accepted with a stated reason. F09 to F11 are small and can land in this PR before merge; none blocks it.
