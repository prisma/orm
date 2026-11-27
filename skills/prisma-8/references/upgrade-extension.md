# Upgrade Prisma 8 (extension)

This reference upgrades a project that **is** a Prisma 8 extension — a package that consumes the framework SPI (`@prisma/orm-framework`, `@prisma/orm-family-sql` or `@prisma/orm-family-mongo`, `@prisma/orm-toolchain`, `@prisma/orm-target-*`, each a peer dependency) and exposes contract / middleware / codec / migration surfaces that downstream apps install via `prisma.config.ts`.

If the project you are upgrading is a consumer **app** (it depends on a database package, `@prisma/orm-postgres`, `@prisma/orm-mongo`, `@prisma/orm-sqlite`, `@prisma/orm-mysql` or `@prisma/orm-mariadb`, from its application code), use [`upgrade-app.md`](upgrade-app.md) instead — or both, if the repo contains both a consumer app and an extension package, in which case run the app flow first then this one in the same session.

The per-transition instructions this reference reads live under [`../upgrading/extension/upgrades/`](../upgrading/extension/upgrades/).

## Step 0 — Upgrade to the newest instructions, then re-read

The upgrade instructions ship inside the installed Prisma packages, so the copy on disk describes the version currently installed — not the version being upgraded *to*. Bug fixes to *old* per-transition instructions ship with each release as part of the cumulative set, so the newest copy is the one to run.

Do the version bump first (step 1 of the per-step flow below), re-sync the skills from the newly installed packages (`prisma skills sync`), and re-read this reference and the per-transition instructions before applying any code translation.

## Role detection

This flow applies when the project **is** a Prisma 8 extension, a library integration such as `@prisma/orm-better-auth`, or a database package built outside this repository ([`build-a-target-package.md`](build-a-target-package.md)). It is one when either holds:

- `package.json` declares `@prisma/orm-framework` or another `@prisma/orm-*` platform package under `peerDependencies`, whatever else it declares (`@prisma/orm-extension-supabase` also names `@prisma/orm-postgres` as a peer, and is an extension); or
- it declares a platform package under `dependencies` with no database package (`@prisma/orm-postgres`, `@prisma/orm-mongo`, …) beside it, as an extension written for an earlier release does, and its `name` matches `^@.*/extension-` (the convention used by `@prisma/orm-extension-pgvector`, etc.), its `keywords` include `prisma-orm-extension`, or a sibling app's `prisma.config.ts` in the same monorepo lists it as an `extensions` entry.

An application never names a platform package as a peer, so a package that does is never an application.

If the repository also holds an application, in a `package.json` of its own, run [`upgrade-app.md`](upgrade-app.md) for it first, then this flow for the extension, in the same session.

If detection is ambiguous, ask the user which role to operate under.

## Version detection

- **From-version.** Read the installed Prisma 8 version from `pnpm-lock.yaml` (or `package-lock.json` / `yarn.lock`): take the resolved version of any `@prisma/orm-*` platform package (`@prisma/orm-framework`, `@prisma/orm-family-*`, `@prisma/orm-target-*`, `@prisma/orm-toolchain`). Do not read it from an extension published by someone else, which has its own version.
  - **On the `8.0.0` release candidates,** compare the full version strings, including the part after the hyphen. `8.0.0-rc.10` and `8.0.0-rc.11` are different versions, and different steps in the chain below.
  - **From release 8.0,** a step is named by the release, which is the major and minor: `8.0-to-8.1`. So the from-version is the release that a package's version belongs to. `8.0.1-ea.0`, `8.0.1` and `8.0.2` all belong to release `8.0`. (A platform package below GA has a level suffix, such as `8.0.1-ea.0` for `@prisma/orm-family-mongo`.)
  - If the lockfile shows the platform packages on different releases, the lowest is the from-version.
- **To-version.** Either the version the user specified, or whatever `npm view @prisma/orm-framework dist-tags.latest` reports. Do not assume that is a stable version: while Prisma 8 is a release candidate, `latest` tracks the newest release, `8.0.0-rc.N` included. If the user wants a stable version specifically, they must name it.

Report both back to the user before continuing.

## Transition chain

