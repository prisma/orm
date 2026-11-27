# Upgrade Prisma 8 (user app)

This reference upgrades a project that **consumes** Prisma 8 via the public package API (a database package, `@prisma/orm-postgres`, `@prisma/orm-mongo`, `@prisma/orm-sqlite`, `@prisma/orm-mysql` or `@prisma/orm-mariadb`, the contract files in `prisma/`, etc.). Package names below are the published `@prisma/orm-*` names, which is what `package.json`, the lockfile, and the registry use. The other references in this skill use the same names. If the project is itself a Prisma 8 *extension*, use [`upgrade-extension.md`](upgrade-extension.md) instead — or both, if the repo contains both an app and an extension package.

The per-transition instructions this reference reads live under [`../upgrading/app/upgrades/`](../upgrading/app/upgrades/).

## Step 0 — Upgrade to the newest instructions, then re-read

The upgrade instructions ship inside the installed Prisma packages, so the copy on disk describes the version currently installed — not the version being upgraded *to*. Bug fixes to *old* per-transition instructions ship with each release as part of the cumulative set, so the newest copy is the one to run.

Do the version bump first (step 1 of the per-step flow below), re-sync the skills from the newly installed packages (`prisma skills sync`), and re-read this reference and the per-transition instructions before applying any code translation. If the agent runtime supports an in-session refresh, perform it after the sync; otherwise finish the session's reasoning against the re-read files.

## Pre-flight — extension compatibility

Before changing any code, work out how far the chain can go. The application can take a step only when every extension published by someone else has a release that accepts the Prisma versions of that step.

- **Until release 8.0,** an extension lists every `@prisma/orm-*` package it uses as a peer dependency at one exact version, with no caret and no range. That version is the one release the extension was validated against. An application on any other release makes the extension's peer dependencies disagree with the application's own lines, until the extension publishes a release for it.
- **From release 8.0,** an extension normally lists a caret on the first release it works with, such as `^8.1.0`, which accepts every later release in the major. Such an extension does not limit how far the application can go. It limits it only when it lists a range within one minor, such as `~8.1.0`, or an exact version.

When the lines disagree, npm refuses the install if the packages that disagree are ones the application lists itself. pnpm, Yarn and Bun install anyway and print a peer dependency warning, so a successful install does not prove that the versions match.

This pre-flight covers extensions published by someone else, and `@prisma/orm-extension-paradedb`.

- **Every other `@prisma/orm-*` package** is published from the Prisma repository at every release: `@prisma/orm-extension-pgvector`, `@prisma/orm-postgres-contrib` and `@prisma/orm-better-auth`, for example. It moves to `<to>` together with the database package in the bump step below, so it does not limit how far the application can go.
- **`@prisma/orm-extension-paradedb`** is published from the Prisma repository too, but it has version numbers of its own and is not published again at every release. So the pre-flight finds the release of it that accepts each step, as it does for an extension published by someone else.

Steps:

1. **Read `prisma.config.ts`** (or its TS-discoverable equivalent at the project root) and enumerate the list of extension packages it imports. Each `extensions: [...]` entry corresponds to an installed npm package. Leave out every `@prisma/orm-*` package except `@prisma/orm-extension-paradedb`.
2. **For each extension**, read its installed `package.json` from `node_modules/<extension-package-name>/package.json` and find every `@prisma/orm-*` entry under `dependencies`, `peerDependencies`, or `optionalDependencies` (`@prisma/orm-framework`, `@prisma/orm-family-sql` or `@prisma/orm-family-mongo`, `@prisma/orm-toolchain`, and a `@prisma/orm-target-*` package). Until release 8.0, by construction those entries are exact-version pins (e.g. `"8.0.0-rc.11"`), set when the extension author last ran their own upgrade.
3. **Find each extension's releases.** List its published versions with `pnpm view <extension> versions --json`. For each version, read the `@prisma/orm-*` entries it lists under `dependencies`, `peerDependencies` and `optionalDependencies`, as in step 2: `pnpm view <extension>@<version> dependencies peerDependencies optionalDependencies --json`. Then, for each step in the chain below, work out the version each of those Prisma packages has at that step, as the bump step of the per-step flow defines it:
   - on the `8.0.0` release candidates, it is `<to>` itself;
   - from release 8.0, it is that package's first version in the `<to>` release, such as `8.0.1` for a GA package and `8.0.1-ea.0` for one below GA.

   Note the release of each extension whose every entry accepts its package's version at that step.
4. **Find the last step every extension allows.** Walk the chain from the first step. The chain can go as far as the last step before the first one for which some extension has no release. If that is short of the user's target, tell the user before installing anything: which extension has no release for which Prisma version, how far the upgrade can go, and their options:
   - (a) Wait for, or ask for, a release of the extension for that version, then re-run.
   - (b) Upgrade only as far as the last step every extension allows.
   - (c) Remove the extension, and upgrade without it.

Do not skip a step, do not leave an extension at a release that names another Prisma version, and do not install past the last step every extension allows.

If `prisma.config.ts` is absent or names no extensions, skip the pre-flight.

## Role detection

This flow applies when the project **consumes** Prisma 8:

