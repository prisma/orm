## Dispatch plan

### Dispatch 1: runnable identity-aware wrapper

- **Outcome:** The default Prisma CLI resolves its existing identity unchanged, while a buildable `prisma7` binary selects the private one-shot identity and delegates all arguments, completion dispatch, exit behavior, and subprocess re-entry to its declared Prisma CLI dependency.
- **Builds on:** The slice spec's chosen identity-transport and dependency-wrapper design.
- **Hands to:** A runnable unpublished wrapper with a frozen identity contract, no copied CLI implementation, and focused tests proving default Prisma and wrapped Prisma select the intended identities.
- **Focus:** Identity resolution lifecycle, marker consumption, executable delegation, package skeleton/build, argument and completion forwarding, and default-behavior regression coverage. Public root/config parity and packed-manifest proof belong to dispatch 2.

### Dispatch 2: forwarded package surface and packed resolution proof

- **Outcome:** `prisma7`, `prisma7/config`, and `prisma7/package.json` expose the intended forwarded runtime/type contracts, and a packed artifact records the exact matching Prisma dependency and resolves it correctly beside a different direct root Prisma version.
- **Builds on:** Dispatch 1's runnable wrapper and frozen identity contract.
- **Hands to:** A complete unpublished slice artifact satisfying the wrapper package contract, ready for exhaustive identity propagation in the next project slice.
- **Focus:** Export map and files manifest, root/config runtime and type forwarding, exact workspace-to-packed dependency semantics, package inspection, and local side-by-side resolution tests. Exhaustive CLI wording and all publication automation remain out of scope.

### Dispatch 3: infer identity from the executed binary

- **Outcome:** CLI identity is derived solely from the normalized stem of `process.argv[1]`; the distinctive `prisma7.js` target selects `prisma7` across supported package-manager launch forms, while ordinary Prisma and unsupported caller-defined entrypoints default to `prisma`.
- **Builds on:** Dispatch 2's complete wrapper package and the cross-package-manager `/tmp` probe that falsified the marker/global-symbol design.
- **Hands to:** A simpler reviewer-verified wrapper with no identity environment marker, cleanup, global symbol, package metadata lookup, or cross-bundle mutable state, ready for the next project slice.
- **Focus:** Replace marker/global identity transport, give the wrapper a distinctive executable target, update emitted/forwarding/packed contract tests, and regression-pin normalized shim-vs-target names. Exhaustive user-facing identity propagation remains the next slice.

### Dispatch 4: inline wrapper delegation

- **Outcome:** The `prisma7` executable directly loads `prisma/build/index.js`; the production-only delegation helper and callback-injection tests are removed, while built/packed executable coverage proves real dependency-edge loading, argv preservation, and exit propagation.
- **Builds on:** Dispatch 3's distinctive `prisma7.js` target and accepted packed package contract.
- **Hands to:** A minimal wrapper whose production code contains no abstraction beyond the required dependency load, backed by behavior-level executable evidence.
- **Focus:** Inline the literal Prisma entrypoint load, delete the helper and tautological unit seam, and replace its claims with a network-free built/packed wrapper execution fixture. No broader branding or publication work.

### Dispatch 5: consolidate on one end-to-end project

- **Outcome:** All unit/contract tests introduced for the wrapper and identity seam are replaced by one network-free end-to-end project test that typechecks and loads `prisma7/config`, proves the CLI uses that config, runs `prisma7 --version`, runs `prisma7 generate`, and executes the generated client successfully.
- **Builds on:** Dispatch 4's minimal direct wrapper and the real package/config/generator implementations already present in the built workspace.
- **Hands to:** A review surface with one user-visible behavioral proof instead of implementation-specific package, dispatcher, identity, and forwarding assertions.
- **Focus:** Delete `package-contract.test.ts`, `cli-distribution-identity.vitest.ts`, and `bin-dispatcher.vitest.ts`; keep only setup and assertions required for config import/typechecking, version execution, generation through the chosen config, and a working generated client.

### Dispatch 6: move coverage into the client E2E harness

- **Outcome:** The single compatibility scenario is an actual auto-discovered Docker E2E under `packages/client/tests/e2e`, installed from the packed `prisma7` and workspace dependency tarballs exactly like shipped client fixtures; `packages/prisma7` contains no Vitest test or package-level test job.
- **Builds on:** Dispatch 5's settled three-outcome scenario and the existing client E2E runner's package, engine, TypeScript, and SQLite environment.
- **Hands to:** A side-by-side wrapper proven through the repository's standard shipped-artifact E2E boundary rather than a package-local subprocess simulation.
- **Focus:** Remove `packages/prisma7/src/e2e.test.ts`, its test-only dev dependencies/script, and its standalone workflow entries; add one `prisma7-compatibility` fixture with `_steps.ts`, config consumer, non-default schema/output, and SQLite client smoke; teach the tarball mount/rewrite logic that unscoped `prisma7` packs as `prisma7-0.0.0.tgz` rather than the scoped-folder convention. No unit/contract tests.

### Dispatch 7: address PR review feedback

- **Outcome:** The distribution identity is the minimal `'prisma' | 'prisma7'` value downstream consumers actually need, the E2E prepares its schema through `prisma7 db push` rather than raw SQL, and failed wrapper builds do not mask esbuild diagnostics with a chmod `ENOENT`.
- **Builds on:** Dispatch 6's reviewed packed-artifact client E2E and final wrapper build shape.
- **Hands to:** A reviewer-ready PR with all still-applicable human and bot inline feedback addressed or explicitly classified obsolete/rejected.
- **Focus:** Remove the redundant identity object/map, add `db push --force-reset` to E2E setup and simplify the SQLite smoke, guard the executable plugin on build errors, rerun the focused Docker E2E/build gates, and leave rejected `prepack` plus comments on deleted tests untouched in code.
