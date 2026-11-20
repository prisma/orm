## Sources

- PR: [#29949](https://github.com/prisma/prisma/pull/29949)
- Commit range: `origin/v7...HEAD`
- Final wrapper changes: `43ad8a7891 refactor(cli): infer prisma7 identity from executable`, `0e44c96e11 refactor(prisma7): inline CLI delegation`
- Final test change: `ce505fa9ad test(client): cover prisma7 compatibility in e2e`
- Intent: [slice spec](projects/prisma7-compatibility-cli/slices/side-by-side-wrapper/spec.md)
- Dispatch plan: [slice plan](projects/prisma7-compatibility-cli/slices/side-by-side-wrapper/plan.md)
- Review ledger: [code review](projects/prisma7-compatibility-cli/reviews/code-review.md)

## Intent

Establish a runnable, unpublished `prisma7` distribution that delegates to the exact matching Prisma 7 implementation while a direct Prisma dependency continues serving the ordinary `prisma` command. The slice creates the executable and package boundary that later branding-completion and release-mirroring slices can build on.

## Change map

- **Implementation**:
  - [CLI distribution identity](packages/cli/src/utils/cli-distribution-identity.ts) — derives the immutable identity from the normalized executed-script stem.
  - [Wrapper executable](packages/prisma7/src/bin.ts) — directly loads `prisma/build/index.js` through the declared dependency edge.
  - [Wrapper build](packages/prisma7/helpers/build.ts) — emits the distinctive `build/prisma7.js` executable and forwarded package bundles.
  - [Wrapper package contract](packages/prisma7/package.json) — defines the `prisma7` bin, exact packed dependency semantics, exports, and file set.
- **Test (evidence)**:
  - [Client Docker E2E](packages/client/tests/e2e/prisma7-compatibility/_steps.ts) — installs packed artifacts, typechecks a `prisma7/config` consumer, exercises the wrapper's version and generation commands with a non-default schema/output, and executes the generated client against SQLite.

## The story

1. **Create one implementation boundary for two distributions.** The new private `prisma7` package owns a small executable wrapper and forwards to `prisma/build/index.js` through its declared dependency. It does not copy CLI implementation, engines, Wasm assets, or command handlers.
2. **Make the invoked executable the identity source.** The wrapper's bin target is `build/prisma7.js`. Each separately bundled CLI consumer normalizes `process.argv[1]` and parses its filename stem; exact `prisma7` selects the compatibility identity, while every other stem defaults to `prisma`. The same rule handles package-manager shim paths and the real built target without package.json lookup or dependency-path parsing.
3. **Keep execution behavior unchanged apart from distribution selection.** The wrapper directly loads the existing dispatcher, which still selects normal or completion execution from the command arguments. Each bundled consumer observes the unchanged invoked script rather than relying on cross-bundle mutable state.
4. **Prove the shipped workflow once, end to end.** The standard client Docker harness installs the packed `prisma7`, Prisma, client-runtime, and adapter tarballs. Its fixture imports and typechecks `prisma7/config`, places its schema and generated output outside the defaults, runs the real wrapper's version and generation commands, then performs a SQLite write/read through the generated client. The separate package-manager probe covered npm, pnpm, Yarn node-modules/PnP, Bun, scripts/exec, direct Node, and npm-global launches; custom renamed symlinks and programmatic `require()` remain unsupported.

## Behavior changes & evidence

- **Adds executable-derived distribution identity**: a normalized stem of exactly `prisma7` selects `prisma7`; missing, ordinary, and unsupported executable names select `prisma`.
  - **Why**: Supported package-manager launches expose either the `prisma7` shim or `prisma7.js` target, providing a stable identity signal without package metadata or physical dependency-path assumptions.
  - **Implementation**: [CLI distribution identity](packages/cli/src/utils/cli-distribution-identity.ts)
  - **Evidence**: [Package-manager probe decision](projects/prisma7-compatibility-cli/design-decisions.md), [client Docker E2E](packages/client/tests/e2e/prisma7-compatibility/_steps.ts)

- **Adds a side-by-side executable wrapper**: `prisma7` delegates to `prisma/build/index.js` while preserving normal and completion arguments and delegated exit status.
  - **Why**: Reuse the Prisma 7 implementation and assets instead of maintaining a second CLI bundle or constructing a nested filesystem path.
  - **Implementation**: [Wrapper executable](packages/prisma7/src/bin.ts), [wrapper build](packages/prisma7/helpers/build.ts)
  - **Test**: [Client Docker E2E](packages/client/tests/e2e/prisma7-compatibility/_steps.ts)

- **Adds exact dependency and forwarded package surfaces**: the packed wrapper exposes `prisma7` and `prisma7/config`, records an exact same-version Prisma dependency, and resolves its config through that dependency beside a different direct root Prisma.
  - **Why**: A declared dependency edge is portable across package-manager layouts and preserves the intended side-by-side command topology.
  - **Implementation**: [Wrapper package contract](packages/prisma7/package.json), [config forwarding](packages/prisma7/src/config.ts), [root type forwarding](packages/prisma7/src/index.ts)
  - **Test**: [Packed config, typecheck, and generation workflow](packages/client/tests/e2e/prisma7-compatibility/_steps.ts)

## Compatibility / migration / risk

- Ordinary `prisma` invocations retain the existing default identity and CLI implementation.
- The wrapper is private and unpublished in this slice. Its packed dependency and side-by-side resolution are tested locally; the broader package-manager acceptance matrix remains release-slice work.
- Custom renamed symlinks and programmatic `require()` callers intentionally default to `prisma` and are outside the supported binary-invocation contract.
- Windows execution remains unverified; the client E2E runs in the standard Linux Docker harness.
- The slice establishes identity transport, not complete `prisma7` branding, so mixed user-facing references are expected until the next slice.

## Follow-ups / open questions

- Complete `prisma7` branding across command help, initialization, generated config, diagnostics, version/mismatch output, completion, and update handling, including update-prompt suppression.
- Add release mirroring and publish ordering/recovery, then validate packed installs across the supported package managers.

## Non-goals / intentionally out of scope

- No copied CLI implementation, engines, Wasm assets, command handlers, or preinstall logic.
- No exhaustive user-facing branding or update behavior in this slice.
- No publication, release automation, release-channel policy, or automatic reconciliation of Prisma 7 and Prisma 8 project files.
