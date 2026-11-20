## Dispatch plan

### Dispatch 1: identity-aware CLI help

- **Outcome:** Top-level and CLI-owned command help and examples render the selected executable name, with regression tests proving ordinary `prisma` output is unchanged.
- **Builds on:** The merged executable-derived `CliDistributionIdentity` seam.
- **Hands to:** An explicit primitive identity flow available to every CLI-owned renderer.
- **Focus:** Write focused dual-identity tests first, then thread the primitive through `bin.ts`, `CLI`, and CLI-owned command help such as Init, Generate, Validate, Format, Studio, Version, DebugInfo, Status, bootstrap, platform, MCP, and postgres commands. Change executable/package references only; no generic template framework and no migrate-owned output.
- **Validation gate:** `pnpm --filter prisma tsc`; focused CLI help tests through `pnpm --filter prisma test -- <affected test paths>`; `pnpm prettier-check`; `git diff --check`.

### Dispatch 2: identity-correct project creation

- **Outcome:** `prisma7 init`, bootstrap, and postgres setup generate `prisma7/config` imports and recommend, install, and reinvoke `prisma7`, while domain paths and package names remain stable.
- **Builds on:** Dispatch 1's primitive identity flow through CLI-owned renderers.
- **Hands to:** Correct generated config files, package instructions, and next-step commands for the compatibility invocation.
- **Focus:** Add failing focused cases before changing `Init.defaultConfig`, Init output, `init/ppg-output.ts`, Bootstrap, `bootstrap/completion-output.ts`, and `postgres/link/completion-output.ts`. Keep `prisma.config.ts`, `prisma/schema.prisma`, Prisma Skills, URLs, and `@prisma/client` unchanged.
- **Validation gate:** `pnpm --filter prisma tsc`; focused Init/Bootstrap/postgres tests through `pnpm --filter prisma test -- <affected test paths>`; `pnpm prettier-check`; `git diff --check`.

### Dispatch 3: version and mismatch identity

- **Outcome:** Text and JSON version output plus global/local mismatch diagnostics label and recommend `prisma7` under compatibility invocation, while ordinary Prisma and `@prisma/client` behavior remain unchanged.
- **Builds on:** Dispatch 1's identity-aware CLI construction.
- **Hands to:** Correct package/version diagnostics with the physical nested implementation path intentionally left visible.
- **Focus:** Add dual-identity tests first, then update `Version` and `getGlobalLocalVersionMismatchWarning` composition. Verify local package lookup and the recommended generate command use the selected distribution without renaming domain packages.
- **Validation gate:** `pnpm --filter prisma tsc`; focused Version, Generate, and global/local mismatch tests through `pnpm --filter prisma test -- <affected test paths>`; `pnpm prettier-check`; `git diff --check`.

### Dispatch 4: completion identity

- **Outcome:** `prisma7 complete <shell>` installs completion for `prisma7`, and generated fish, Bash, Zsh, and PowerShell scripts reinvoke `prisma7 complete` without changing completion descriptors.
- **Builds on:** The executable-derived identity available independently in the completion bundle.
- **Hands to:** Correct compatibility shell integration with ordinary Prisma output regression-pinned.
- **Focus:** Write completion-generation cases first, then pass the primitive identity through `Completions`, `parseCompletionCommand`, and shell setup. Do not introduce cross-bundle mutable state.
- **Validation gate:** `pnpm --filter prisma tsc`; focused completion tests through `pnpm --filter prisma test -- packages/cli/src/completions`; `pnpm prettier-check`; `git diff --check`.

### Dispatch 5: suppress Prisma 8 update consultation

- **Outcome:** Compatibility invocations neither start the checkpoint request nor print update guidance; ordinary Prisma performs the unchanged request and rendering path.
- **Builds on:** Identity availability in `CLI.parse` from Dispatch 1.
- **Hands to:** A Prisma 7 compatibility invocation isolated from the Prisma 8 release line.
- **Focus:** Add control-flow tests first, then gate `runCheckpointClientCheck` before promise creation. Do not invent a Prisma 7 checkpoint product, mutate checkpoint payloads, or rely only on `PRISMA_HIDE_UPDATE_MESSAGE`.
- **Validation gate:** `pnpm --filter prisma tsc`; focused CLI/update/checkpoint tests through `pnpm --filter prisma test -- <affected test paths>`; `pnpm prettier-check`; `git diff --check`.

### Dispatch 6: packed CLI identity proof and audit

- **Outcome:** The packed compatibility fixture proves CLI-owned help, version, completion, init config generation, and update suppression, and a repository audit classifies every remaining actionable `prisma` literal in `packages/cli/src`.
- **Builds on:** Dispatches 1–5's complete CLI-owned identity behavior.
- **Hands to:** A review-ready CLI-owned identity slice plus a concrete downstream inventory for `downstream-actionable-guidance`.
- **Focus:** Extend the existing packed client Docker E2E rather than adding a second compatibility scenario; add only user-visible proof not already covered by focused tests. Record downstream/domain-stable audit results in the slice walkthrough or review artifact, not source comments.
- **Validation gate:** `pnpm --filter prisma build`; `pnpm --filter prisma7 build`; focused Prisma tests; `pnpm --filter @prisma/client test:e2e --verbose --runInBand prisma7-compatibility`; `pnpm prettier-check`; root `pnpm lint`; `git diff --check`; mandatory transient-ID scan.

