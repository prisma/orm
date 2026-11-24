# Upgrade Prisma 8 (user app)

This reference upgrades a project that **consumes** Prisma 8 via the public package API (a target package, `@prisma/orm-postgres`, `@prisma/orm-mongo`, `@prisma/orm-sqlite`, `@prisma/orm-mysql` or `@prisma/orm-mariadb`, the contract files in `prisma/`, etc.). Package names below are the published `@prisma/orm-*` names, which is what `package.json`, the lockfile, and the registry use. The other references in this skill use the same names. If the project is itself a Prisma 8 *extension*, use [`upgrade-extension.md`](upgrade-extension.md) instead — or both, if the repo contains both an app and an extension package.

The per-transition instructions this reference reads live under [`../upgrading/app/upgrades/`](../upgrading/app/upgrades/).

## Step 0 — Upgrade to the newest instructions, then re-read

The upgrade instructions ship inside the installed Prisma packages, so the copy on disk describes the version currently installed — not the version being upgraded *to*. Bug fixes to *old* per-transition instructions ship with each release as part of the cumulative set, so the newest copy is the one to run.

Do the version bump first (step 1 of the per-step flow below), re-sync the skills from the newly installed packages (`prisma skills sync`), and re-read this reference and the per-transition instructions before applying any code translation. If the agent runtime supports an in-session refresh, perform it after the sync; otherwise finish the session's reasoning against the re-read files.

## Pre-flight — extension compatibility

Before changing any code, refuse to upgrade to a Prisma 8 version that an installed extension has no release for. Extensions in Prisma 8 name every `@prisma/orm-*` package they use as a peer dependency at a single exact version (no carets, no ranges); that pin is the one release the extension has been validated against. An application on another release makes the extension's peer dependencies disagree with the app's list until the extension catches up. npm refuses the install when the packages that disagree are ones the application lists itself; pnpm, Yarn and Bun install and print a peer dependency warning, so a successful install does not prove the versions match.

This pre-flight is for extensions published by someone else. Every `@prisma/orm-*` package, such as `@prisma/orm-extension-pgvector`, `@prisma/orm-postgres-contrib` or `@prisma/orm-better-auth`, is published from the Prisma repository at every release, at that release's version, so it moves to `<to>` with the target package in the bump step below and does not limit the target.

Steps:

1. **Read `prisma.config.ts`** (or its TS-discoverable equivalent at the project root) and enumerate the list of extension packages it imports. Each `extensions: [...]` entry corresponds to an installed npm package. Leave out every `@prisma/orm-*` package.
2. **For each extension**, read its installed `package.json` from `node_modules/<extension-package-name>/package.json` and find every `@prisma/orm-*` entry under `dependencies`, `peerDependencies`, or `optionalDependencies` (`@prisma/orm-framework`, `@prisma/orm-family-sql` or `@prisma/orm-family-mongo`, `@prisma/orm-toolchain`, and a `@prisma/orm-target-*` package). By construction those entries are exact-version pins (e.g. `"8.0.0-rc.11"`), set when the extension author last ran their own upgrade.
3. **Find each extension's releases.** List its published versions (`pnpm view <extension> versions --json`) and, for each, the Prisma version it names (`pnpm view <extension>@<version> peerDependencies`). Note the release that names the final target's version, and the release that names each intermediate step's `<to>` in the chain below, where one exists.
4. **Halt if one has no release for the final target.** If an extension has no release that names the final target's version, halt before installing anything, naming each such extension and the Prisma versions its releases name, and offer two paths:
   - (a) Wait for the extension to publish a release for the target, then re-run.
   - (b) Re-run with `--to=<version>` (or whatever flag/option the user is using to set the target) for a version every extension has a release for.

Do not auto-downgrade the target; do not skip the lagging extension; do not bump past it. If the user explicitly overrides the halt, surface the risk clearly first.

If `prisma.config.ts` is absent or names no extensions, skip the pre-flight.

