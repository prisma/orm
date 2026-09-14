# Upgrade Prisma 8 (extension)

This reference upgrades a project that **is** a Prisma 8 extension — a package that consumes the framework SPI (`@prisma/orm-framework`, `@prisma/orm-family-sql` or `@prisma/orm-family-mongo`, `@prisma/orm-toolchain`, with a `@prisma/orm-target-*` peer) and exposes contract / middleware / codec / migration surfaces that downstream apps install via `prisma.config.ts`.

If the project you are upgrading is a consumer **app** (it depends on `@prisma/orm-postgres`, `@prisma/orm-mongo`, or `@prisma/orm-sqlite` from its application code), use [`upgrade-app.md`](upgrade-app.md) instead — or both, if the repo contains both a consumer app and an extension package, in which case run the app flow first then this one in the same session.

The per-transition instructions this reference reads live under [`../upgrading/extension/upgrades/`](../upgrading/extension/upgrades/).

## Step 0 — Upgrade to the newest instructions, then re-read

The upgrade instructions ship inside the installed Prisma packages, so the copy on disk describes the version currently installed — not the version being upgraded *to*. Bug fixes to *old* per-transition instructions ship with each release as part of the cumulative set, so the newest copy is the one to run.

Do the version bump first (step 1 of the per-step flow below), re-sync the skills from the newly installed packages (`prisma skills sync`), and re-read this reference and the per-transition instructions before applying any code translation.

## Role detection

This flow applies when the project **is** a Prisma 8 extension. Heuristics:

- `package.json` declares `@prisma/orm-framework` (or another `@prisma/orm-*` SPI package) under `dependencies` or `peerDependencies`, and
- the package's `name` matches `^@.*/extension-` (the convention used by `@prisma/orm-extension-pgvector`, etc.), or
- the package is referenced as an `extensions` entry from a sibling app's `prisma.config.ts` in the same monorepo.

If the project additionally consumes Prisma 8 from its own app code, run [`upgrade-app.md`](upgrade-app.md) first, then this flow in the same session.

If detection is ambiguous, ask the user which role to operate under.

## Version detection

- **From-version.** Read the currently-installed Prisma 8 version from `pnpm-lock.yaml` (or `package-lock.json` / `yarn.lock`) by inspecting the resolved version of any `@prisma/orm-*` SPI package (`@prisma/orm-framework`, `@prisma/orm-family-*`, `@prisma/orm-target-*`, `@prisma/orm-toolchain`). Do not read it from a `@prisma/orm-extension-*` dependency; another extension carries its own version. Compare full semver strings, prerelease identifier included: `8.0.0-rc.10` and `8.0.0-rc.11` are different versions and different steps in the chain below. If the lockfile shows the SPI packages at different versions, the lowest is the from-version.
- **To-version.** Either the version the user specified, or whatever `npm view @prisma/orm-framework dist-tags.latest` reports. Do not assume that is a stable version: while Prisma 8 is a release candidate, `latest` tracks the newest release, `8.0.0-rc.N` included. If the user wants a stable version specifically, they must name it.

Report both back to the user before continuing.

## Transition chain

If the from-to delta spans more than one release (e.g. `0.6 → 0.8`), build the chain of steps between them:

```text
0.6 → 0.7 → 0.8
```

The [`../upgrading/extension/upgrades/`](../upgrading/extension/upgrades/) directories name the steps — read the chain off the directory names rather than deriving it arithmetically. Each directory is `<from>-to-<to>`. A step is one minor while the version line is stable (`0.7-to-0.8`); on the v8 release-candidate line a step is one release candidate (`8.0.0-rc.1-to-8.0.0-rc.2`), because an RC may carry breaking changes and each one needs its own translation. Moving onto the RC line from the last stable minor is a single step of its own (`0.17-to-8.0.0-rc.1`).

Apply each step in order, fully: bump, install, run instructions, check pins, validate, commit — before moving to the next. Halt the chain on the first failed step.

## Per-step flow

This flow assumes you are an **external extension author** — your extension lives in its own repo and consumes `@prisma/orm-*` from npm. (Extensions inside the `prisma/prisma` monorepo itself are bumped via `pnpm bump-version` / `scripts/set-version.ts`, which rewrites every `workspace:<X.Y.Z>` spec in lockstep with the root version; they do not run this skill.)

For each `(from, to)` step in the chain:

1. **Bump `@prisma/orm-*` deps.** Rewrite every `@prisma/orm-*` entry other than `@prisma/orm-extension-*` in the extension's `package.json` to the exact `<to>` version (e.g. `"8.0.0-rc.11"` — no caret, no tilde, no range, no `workspace:` specifier; the exact-pin rule below details why). All entries advance to the same version. Cover whichever dep field(s) the extension uses today — `dependencies` and/or `peerDependencies` — and any `optionalDependencies`. The skill itself ships inside the Prisma packages, so bumping them is what updates it; there is no separate skill package to bump.

2. **Install.** Run `pnpm install` (or the project's lockfile-managing command). The extension's source is now broken against the new SPI — the upgrade instructions for `<from> → <to>` exist to fix it.

3. **Check pins.** Every `@prisma/orm-*` entry other than `@prisma/orm-extension-*` across `dependencies`, `peerDependencies`, and `optionalDependencies` must now be the single exact string `<to>`. This prints any entry that is not, and exits 1:

   ```bash
   node -e 'const p=require("./package.json");const to=process.argv[1];const bad=[];for(const f of ["dependencies","peerDependencies","optionalDependencies"])for(const [n,v] of Object.entries(p[f]??{}))if(n.startsWith("@prisma/orm-")&&!n.startsWith("@prisma/orm-extension-")&&v!==to)bad.push(f+": "+n+"@"+v);if(bad.length){console.error(bad.join("\n"));process.exit(1)}' <to>
   ```

   If it fails, the bump step did not rewrite every spec — fix the offending entries and re-run before proceeding.

4. **Read the upgrade instructions.** Re-sync the skills (`prisma skills sync`) so the tree matches the version just installed, then load `../upgrading/extension/upgrades/<from>-to-<to>/instructions.md`. Parse the YAML frontmatter and pay particular attention to its `changes[]` array.

5. **Apply each change.** For each entry in `changes[]`:
   - If the entry has a `detection` block (a glob + content predicate), run it. If no files match, skip this change.
   - If the entry has no `detection`, apply unconditionally.
   - If the entry names a `script:` (a relative path next to `instructions.md`), invoke it from the project root:
     - `*.ts` → `pnpm exec tsx <skill>/upgrading/extension/upgrades/<from>-to-<to>/<script>`
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

Prisma 8 extensions pin every `@prisma/orm-*` SPI dependency (everything except `@prisma/orm-extension-*`) to a single **exact** version (no `^`, no `~`, no range, no wildcard, no `workspace:` specifier in the published `package.json`). All of those entries share the same version. The pin advances after each successful upgrade step, release-candidate steps included.

The one-line check in step 3 of the per-step flow enforces the rule; the `prisma-8-check-pins` guard the monorepo uses for its own extensions is not published. Wire the check into the extension's CI alongside the build/test step so an accidental range pin fails the PR before it lands.

## When the chain is done

Report back to the user: the number of steps applied, the SHAs of the commits you made, and any open follow-ups.

## Failure surfaces

When a step fails:

- Surface a structured error with code `PN-UPGRADE-NNNN`, the failing change's `id`, the file paths the change touched (or the lockfile, or the pin check, or the validation command), and the inferred remediation.
- Do not retry automatically.
- Do not auto-roll-back the commit. The user can revert if they want a clean slate.