### Dispatch 7: replace mocked identity tests with command snapshots

- **Outcome:** The slice's mock-heavy unit coverage is removed and one packed E2E snapshots deterministic output from real `prisma7` command invocations across the CLI-owned identity behaviors.
- **Builds on:** Dispatch 6's packed compatibility fixture and the operator's PR feedback that command behavior should be proven at the executable boundary rather than through constructor/helper mocks.
- **Hands to:** A smaller review surface whose compatibility evidence comes from shipped commands, with existing ordinary-Prisma regression tests left intact.
- **Focus:** Delete the slice-added identity unit suites and additions to existing unit tests; extend the existing single packed fixture with a committed, normalized command-output snapshot for the representative help, version, completion, init/generated-file, warning, and update behavior that can be observed without mocks. Do not create a second scenario or a test-only production seam. If a contract cannot be observed from a real command, remove the mock assertion rather than simulating internals and record the resulting evidence boundary in review.
- **Validation gate:** `pnpm --filter prisma build`; `pnpm --filter prisma7 build`; `pnpm --filter @prisma/client test:e2e --verbose --runInBand prisma7-compatibility`; existing ordinary-Prisma regression tests affected by production signatures; `pnpm prettier-check`; root `pnpm lint`; `git diff --check`; mandatory transient-ID scan.

### Dispatch 8: require identity at CLI command boundaries

- **Outcome:** Every CLI command/helper whose behavior depends on distribution identity requires an explicit `CliDistributionIdentity`; no constructor or renderer silently defaults to ordinary `prisma`.
- **Builds on:** Dispatch 7's executable-boundary evidence, which no longer needs optional identity defaults for mock-driven tests.
- **Hands to:** An explicit composition contract where normal and completion entrypoints select identity and all identity-sensitive command construction is mechanically auditable.
- **Focus:** Remove default identity values from CLI command constructors/factories/helpers, update all production composition roots and existing ordinary-Prisma tests/callers to pass `'prisma'` explicitly, and add no replacement mock suites. Keep `getCliDistributionIdentity` defaulting only at actual executable-entry inference where `process.argv[1]` is the intended source.
- **Validation gate:** `pnpm --filter prisma tsc`; `pnpm --filter prisma build`; `pnpm --filter prisma7 build`; existing affected ordinary-Prisma tests; packed compatibility E2E; `pnpm prettier-check`; root `pnpm lint`; `git diff --check`; mandatory transient-ID scan.

### Dispatch 9: close CI and current review findings

- **Outcome:** Workspace typecheck and lint pass after a full build, and every current PR review comment is either fixed or explicitly classified against current code.
- **Builds on:** Dispatch 8's explicit identity contract and CI evidence showing unresolved workspace path mappings plus generated Prisma7 forwarding artifacts entering lint.
- **Hands to:** A pushed PR with green local reproductions of the failed CI jobs and no valid unaddressed review comment.
- **Focus:** Correct source-path mappings for `prisma` root/config imports used by `packages/prisma7`; exclude generated root forwarding artifacts from lint/Prettier consistently with `packages/cli`; make Bootstrap resolve the selected local CLI binary; remove the two redundant platform comments. Treat the deleted-test comment as obsolete and reject package-manager guidance comments that misapply contributor tooling rules to user-facing CLI output.
- **Validation gate:** reproduce CI with `pnpm tsc -p tsconfig.utils.typecheck.json` after the required workspace dev build; run root `pnpm lint` and `pnpm prettier-check` without deleting generated Prisma7 package artifacts; run focused Bootstrap tests and packed compatibility E2E; `git diff --check`; mandatory transient-ID scan.

### Dispatch 10: close second review round

- **Outcome:** The packed E2E presents command-local inline evidence without snapshotting the generated completion script, Bootstrap selects Windows `.cmd` shims, and bundler path resolution supports the exact Prisma package aliases introduced for workspace typecheck.
- **Builds on:** Dispatch 9's green CI run and the four current unresolved review threads.
- **Hands to:** A pushed PR where each current thread is fixed with focused evidence and the obsolete aggregate snapshot is removed.
- **Focus:** Split the aggregate external snapshot into inline snapshots for each identity-bearing command output; retain concise assertions, not a script snapshot, for completion identity. Preserve one narrow Bootstrap regression test by adapting it to a `.cmd`-only Windows fixture. Represent exact path aliases as directory or explicit-file targets and make `resolvePathsPlugin` honor explicit file targets rather than blindly appending `/index.ts`.
- **Validation gate:** focused Bootstrap test; Prisma and Prisma7 builds; exact workspace typecheck; packed compatibility E2E with snapshots validated; root lint and Prettier; `git diff --check`; mandatory transient-ID scan.
