# Spike: which packaging gives one copy of the platform packages

Run on 2026-11-24. It answers one question for [the design for project 6](../designs/6-maturity-versions-and-dependencies.md): how must our packages name each other so that an application ends up with exactly one copy of the framework, family, target and toolchain, under every package manager?

## How it was run

Stub packages with no real code, under the made-up scope `@spike-orm`, were published to a local registry with no link to the public one. Versions `8.1.0`, `8.4.0`, `8.4.1` and `8.5.0` of every package existed, so `8.5.0` was the newest. Each run installed an application, counted the distinct installed copies of each platform package, and checked by running code whether the facade and the extension received the same framework object.

Package managers: npm 12.2.3, pnpm 10.27.0, Yarn 4.19.0 (Plug'n'Play and the `node_modules` linker) and Bun 1.3.13 (isolated and hoisted), on Node 26.8.1. The Yarn applications set `npmMinimalAgeGate: 0`, because Yarn refuses packages published less than a day ago.

## Arrangements

- **T, today.** Every package names the others at an exact version. An extension has the framework and family as ordinary dependencies and the target as a peer.
- **A.** The facade has the platform packages as ordinary dependencies with `~X.Y.0`. The extension has the framework, family and target as peers with `^X.Y.0`. The application lists the facade and the extension.
- **B1.** The facade has the platform packages as peers. The extension is as in A. The application lists only the facade and the extension.
- **B2.** As B1, and the application also lists the platform packages. **This is the arrangement chosen.**
- **C.** The extension's only peer is the facade, and it reaches the platform packages through the facade.
- **E.** The extension's only peer is the target, and it reaches the framework and family through the target. The application lists the facade and the target.

## Scenarios

- **S1.** Facade and extension from the same release, written `^8.4.0`. **S1c** is S1 with the application's lines for the platform packages also written `^8.4.0`.
- **S2.** An extension at exactly `8.1.0` with the facade at exactly `8.4.1`.
- **S3.** The facade installed at `8.4.0` and locked, then the extension added.
- **S4.** The command-line tool at `8.4.1` installed in the project, naming the toolchain three ways: an exact version, an ordinary `^` range, and a peer.
- **S5.** The command-line tool installed in a separate folder and run in the project.
- For C: two facades in one application. For E: E4 has the facade and target lines disagreeing, E5 uses a second facade on the same target, and E6 leaves the target line out.

## Findings

- **T** gives two copies in S2 under every package manager.
- **A** gives two copies in S2 under npm, with no warning, and breaks under Yarn Plug'n'Play because the application does not list what the extension asks for.
- **B1** breaks under Yarn, which does not install a peer that is not listed, and gives two copies in S2 under Bun.
- **B2** gives one copy in S1c, S2, S3 and S4 under every package manager, provided the application's lines use the same kind of range and the command-line tool names the toolchain as a peer. In S1, with the facade written `^8.4.0` and the platform packages `~8.4.0`, npm refuses to install and the others install a facade at `8.5.0` on a platform at `8.4.1` with a warning.
- **C** gives one copy in every run, including two facades on the same minor.
- **E** gives one copy in E1, E2, E3 and E5. When the two lines disagree (E4), npm refuses and the others give two copies with a warning. When the target line is missing (E6), npm and pnpm add it, Yarn breaks and Bun gives two copies.
- **S5** never gives one copy: a command-line tool installed outside the project has its own.

Not covered: packages below GA with suffixed versions, a monorepo with applications on different minors, and a real global install.

## Full table

"1 copy" means one copy of each of the framework (fw), toolchain (tc), family (fam) and target (tgt).

