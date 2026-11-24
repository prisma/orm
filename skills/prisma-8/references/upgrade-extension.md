# Upgrade Prisma 8 (extension)

This reference upgrades a project that **is** a Prisma 8 extension — a package that consumes the framework SPI (`@prisma/orm-framework`, `@prisma/orm-family-sql` or `@prisma/orm-family-mongo`, `@prisma/orm-toolchain`, `@prisma/orm-target-*`, each a peer dependency) and exposes contract / middleware / codec / migration surfaces that downstream apps install via `prisma.config.ts`.

If the project you are upgrading is a consumer **app** (it depends on `@prisma/orm-postgres`, `@prisma/orm-mongo`, or `@prisma/orm-sqlite` from its application code), use [`upgrade-app.md`](upgrade-app.md) instead — or both, if the repo contains both a consumer app and an extension package, in which case run the app flow first then this one in the same session.

The per-transition instructions this reference reads live under [`../upgrading/extension/upgrades/`](../upgrading/extension/upgrades/).

## Step 0 — Upgrade to the newest instructions, then re-read

The upgrade instructions ship inside the installed Prisma packages, so the copy on disk describes the version currently installed — not the version being upgraded *to*. Bug fixes to *old* per-transition instructions ship with each release as part of the cumulative set, so the newest copy is the one to run.

Do the version bump first (step 1 of the per-step flow below), re-sync the skills from the newly installed packages (`prisma skills sync`), and re-read this reference and the per-transition instructions before applying any code translation.

## Role detection

This flow applies when the project **is** a Prisma 8 extension. Heuristics:

- `package.json` declares `@prisma/orm-framework` (or another `@prisma/orm-*` platform package) under `peerDependencies`, or under `dependencies` with no target package (`@prisma/orm-postgres`, `@prisma/orm-mongo`, …) beside it, as an extension written for an earlier release does, and
- the package's `name` matches `^@.*/extension-` (the convention used by `@prisma/orm-extension-pgvector`, etc.), or
- the package is referenced as an `extensions` entry from a sibling app's `prisma.config.ts` in the same monorepo.

If the project additionally consumes Prisma 8 from its own app code, run [`upgrade-app.md`](upgrade-app.md) first, then this flow in the same session.

If detection is ambiguous, ask the user which role to operate under.

## Version detection

- **From-version.** Read the currently-installed Prisma 8 version from `pnpm-lock.yaml` (or `package-lock.json` / `yarn.lock`) by inspecting the resolved version of any `@prisma/orm-*` platform package (`@prisma/orm-framework`, `@prisma/orm-family-*`, `@prisma/orm-target-*`, `@prisma/orm-toolchain`). Do not read it from a `@prisma/orm-extension-*` dependency; another extension carries its own version. Compare full semver strings, prerelease identifier included: `8.0.0-rc.10` and `8.0.0-rc.11` are different versions and different steps in the chain below. If the lockfile shows the platform packages at different versions, the lowest is the from-version.
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

This flow assumes you are an **external extension author** — your extension lives in its own repo and consumes `@prisma/orm-*` from npm. (Extensions inside the `prisma/prisma` monorepo itself are bumped via `pnpm bump-version` / `scripts/set-version.ts`, which rewrites every `workspace:<X.Y.Z>` spec in lockstep with the root version; they do not run this skill.)

For each `(from, to)` step in the chain:

1. **Bump `@prisma/orm-*` deps.** Rewrite every `@prisma/orm-*` entry other than `@prisma/orm-extension-*` in the extension's `package.json` to the exact `<to>` version (e.g. `"8.0.0-rc.11"` — no caret, no tilde, no range, no `workspace:` specifier; the exact-pin rule below details why). All entries advance to the same version. Every such entry belongs under `peerDependencies` and again under `devDependencies`, at the same version. Move any entry still under `dependencies` or `optionalDependencies` there: an extension written for an earlier release held the framework, the family and the toolchain as ordinary dependencies. The skill itself ships inside the Prisma packages, so bumping them is what updates it; there is no separate skill package to bump.