## Role detection

This flow applies when the project **consumes** Prisma 8:

- `package.json` declares a target package, `@prisma/orm-postgres`, `@prisma/orm-mongo`, `@prisma/orm-sqlite`, `@prisma/orm-mysql` or `@prisma/orm-mariadb`, under `dependencies` / `devDependencies`, and
- it names no `@prisma/orm-framework` or other platform package under `peerDependencies`: an application lists them under `dependencies` beside its target package. A package that names one as a peer, such as an extension, a library integration or a target package built outside this repository, takes [`upgrade-extension.md`](upgrade-extension.md#role-detection) instead, even when it also lists a target package.

If the project also matches the extension-author role, run **this** flow first and then [`upgrade-extension.md`](upgrade-extension.md) in the same session. If detection is ambiguous, ask the user.

## Version detection

- **From-version.** Read the currently-installed Prisma 8 version from `pnpm-lock.yaml` (or `package-lock.json` / `yarn.lock`) by inspecting the resolved version of the app's target package: `@prisma/orm-postgres`, `@prisma/orm-mongo`, `@prisma/orm-sqlite`, `@prisma/orm-mysql` or `@prisma/orm-mariadb`. Do not read it from an extension published by someone else; such an extension carries its own version and is handled by the pre-flight above. Compare full semver strings, prerelease identifier included: `8.0.0-rc.10` and `8.0.0-rc.11` are different versions and different steps in the chain below. If the lockfile shows the app's Prisma packages at different versions (already broken), the **lowest** is the from-version.
- **To-version.** Either the version the user specified, or whatever `npm view @prisma/orm-postgres dist-tags.latest` reports. Do not assume that is a stable version: while Prisma 8 is a release candidate, `latest` tracks the newest release, `8.0.0-rc.N` included. If the user wants a stable version specifically, they must name it.

Report both back to the user before continuing.

## Transition chain

If the from-to delta spans more than one release (e.g. `0.6 → 0.8`), build the chain of steps between them:

```text
0.6 → 0.7 → 0.8
```

The [`../upgrading/app/upgrades/`](../upgrading/app/upgrades/) directories name the steps — read the chain off the directory names rather than deriving it arithmetically. Each directory is `<from>-to-<to>`. A step normally spans one stable minor (`0.7-to-0.8`) or one release candidate (`8.0.0-rc.1-to-8.0.0-rc.2`). When intermediate versions were not published, a guide may span a larger hop; follow the available directory chain rather than inventing missing steps. Moving onto the RC line from the last stable minor is a single step of its own (`0.17-to-8.0.0-rc.1`).

Apply each step in order, fully: bump, install, run instructions, validate, commit — before moving to the next. Halt the chain on the first failed step; do not skip ahead.

The chain order does not depend on which extensions are installed; the pre-flight has already established the target is reachable.

## Per-step flow

For each `(from, to)` step in the chain:

1. **Bump the app's Prisma packages.** Rewrite every `@prisma/orm-*` entry in the project's `package.json` to the exact `<to>` version (no caret, no tilde): the target package, such as `@prisma/orm-postgres`, the platform packages it names as peer dependencies, and every extension or library integration published from the Prisma repository (`@prisma/orm-extension-*`, `@prisma/orm-postgres-contrib`, `@prisma/orm-better-auth`). Each of those is published at every release and names the other Prisma packages at that release's exact version, so one left behind disagrees with the rest. All entries advance to the same version. Cover `dependencies` and `devDependencies`. If the target package at `<to>` names a `@prisma/orm-*` peer dependency the project does not list, add it at `<to>`: the application lists every one, so it holds one copy of each. A monorepo whose applications are on different Prisma versions can still get two copies under npm workspaces and Bun's hoisted linker; keep such applications on one version, or use pnpm, Yarn or Bun's isolated linker. Set each extension published by someone else to its release that names `<to>`, found in the pre-flight. If it has none for an intermediate step, leave it where it is: the install at that step reports a mismatch for that extension, which is expected, and the chain goes on because the pre-flight found its release for the final target. The skill itself ships inside the Prisma packages, so bumping them is what updates it; there is no separate skill package to bump.

2. **Install.** Run `pnpm install` (or the project's lockfile-managing command). The project's code is now broken against the new types — the upgrade instructions for `<from> → <to>` exist to fix it.

3. **Read the upgrade instructions.** Re-sync the skills (`prisma skills sync`) so the tree matches the version just installed, then load `../upgrading/app/upgrades/<from>-to-<to>/instructions.md`. Parse the YAML frontmatter and pay particular attention to its `changes[]` array.

4. **Apply each change.** When the guide's body has a section that orders the steps, such as `Order of the steps`, apply the changes in that order: it says which script runs before which, and when to sign the databases and when to plan and apply a migration. Where an entry's prose says to sign or migrate, do it at the step that section names. Otherwise take the entries in the order of `changes[]`. For each entry in `changes[]`:
   - If the entry has a `detection` block (glob + content predicate), run it; skip the change if no files match. No `detection` → apply unconditionally. Run the glob over the project's own files: skip `node_modules`, and build output such as `dist`, `build`, `.next` or `out` (whatever directories the project's build writes). A match there is generated code, which the next build rewrites; editing it changes nothing. Migration snapshots under `migrations/snapshots/` are committed files, not build output, so keep them.
   - How a `detection` block runs: `glob` selects files relative to the project root. Each `matches` entry, once read from the YAML, is a JavaScript regular expression, built as `new RegExp(pattern)` with no flags and tested against the whole content of one file at a time; each `contains` entry is a plain substring. A file is a hit when any entry matches it. Patterns may span lines, and some look at the whole file (for example, to skip a file that declares something elsewhere in it), so a line-by-line search such as `grep` or `rg` without `-U` is not the same test and can report files the pattern excludes. From a shell, `rg -U --pcre2 -l -e '<pattern>' <files>` tests whole files and gives the same hits.
   - If the entry names a `script:` (a relative path next to `instructions.md`), invoke it from the project root:
     - `*.ts` → the command the guide's prose gives, such as `node <script>` (Node 24 or later runs TypeScript directly); with no command in the prose, `pnpm exec tsx <skill>/upgrading/app/upgrades/<from>-to-<to>/<script>`
     - `*.sh` → `bash <skill>/upgrading/app/upgrades/<from>-to-<to>/<script>`
     - codemods → invoke per the script's own prose.

     No `script` → follow the prose body directly.

   Empty `changes[]` (placeholder shape for transitions with no user-side breaking changes) is a no-op — proceed to validation.

5. **Validate.** Run `pnpm typecheck && pnpm test` (or the project's equivalent — the `scripts` field of the project's `package.json` is the discovery surface). If anything is red, halt the chain. Do **not** auto-roll-back; surface the failure to the user with the failing change's `id` (from the frontmatter), the file paths the change operated on, and the inferred remediation.

6. **Commit.** One commit per step containing the `package.json` bump, lockfile churn, and any source rewrites:

   ```text
   chore: upgrade @prisma/orm-* to <to-version>
   ```

   (Or the project's own commit-message convention.) Never squash steps. The user may squash on merge; the in-flight history must be per-step so a failed step is bisectable.

Then move on to the next step.

## When the chain is done

Report back to the user: the number of steps applied, the SHAs of the commits you made, and any open follow-ups (e.g. tests that were already red before the upgrade and still are).

## Failure surfaces

When a step fails: surface a structured error with code `PN-UPGRADE-NNNN`, the failing change's `id`, the file paths touched (or the lockfile, or the validation command), and the inferred remediation. Do not retry automatically; do not auto-roll-back. The user can revert if they want a clean slate.

If a pre-flight halt fires, do not bump anything; the project is left unchanged.