| arrangement / manager | S1 | S1c | S2 | S3 | S4-exact | S4-range | S4-peer | S5-exact | S5-range | S5-peer |
|---|---|---|---|---|---|---|---|---|---|---|
| T / npm | 1 copy | n/a | 2×fw (8.1.0/8.4.1); 2×tc (8.1.0/8.4.1); 2×fam (8.1.0/8.4.1); 2×tgt (8.1.0/8.4.1) | 1 copy | 2×fw (8.4.0/8.4.1); 4×tc (8.4.1/8.4.0); cli has own tc 8.4.1 + own fw | 2×fw (8.4.0/8.5.0); 4×tc (8.5.0/8.4.0); cli has own tc 8.5.0 + own fw | 2×fw (8.4.0/8.5.0); 4×tc (8.5.0/8.4.0); cli has own tc 8.5.0 + own fw | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| T / pnpm | 1 copy | n/a | 2×fw (8.4.1/8.1.0); 2×tc (8.4.1/8.1.0); 2×fam (8.4.1/8.1.0) (peer warning) | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| T / yarn-pnp | broken: extension-pgvector cannot load peer tgt (peer warning) | n/a | broken: extension-pgvector cannot load peer tgt; 2×fw (8.4.1/8.1.0); 2×tc (8.4.1/8.1.0); 2×fam (8.4.1/8.1.0) (peer warning) | broken: extension-pgvector cannot load peer tgt (peer warning) | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli cannot load peer tc (peer warning) | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli cannot load peer tc (peer warning) |
| T / yarn-nm | 1 copy (peer warning) | n/a | 2×fw (8.4.1/8.1.0); 2×tc (8.4.1/8.1.0); 2×fam (8.4.1/8.1.0) (peer warning) | 1 copy (peer warning) | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | 1 copy (peer warning) | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli cannot load peer tc (peer warning) |
| T / bun-isolated | 1 copy | n/a | 2×fw (8.4.1/8.1.0); 2×tc (8.4.1/8.1.0); 2×fam (8.4.1/8.1.0) (peer warning) | 1 copy | cli has own tc 8.4.1 + own fw | 1 copy | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| T / bun-hoisted | 1 copy | n/a | 4×fw (8.1.0/8.4.1); 2×tc (8.4.1/8.1.0); 3×fam (8.1.0/8.4.1) (peer warning) | 1 copy | 2×fw (8.4.0/8.4.1); 4×tc (8.4.1/8.4.0); cli has own tc 8.4.1 + own fw | 1 copy | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| A / npm | 1 copy | n/a | 2×fw (8.5.0/8.4.1); 2×tc (8.5.0/8.4.1); 2×fam (8.5.0/8.4.1); 2×tgt (8.5.0/8.4.1) | 1 copy | 1 copy | 2×fw (8.4.1/8.5.0); 4×tc (8.5.0/8.4.1); cli has own tc 8.5.0 + own fw | 2×fw (8.4.1/8.5.0); 4×tc (8.5.0/8.4.1); cli has own tc 8.5.0 + own fw | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| A / pnpm | 1 copy | n/a | 1 copy | 1 copy | 1 copy | cli has own tc 8.5.0 + own fw | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| A / yarn-pnp | broken: extension-pgvector cannot load peer fw,fam,tgt (peer warning) | n/a | broken: extension-pgvector cannot load peer fw,fam,tgt (peer warning) | broken: extension-pgvector cannot load peer fw,fam,tgt (peer warning) | 1 copy | cli has own tc 8.5.0 + own fw | cli cannot load peer tc (peer warning) | 1 copy | cli has own tc 8.5.0 + own fw | cli cannot load peer tc (peer warning) |
| A / yarn-nm | 1 copy (peer warning) | n/a | 1 copy (peer warning) | 1 copy (peer warning) | 1 copy | cli has own tc 8.5.0 + own fw | 1 copy (peer warning) | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli cannot load peer tc (peer warning) |
| A / bun-isolated | 1 copy | n/a | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| A / bun-hoisted | 1 copy | n/a | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| B1 / npm | 1 copy | n/a | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| B1 / pnpm | 1 copy | n/a | 1 copy | 1 copy | 1 copy | 2×fw (8.5.0/8.4.1); 2×tc (8.4.1/8.5.0) (peer warning) | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| B1 / yarn-pnp | broken: postgres+extension-pgvector cannot load peer fw,fam,tgt,tc (peer warning) | n/a | broken: postgres+extension-pgvector cannot load peer fw,fam,tgt,tc (peer warning) | broken: postgres+extension-pgvector cannot load peer fw,fam,tgt,tc (peer warning) | broken: postgres cannot load peer fw,fam,tgt,tc; cli has own tc 8.4.1 + own fw (peer warning) | broken: postgres cannot load peer fw,fam,tgt,tc; cli has own tc 8.5.0 + own fw (peer warning) | broken: postgres cannot load peer fw,fam,tgt,tc; cli cannot load peer tc (peer warning) | broken: postgres cannot load peer fw,fam,tgt,tc; cli has own tc 8.4.1 + own fw (peer warning) | broken: postgres cannot load peer fw,fam,tgt,tc; cli has own tc 8.5.0 + own fw (peer warning) | broken: postgres cannot load peer fw,fam,tgt,tc; cli cannot load peer tc (peer warning) |
| B1 / yarn-nm | broken: postgres+extension-pgvector cannot load peer fw,fam,tgt,tc (peer warning) | n/a | broken: postgres+extension-pgvector cannot load peer fw,fam,tgt,tc (peer warning) | broken: postgres+extension-pgvector cannot load peer fw,fam,tgt,tc (peer warning) | broken: postgres cannot load peer fam,tgt (peer warning) | broken: postgres cannot load peer fam,tgt (peer warning) | broken: postgres cannot load peer fw,fam,tgt,tc; cli cannot load peer tc (peer warning) | broken: postgres cannot load peer fw,fam,tgt,tc; cli has own tc 8.4.1 + own fw (peer warning) | broken: postgres cannot load peer fw,fam,tgt,tc; cli has own tc 8.5.0 + own fw (peer warning) | broken: postgres cannot load peer fw,fam,tgt,tc; cli cannot load peer tc (peer warning) |
| B1 / bun-isolated | 1 copy | n/a | 2×fw (8.5.0/8.4.1); 2×tc (8.5.0/8.4.1) (peer warning) | 1 copy | 1 copy | 2×fw (8.5.0/8.4.1); 2×tc (8.4.1/8.5.0) (peer warning) | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| B1 / bun-hoisted | 1 copy | n/a | 2×fw (8.5.0/8.4.1); 3×tc (8.4.1/8.5.0) (peer warning) | 1 copy | 1 copy | 3×fw (8.5.0/8.4.1); 3×tc (8.5.0/8.4.1) (peer warning) | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| B2 / npm | install failed: npm error Could not resolve dependency: | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| B2 / pnpm | 1 copy (peer warning, facade 8.5.0 on platform 8.4.1) | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| B2 / yarn-pnp | 1 copy (peer warning, facade 8.5.0 on platform 8.4.1) | 1 copy | 1 copy | 1 copy | 1 copy | cli has own tc 8.5.0 + own fw | 1 copy | 1 copy | cli has own tc 8.5.0 + own fw | cli cannot load peer tc (peer warning) |
| B2 / yarn-nm | 1 copy (peer warning, facade 8.5.0 on platform 8.4.1) | 1 copy | 1 copy | 1 copy | 1 copy | cli has own tc 8.5.0 + own fw | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli cannot load peer tc (peer warning) |
| B2 / bun-isolated | 1 copy (peer warning, facade 8.5.0 on platform 8.4.1) | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |
| B2 / bun-hoisted | 1 copy (peer warning, facade 8.5.0 on platform 8.4.1) | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | cli has own tc 8.4.1 + own fw | cli has own tc 8.5.0 + own fw | cli has own tc 8.5.0 + own fw |