2. **Install.** Run `pnpm install` (or the project's lockfile-managing command). The extension's source is now broken against the new SPI — the upgrade instructions for `<from> → <to>` exist to fix it.

3. **Check pins.** Every `@prisma/orm-*` entry other than `@prisma/orm-extension-*` must now be under `peerDependencies` and `devDependencies` as the single exact string `<to>`, and none under `dependencies` or `optionalDependencies`. This prints any entry that is not, and exits 1:

   ```bash
   node -e 'const p=require("./package.json");const to=process.argv[1];const ours=(n)=>n.startsWith("@prisma/orm-")&&!n.startsWith("@prisma/orm-extension-");const bad=[];for(const f of ["dependencies","optionalDependencies"])for(const n of Object.keys(p[f]??{}))if(ours(n))bad.push(f+": "+n+" belongs in peerDependencies");for(const f of ["peerDependencies","devDependencies"])for(const [n,v] of Object.entries(p[f]??{}))if(ours(n)&&v!==to)bad.push(f+": "+n+"@"+v);for(const n of Object.keys(p.peerDependencies??{}))if(ours(n)&&!(n in (p.devDependencies??{})))bad.push("devDependencies: "+n+" is missing");if(bad.length){console.error(bad.join("\n"));process.exit(1)}' <to>
   ```

   If it fails, the bump step did not rewrite every spec — fix the offending entries and re-run before proceeding.

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

A Prisma 8 extension names every `@prisma/orm-*` package it uses (everything except `@prisma/orm-extension-*`) as a **peer dependency** at a single **exact** version (no `^`, no `~`, no range, no wildcard, no `workspace:` specifier in the published `package.json`), and lists the same packages under `devDependencies` at that version, so its own build and tests install them. None of them is an ordinary dependency. All of those entries share the same version. The pin advances after each successful upgrade step, release-candidate steps included.

The version is the one the application's target package (`@prisma/orm-postgres`, `@prisma/orm-mongo`, …) uses. Values and registries made by one copy of Prisma ORM are not recognised by another, so they must never cross between copies. A host may load two copies on purpose, as Prisma Composer's boot wrapper does beside the application bundle, but the application, its extensions and the `prisma` CLI must share one. A package manager gives a package its own copy of an ordinary dependency whenever the version differs from the one already installed, but it never gives a package its own copy of a peer dependency: it uses the copy the application lists. So when every Prisma package an extension uses is a peer, the application's list is the only place a copy can come from, and a version that does not match is reported at install instead of becoming a second copy: npm refuses the install, and pnpm, Yarn and Bun report the mismatch. That holds within one application. A monorepo whose applications are on different Prisma versions can still get two copies under npm workspaces and Bun's hoisted linker; keep such applications on one version, or use pnpm, Yarn or Bun's isolated linker. The application lists the platform packages beside its target package for the same reason. The decision record explains this in full: [ADR 329](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md). `npm ls @prisma/orm-framework`, `pnpm why @prisma/orm-framework` or `bun why @prisma/orm-framework` lists every copy and the package that brought it.

The one-line check in step 3 of the per-step flow enforces the rule; the `prisma-8-check-pins` guard the monorepo uses for its own extensions is not published. Wire the check into the extension's CI alongside the build/test step so an accidental range pin fails the PR before it lands.

## When the chain is done

Report back to the user: the number of steps applied, the SHAs of the commits you made, and any open follow-ups.

## Failure surfaces

When a step fails:

- Surface a structured error with code `PN-UPGRADE-NNNN`, the failing change's `id`, the file paths the change touched (or the lockfile, or the pin check, or the validation command), and the inferred remediation.
- Do not retry automatically.
- Do not auto-roll-back the commit. The user can revert if they want a clean slate.