- `package.json` declares a database package, `@prisma/orm-postgres`, `@prisma/orm-mongo`, `@prisma/orm-sqlite`, `@prisma/orm-mysql` or `@prisma/orm-mariadb`, under `dependencies` / `devDependencies`, and
- it names no `@prisma/orm-framework` or other platform package under `peerDependencies`: an application lists them under `dependencies` beside its database package. A package that names one as a peer, such as an extension, a library integration or a database package built outside this repository, takes [`upgrade-extension.md`](upgrade-extension.md#role-detection) instead, even when it also lists a database package.

If the repository also holds an extension, in a `package.json` of its own, run **this** flow for the application first and then [`upgrade-extension.md`](upgrade-extension.md) for the extension, in the same session. If detection is ambiguous, ask the user.

## Version detection

- **From-version.** Read the installed Prisma 8 version from `pnpm-lock.yaml` (or `package-lock.json` / `yarn.lock`): take the resolved version of the application's database package, which is `@prisma/orm-postgres`, `@prisma/orm-mongo`, `@prisma/orm-sqlite`, `@prisma/orm-mysql` or `@prisma/orm-mariadb`. Do not read it from an extension published by someone else. Such an extension has its own version, and the pre-flight above deals with it.
  - **On the `8.0.0` release candidates,** compare the full version strings, including the part after the hyphen. `8.0.0-rc.10` and `8.0.0-rc.11` are different versions, and different steps in the chain below.
  - **From release 8.0,** each package has its own patch number or level suffix, and a step is named by the release, which is the major and minor: `8.0-to-8.1`. So the from-version is the release that the database package's version belongs to. `8.0.1-ea.0`, `8.0.1` and `8.0.2` all belong to release `8.0`.
  - If the lockfile shows the application's Prisma packages on different releases, which is already a broken state, the **lowest** is the from-version. Leave `@prisma/orm-extension-paradedb` out of that comparison: it has version numbers of its own (`0.18.0`), which name no step.
- **To-version.** Either the version the user specified, or whatever `npm view @prisma/orm-postgres dist-tags.latest` reports. Do not assume that is a stable version: while Prisma 8 is a release candidate, `latest` tracks the newest release, `8.0.0-rc.N` included. If the user wants a stable version specifically, they must name it.

Report both back to the user before continuing.

## Transition chain

If the from-to delta spans more than one release (e.g. `0.6 → 0.8`), build the chain of steps between them:

```text
0.6 → 0.7 → 0.8
```

The [`../upgrading/app/upgrades/`](../upgrading/app/upgrades/) directories name the steps — read the chain off the directory names rather than deriving it arithmetically. Each directory is `<from>-to-<to>`. A step normally spans one stable minor (`0.7-to-0.8`) or one release candidate (`8.0.0-rc.1-to-8.0.0-rc.2`). When intermediate versions were not published, a guide may span a larger hop; follow the available directory chain rather than inventing missing steps. Moving onto the RC line from the last stable minor is a single step of its own (`0.17-to-8.0.0-rc.1`).

Apply each step in order, fully: bump, install, run instructions, validate, commit — before moving to the next. Halt the chain on the first failed step; do not skip ahead.

The chain order does not depend on which extensions are installed; the pre-flight has already worked out how far it can go.

## Per-step flow

For each `(from, to)` step in the chain:

1. **Bump the app's Prisma packages.** Change these entries in the project's `package.json`, under both `dependencies` and `devDependencies`:
   - the database package, such as `@prisma/orm-postgres`;
   - the platform packages that the database package lists as peer dependencies;
   - every extension or library integration published from the Prisma repository: `@prisma/orm-extension-*`, `@prisma/orm-postgres-contrib` and `@prisma/orm-better-auth`. `@prisma/orm-extension-paradedb` is the exception, covered below.

   Each of these is published at every release and lists the other Prisma packages at that release, so one that is left behind disagrees with the rest.

   **What to write, on the `8.0.0` release candidates.** Rewrite every entry to the exact `<to>` version, with no caret and no tilde. All entries move to the same version.

   **What to write, from release 8.0.** The entries no longer share one version. Each moves to its own package's first version in the `<to>` release. From release 8.1 on, that is the plain `X.Y.0` for a GA package and `X.Y.0-<level>.0` for one below GA. At release 8.0 it is `8.0.1` and `8.0.1-ea.0`. `pnpm view <name> versions --json` lists a package's versions. Which range goes in front depends on the database package, as [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#what-an-application-writes) describes:
   - beside a GA database package, a GA entry gets a caret and an entry below GA gets a tilde;
   - beside a database package below GA, every entry gets a tilde.

   **Write a caret only when `<to>` is the newest published release,** which `pnpm view <database package> versions --json` shows. A caret accepts later releases, so at any other step the install would take a release later than `<to>`, whose instructions have not been applied. That is every step before the last one, and the last one too when the user's target is older than the newest release. At such a step write a tilde in place of the caret: a tilde stays within `<to>` and still takes its fixes. If the upgrade ends on a release that is not the newest, say in the final report that those entries have a tilde where [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#what-an-application-writes) gives a caret.

   **`@prisma/orm-extension-paradedb`** has version numbers of its own. Set it to the release the pre-flight noted for this step, as for an extension published by someone else.

   **A peer dependency the project does not list.** If the database package at `<to>` lists an `@prisma/orm-*` peer dependency that the project's `package.json` does not have, add it, written as that package's entry for `<to>` would be. The application lists every one of them, so that it has one copy of each. A monorepo whose applications are on different Prisma releases can still get two copies under npm workspaces and under Bun's hoisted linker; keep such applications on one release, or use pnpm, Yarn or Bun's isolated linker.

   **Extensions published by someone else.** Set each one to the release the pre-flight noted for this step: the one whose every Prisma entry accepts that package's version at the step. If an extension has no such release, halt before this step's install. The project stays at the last step that worked, and the user gets the pre-flight's message for that extension and step.

   The skill itself ships inside the Prisma packages, so bumping them is what updates it. There is no separate skill package to bump.

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

If the pre-flight finds that the first step is already blocked, do not bump anything; the project is left unchanged. A halt at a later step leaves the project at the last step that worked.