If the from-to delta spans more than one release (e.g. `0.6 → 0.8`), build the chain of steps between them:

```text
0.6 → 0.7 → 0.8
```

The [`../upgrading/extension/upgrades/`](../upgrading/extension/upgrades/) directories name the steps — read the chain off the directory names rather than deriving it arithmetically. Each directory is `<from>-to-<to>`. A step normally spans one stable minor (`0.7-to-0.8`) or one release candidate (`8.0.0-rc.1-to-8.0.0-rc.2`). When intermediate versions were not published, a guide may span a larger hop; follow the available directory chain rather than inventing missing steps. Moving onto the RC line from the last stable minor is a single step of its own (`0.17-to-8.0.0-rc.1`).

Apply each step in order, fully: bump, install, run instructions, check pins, validate, commit — before moving to the next. Halt the chain on the first failed step.

## Per-step flow

This flow assumes you are an **external extension author**: your extension lives in its own repository and gets `@prisma/orm-*` from npm. Extensions inside the Prisma ORM repository do not run this skill. Their versions and ranges are written by `pnpm bump-version` and `scripts/set-version.ts`, from the repository's release plan.

For each `(from, to)` step in the chain:

1. **Bump `@prisma/orm-*` deps.** What to write depends on the release:
   - **On the `8.0.0` release candidates,** rewrite every `@prisma/orm-*` entry in the extension's `package.json` to the exact `<to>` version, such as `"8.0.0-rc.11"`: no caret, no tilde, no range, and no `workspace:` specifier. The exact-pin rule below says why. All entries move to the same version. That includes another extension published from the Prisma repository, such as `@prisma/orm-extension-pgvector`: every `@prisma/orm-*` package is published at every release, and each lists the others at that release's version.
   - **From release 8.0,** the two sections of `package.json` differ.
     - Under `peerDependencies`, write the ranges that [the last section](#from-release-80-number-your-package-and-declare-ranges) gives. They say which releases your package accepts, and a caret there need not change at every step.
     - Under `devDependencies`, write each package's first version in the `<to>` release, so that your build and tests run against `<to>`: `8.2.0` for a GA package at the step to release 8.2, whatever the peer range says. Put a tilde in front of every one, such as `~8.2.0` or `~8.2.0-ea.0`. A tilde stays within `<to>` and still takes its fixes. A caret would let the install take a later release, whose instructions have not been applied, and would let a GA package move ahead of a package below GA that the tests use. `@prisma/orm-extension-paradedb` is the exception: it has version numbers of its own, so write the range the last section gives for it.

   Where each entry goes is the same on every release:
   - A package that the extension's shipped code imports belongs under `peerDependencies`, and again under `devDependencies`.
   - A package that only the extension's tests use, such as a database package the tests run against, belongs under `devDependencies` alone.
   - Move any entry that is still under `dependencies` or `optionalDependencies`. An extension written for an earlier release had the framework, the family and the toolchain as ordinary dependencies.

   The skill itself ships inside the Prisma packages, so bumping them is what updates it. There is no separate skill package to bump.

2. **Install.** Run `pnpm install` (or the project's lockfile-managing command). The extension's source is now broken against the new SPI — the upgrade instructions for `<from> → <to>` exist to fix it.

3. **Check pins.** This check is for the `8.0.0` release candidates. From release 8.0 it does not apply, because the entries are ranges, described in [the last section](#from-release-80-number-your-package-and-declare-ranges). On the release candidates:
   - every `@prisma/orm-*` entry under `peerDependencies` or `devDependencies` must be the single exact string `<to>`;
   - every such peer dependency must also be under `devDependencies`;
   - none may be under `dependencies` or `optionalDependencies`.

   A development dependency with no peer entry is one that only the tests use, and passes. This prints any entry that breaks the rule, and exits 1:

   ```bash
   node -e 'const p=require("./package.json");const to=process.argv[1];const ours=(n)=>n.startsWith("@prisma/orm-");const bad=[];for(const f of ["dependencies","optionalDependencies"])for(const n of Object.keys(p[f]??{}))if(ours(n))bad.push(f+": "+n+" belongs in peerDependencies, or in devDependencies alone if only tests use it");for(const f of ["peerDependencies","devDependencies"])for(const [n,v] of Object.entries(p[f]??{}))if(ours(n)&&v!==to)bad.push(f+": "+n+"@"+v);for(const n of Object.keys(p.peerDependencies??{}))if(ours(n)&&!(n in (p.devDependencies??{})))bad.push("devDependencies: "+n+" is missing");if(bad.length){console.error(bad.join("\n"));process.exit(1)}' <to>
   ```

   If it fails, the bump step did not rewrite every entry. Fix the entries it printed and run it again before going on.

4. **Read the upgrade instructions.** Re-sync the skills (`prisma skills sync`) so the tree matches the version just installed, then load `../upgrading/extension/upgrades/<from>-to-<to>/instructions.md`. Parse the YAML frontmatter and pay particular attention to its `changes[]` array.

5. **Apply each change.** When the guide's body has a section that orders the steps, such as `Order of the steps`, apply the changes in that order: it says which script runs before which, and when to sign the databases and when to plan and apply a migration. Where an entry's prose says to sign or migrate, do it at the step that section names. Otherwise take the entries in the order of `changes[]`. For each entry in `changes[]`:
   - If the entry has a `detection` block (a glob + content predicate), run it. If no files match, skip this change. Run the glob over the project's own files: skip `node_modules`, and build output such as `dist`, `build`, `.next` or `out` (whatever directories the project's build writes). A match there is generated code, which the next build rewrites; editing it changes nothing. Migration snapshots under `migrations/snapshots/` are committed files, not build output, so keep them.
   - How a `detection` block runs: `glob` selects files relative to the project root. Each `matches` entry, once read from the YAML, is a JavaScript regular expression, built as `new RegExp(pattern)` with no flags and tested against the whole content of one file at a time; each `contains` entry is a plain substring. A file is a hit when any entry matches it. Patterns may span lines, and some look at the whole file (for example, to skip a file that declares something elsewhere in it), so a line-by-line search such as `grep` or `rg` without `-U` is not the same test and can report files the pattern excludes. From a shell, `rg -U --pcre2 -l -e '<pattern>' <files>` tests whole files and gives the same hits.
   - If the entry has no `detection`, apply unconditionally.
   - If the entry names a `script:` (a relative path next to `instructions.md`), invoke it from the project root:
     - `*.ts` → the command the guide's prose gives, such as `node <script>` (Node 24 or later runs TypeScript directly); with no command in the prose, `pnpm exec tsx <skill>/upgrading/extension/upgrades/<from>-to-<to>/<script>`
     - `*.sh` → `bash <skill>/upgrading/extension/upgrades/<from>-to-<to>/<script>`
     - codemods → invoke per the script's own `instructions.md` prose.
   - If the entry has no `script`, follow the prose body in `instructions.md` directly.

   If `changes[]` is empty (the placeholder shape for transitions with no extension-side breaking changes), this sub-step is a no-op — proceed to validation.

6. **Validate.** Run `pnpm build && pnpm test` (or the project's equivalent — the `scripts` field of the extension's `package.json` is the discovery surface). If anything is red, halt the chain. Do **not** auto-roll-back; surface the failure to the user with the failing change's `id` (from the frontmatter), the file paths the change operated on, and the inferred remediation.

7. **Commit.** Create one commit containing this step's changes: the `package.json` bump, the lockfile churn from `pnpm install`, and any source-file rewrites from the applied changes. Use the message:

   ```text
   chore: upgrade @prisma/orm-* to <to-version>
   ```

   (Or the extension's own commit-message convention, if it has one.) One commit per step — never squash steps.

Move on to the next step. Repeat.

## Exact-pin rule

This rule holds until release 8.0, while every Prisma 8 package is published as `8.0.0-rc.N`. From release 8.0, ranges replace it; see [the last section](#from-release-80-number-your-package-and-declare-ranges).

A Prisma 8 extension names every `@prisma/orm-*` package its shipped code uses, another extension published from the Prisma repository included, as a **peer dependency** at a single **exact** version (no `^`, no `~`, no range, no wildcard, no `workspace:` specifier in the published `package.json`), and lists the same packages under `devDependencies` at that version, so its own build and tests install them. A package of ours that only its tests use is a development dependency alone, at that version. None of them is an ordinary dependency. All of those entries share the same version. The pin advances after each successful upgrade step, release-candidate steps included.

The version is the one the application's database package (`@prisma/orm-postgres`, `@prisma/orm-mongo`, …) uses.

An application must have one copy of each Prisma package, and peer dependencies are what make the package manager check that. A version that does not match is reported at install: npm refuses, and pnpm, Yarn and Bun install and print a peer dependency warning, so read the warnings. With an ordinary dependency, a version that does not fit would quietly become a second copy, which fails at run time.

To list every copy and the package that brought it, run `npm ls @prisma/orm-framework`, `pnpm why @prisma/orm-framework` or `bun why @prisma/orm-framework`. [ADR 329](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md) explains the reasons, and the one case peer dependencies do not cover, a monorepo with applications on different Prisma releases.

The one-line check in step 3 of the per-step flow enforces the rule; the `prisma-8-check-pins` guard the monorepo uses for its own extensions is not published. Wire the check into the extension's CI alongside the build/test step so an accidental range pin fails the PR before it lands.

## From release 8.0: number your package and declare ranges

From release 8.0, Prisma's packages share a release number, which is the major and minor of the version. Each package then has its own patch number, or a level suffix such as `-preview.0` while it is below Generally Available (GA). [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#version-numbers) explains the scheme. For a package maintained outside the Prisma repository we recommend the same convention ([ADR 330](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md#packages-maintained-outside-this-repository)).

**Your package's version.** Take the major and minor of the first Prisma release your package works with. The patch number is your own. A package built on release `8.1` is `8.1.0`, then `8.1.1` and `8.1.2` for your own changes. The number means "needs at least this release". It does not have to equal the application's release.

**The ranges you list on Prisma's packages,** as peer dependencies:

| Situation | Range | Example |
| --- | --- | --- |
| A GA package, and you use only its GA functions | A caret on the first release your package works with | `^8.1.0` |
| A GA package, and you use a function below GA, such as `preview_search` | A tilde: that function may change in the next release | `~8.1.0` |
| A package below GA | A tilde on its first version in that release | `~8.1.0-preview.0` |

With a caret, your package keeps working when an application moves to a later release: a package at `8.1.2` that lists `^8.1.0` works in an application on `8.4`. An application on a release below `8.1` gets a mismatch reported at install. With a tilde, you publish a new version of your package for each Prisma release.

**At release 8.0, write `^8.0.1` and `~8.0.1-ea.0`** (or `-preview.0`, `-rc.0`). Every Prisma package starts release 8.0 at patch 1. Never write `8.0.0` in a range on Prisma's packages: `~8.0.0-ea.0` accepts the old `8.0.0-rc.N` release candidates, because `rc` sorts after `ea`, and some package managers then install one.

**`@prisma/orm-extension-paradedb` is the exception.** It has version numbers of its own, `0.18.0` at release 8.0, and is not published again at every release. If your package lists it, write a range on its own version, such as `^0.18.0`. At each upgrade step, choose the ParadeDB release to use like this. Look at the Prisma packages each ParadeDB release lists under `dependencies`, `peerDependencies` and `optionalDependencies`. Take the release whose entries all accept the versions those Prisma packages have at that step. At release 8.0, a GA Prisma package is at `8.0.1` and one below GA at `8.0.1-ea.0`. The application flow's pre-flight finds an extension's release in the same way.

The convention has two costs. A feature of yours that needs no newer Prisma release ships as a patch. And once your package is GA, you cannot make a breaking change of your own until Prisma's next major version.

## When the chain is done

Report back to the user: the number of steps applied, the SHAs of the commits you made, and any open follow-ups.

## Failure surfaces

When a step fails:

- Surface a structured error with code `PN-UPGRADE-NNNN`, the failing change's `id`, the file paths the change touched (or the lockfile, or the pin check, or the validation command), and the inferred remediation.
- Do not retry automatically.
- Do not auto-roll-back the commit. The user can revert if they want a clean slate.
