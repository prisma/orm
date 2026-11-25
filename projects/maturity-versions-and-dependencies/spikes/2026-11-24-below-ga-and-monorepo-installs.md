# Spike: installs with packages below GA, and a monorepo on two minors

Run on 2026-11-24. The first install trial chose the arrangement in which the application lists the facade and every platform package, and the facade and extensions name the platform packages as peer dependencies. It did not cover packages below GA, whose versions carry a suffix, or a monorepo with applications on different minors. This trial covers both, and settles how the platform packages name each other.

## How it was run

Stub packages with no real code, under the made-up scope `@spike-orm`, were published to a registry on `127.0.0.1` that serves only what was published to it. Nothing was installed globally and no user-level configuration was written. Each run installed an application, counted the copies of each platform package, and checked by running code whether the application, the facade and the extension held the same framework object.

Package managers: npm 12.2.3, pnpm 10.27.0, Yarn 4.19.0 (Plug'n'Play and the `node_modules` linker) and Bun 1.3.13 (isolated and hoisted), on Node 26.8.1. Yarn needs `npmMinimalAgeGate: 0` for the scope, because it refuses packages published less than a day ago.

The scripts are not kept in the repository: they are throwaway code that does not meet its lint rules. The packaging tests of the first slice replace them for pnpm, and the trial is repeated by hand with the real packed packages before each slice that changes a manifest or a range.

The registry here is a small stand-in written for the trial, not a real registry server. Copies were counted on stubs only.

## Findings

### The platform packages name each other as peer dependencies

The first trial did not say how the target names the family and the framework. Two ways were tried: ordinary dependencies with `~X.Y.0`, and peer dependencies with `~X.Y.0`.

- As ordinary dependencies, a plain GA application got two copies in two cases. Under Bun, after updating the framework package alone. Under Yarn, on a fresh install with the application's lines at exactly `8.4.0` while `8.4.1` existed: the inner `~8.4.0` resolved to `8.4.1`.
- As ordinary dependencies, every mismatch between an application's lines became a second copy instead of a warning: 51 runs in the cases below.
- As peer dependencies, no run with one application gave two copies. The only two-copy runs were in the monorepo cases below.

So every package in the set names every other package in the set as a peer. Only the application's own list brings a copy.

### An application on a facade below GA writes every line with a tilde

The application lists, for example, `"@spike-orm/mysql": "~8.4.0-ea.0"` and `"@spike-orm/fw": "~8.4.0"`.

- This was the only way of writing the lines that stayed consistent, with no warning, under every package manager, through three events: a new counter (`8.4.0-ea.1`), an update after release `8.5` existed, and a fresh install with no lockfile.
- With caret lines, the GA lines move to `8.5.0` and the facade cannot follow, because `^8.4.0-ea.0` never selects `8.5.0-ea.0`. pnpm and Yarn then warn about the peer. Bun's `update` gives no warning. npm keeps everything at `8.4`.
- A tilde line selects a new counter: `~8.4.0-ea.0` moves to `8.4.0-ea.1`.
- At each new minor the user edits the lines, or runs the package manager's command that updates to the latest version (pnpm, Yarn and Bun have one; npm does not).
- The package managers rewrite the lines when the user updates. pnpm's `update` turns a tilde line on a pre-release into an exact version. Yarn's update to the latest version writes a caret (`^8.5.0-ea.0`). So the tilde does not survive the user's own update commands, and the docs say what the lines should read afterwards.

### What a plain add does

- Yarn does not install peer dependencies. `yarn add @spike-orm/mysql` alone leaves an application that cannot load. Every package manager needs the platform packages added by name.
- pnpm writes an exact version when it adds a pre-release, and rewrites a caret or tilde line on a pre-release to exact on `update`. The line then never moves, even to a later GA release.
- npm, Yarn and Bun write `^8.4.0-ea.0` on a plain add.

So `prisma orm init` passes each package with its range written out, and does not leave the range to the package manager.

### Peer ranges for packages below GA

- A facade below GA: `~X.Y.0` on GA platform packages, and a tilde on its own target's version (`~8.4.0-ea.0`). An exact version on the target behaved the same in every run.
- An extension below GA: `^X.Y.0` on the platform packages, as a GA extension does.

### A package that moves down from a release candidate

`mysql@8.0.0-rc.25` was published, then `mysql@8.0.0-ea.0`, and the release candidates were marked deprecated.

- `8.0.0-ea.0` sorts below `8.0.0-rc.25`. A range written for the release candidate never selects it.
- A plain add installs `8.0.0-ea.0`, because the `latest` tag points at it.
- Only npm and pnpm print the deprecation message. Yarn and Bun print nothing.
- `^8.0.0-rc.25` selects a later GA `8.6.0` of the same package, except under pnpm when the line had been made exact.

### A package that becomes GA

An extension at `8.4.0-preview.1` that becomes GA at `8.5.0`: an application with `^8.4.0-preview.0` moves to `8.5.0` on update.

One limit follows from the numbering. A GA extension released at `8.5.0` declares `^8.5.0` on the platform packages. An application still on `8.4`, with `~8.4.0` lines, that updates that extension alone gets a mismatch. npm refuses the install. The others warn. The user updates the platform packages too.

### A monorepo with two applications on different minors

`app-a` on release `8.4`, `app-b` on release `8.5`, each listing the facade, the platform packages and the same extension at `8.1.0`.

| Package manager | Each application has one copy |
| --- | --- |
| pnpm | Yes |
| Yarn, Plug'n'Play | Yes |
| Yarn, `node_modules` | Yes |
| Bun, isolated | Yes |
| npm workspaces | **No** |
| Bun, hoisted | **No** |

Under npm workspaces and Bun's hoisted linker, the extension is placed once at the root of the repository, beside one application's platform packages. In the other application the extension then holds a different copy of the framework from the facade. Nothing warns.

A workspace library that both applications import, and that names the framework as a peer, sees the right copy from both applications only under Yarn Plug'n'Play, and under pnpm with `injectWorkspacePackages: true`. Elsewhere it is linked once and sees one application's copy.

So the arrangement holds for one application under every package manager. In a monorepo it holds when every application is on the same minor, or when the package manager keeps each workspace's packages apart.

### The command-line tool

A stub tool that carries its own copy of the toolchain and framework as ordinary dependencies with `~X.Y.0`:

- On the same minor as the application, the tool shares the application's copy. The exception is Yarn when the application's lines are exact at `8.4.0` and `8.4.1` exists: the tool gets its own `8.4.1`.
- On a different minor, the tool has its own copy under every package manager.

## What the project does with this

- Every package in the set names the others as peers ([plan.md](../plan.md), slice 1).
- `prisma orm init` writes every line itself, with a caret for a GA facade and a tilde for one below GA (slice 1 for the lines, slice 2 for the ranges).
- The docs say what a user of a package below GA does at each new minor, and that a monorepo keeps its applications on one minor unless its package manager isolates them (slices 1 and 4).
- The deprecation message cannot be the only notice of a package's move down, since two package managers do not print it. The release notes and the upgrade instructions say it too (slice 3).