## Arrangement C (extension peers on the facade; platform through facade sub-paths)

D1: postgres 8.4.1 + sqlite 8.4.0, both exact. D2: both ^8.4.0. S4-exact: cli 8.4.1 with exact toolchain 8.4.1.

| arrangement / manager | S1 | S2 | S3 | S4-exact | D1 | D2 |
|---|---|---|---|---|---|---|
| C / npm | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy |
| C / pnpm | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy |
| C / yarn-pnp | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy |
| C / yarn-nm | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy |
| C / bun-isolated | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy |
| C / bun-hoisted | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy | 1 copy |

## Arrangement E (extension peers on the target; facade peers on the target; app lists facade + target + extension)

E1 all ^8.4.0. E2 facade 8.4.1, target ~8.4.0, extension 8.1.0. E3 facade 8.4.0 + target ~8.4.0, then add extension 8.4.0. E4 facade ^8.4.0, target ~8.4.0, extension ^8.4.0. E5 supabase 8.4.1, target ~8.4.0, extension 8.1.0. E6 as E2 without the target line.

| arrangement / manager | E1 | E2 | E3 | E4 | E5 | E6 |
|---|---|---|---|---|---|---|
| E / npm | 1 copy | 1 copy | 1 copy | install failed: npm error Could not resolve dependency: | 1 copy | 1 copy |
| E / pnpm | 1 copy | 1 copy | 1 copy | 2×fw (8.4.1/8.5.0); 2×tc (8.4.1/8.5.0); 2×fam (8.4.1/8.5.0); facade fw ≠ extension fw (peer warning) | 1 copy | 1 copy |
| E / yarn-pnp | 1 copy | 1 copy | 1 copy | 2×fw (8.4.1/8.5.0); 2×tc (8.4.1/8.5.0); 2×fam (8.4.1/8.5.0); facade fw ≠ extension fw (peer warning) | 1 copy | broken: postgres+extension-pgvector cannot load peer tgt,fw,fam (peer warning) |
| E / yarn-nm | 1 copy | 1 copy | 1 copy | 2×fw (8.5.0/8.4.1); 2×tc (8.5.0/8.4.1); 2×fam (8.5.0/8.4.1); facade fw ≠ extension fw (peer warning) | 1 copy | broken: postgres+extension-pgvector cannot load peer tgt,fw,fam (peer warning) |
| E / bun-isolated | 1 copy | 1 copy | 1 copy | 2×fw (8.4.1/8.5.0); 2×tc (8.4.1/8.5.0); 2×fam (8.4.1/8.5.0); facade fw ≠ extension fw (peer warning) | 1 copy | 2×fw (8.4.1/8.5.0); 2×tc (8.4.1/8.5.0); 2×fam (8.4.1/8.5.0); facade fw ≠ extension fw (peer warning) |
| E / bun-hoisted | 1 copy | 1 copy | 1 copy | 2×fw (8.5.0/8.4.1); 2×tc (8.5.0/8.4.1); 2×fam (8.5.0/8.4.1); facade fw ≠ extension fw (peer warning) | 1 copy | 2×fw (8.4.1/8.5.0); 2×tc (8.4.1/8.5.0); 2×fam (8.4.1/8.5.0); facade fw ≠ extension fw (peer warning) |
