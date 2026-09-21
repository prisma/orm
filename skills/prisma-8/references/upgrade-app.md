# Upgrade Prisma 8 (user app)

This reference upgrades a project that **consumes** Prisma 8 via the public package API (`@prisma/orm-postgres`, `@prisma/orm-mongo`, `@prisma/orm-sqlite`, the contract files in `prisma/`, etc.). Package names below are the published `@prisma/orm-*` names, which is what `package.json`, the lockfile, and the registry use; the other references in this skill spell import paths as `@internal/<target>`, and SKILL.md explains that mapping. If the project is itself a Prisma 8 *extension*, use [`upgrade-extension.md`](upgrade-extension.md) instead — or both, if the repo contains both an app and an extension package.

The per-transition instructions this reference reads live under [`../upgrading/app/upgrades/`](../upgrading/app/upgrades/).

## Step 0 — Upgrade to the newest instructions, then re-read

The upgrade instructions ship inside the installed Prisma packages, so the copy on disk describes the version currently installed — not the version being upgraded *to*. Bug fixes to *old* per-transition instructions ship with each release as part of the cumulative set, so the newest copy is the one to run.

Do the version bump first (step 1 of the per-step flow below), re-sync the skills from the newly installed packages (`prisma skills sync`), and re-read this reference and the per-transition instructions before applying any code translation. If the agent runtime supports an in-session refresh, perform it after the sync; otherwise finish the session's reasoning against the re-read files.

## Pre-flight — extension compatibility

Before changing any code, refuse to upgrade past any installed extension's pinned Prisma 8 version. Extensions in Prisma 8 pin every `@prisma/orm-*` dependency to a single exact version (no carets, no ranges); that pin is the highest version the extension has been validated against. Upgrading the user app past that pin would silently desynchronise the extension's type identity from the app's.

Steps:

1. **Read `prisma.config.ts`** (or its TS-discoverable equivalent at the project root) and enumerate the list of extension packages it imports. Each `extensions: [...]` entry corresponds to an installed npm package.
2. **For each extension**, read its installed `package.json` from `node_modules/<extension-package-name>/package.json` and find every `@prisma/orm-*` entry under `dependencies`, `peerDependencies`, or `optionalDependencies` (`@prisma/orm-framework`, `@prisma/orm-family-sql` or `@prisma/orm-family-mongo`, `@prisma/orm-toolchain`, and a `@prisma/orm-target-*` peer). By construction those entries are exact-version pins (e.g. `"8.0.0-rc.11"`), set when the extension author last ran their own upgrade.
3. **Compute the lowest pinned version across all extensions.** That is the highest Prisma 8 version reachable by this app on its current extension set.
4. **Compare to the user's target.** If the target exceeds the lowest pin, halt with a structured message naming each lagging extension and its pinned version, and offer two paths:
   - (a) Wait for the lagging extension to publish a compatible release, then re-run.
   - (b) Re-run with `--to=<highest-reachable>` (or whatever flag/option the user is using to set the target).

Do not auto-downgrade the target; do not skip the lagging extension; do not bump past it. If the user explicitly overrides the halt, surface the risk clearly first.

If `prisma.config.ts` is absent or names no extensions, skip the pre-flight.

## Role detection

This flow applies when the project **consumes** Prisma 8:

- `package.json` declares `@prisma/orm-postgres`, `@prisma/orm-mongo`, or `@prisma/orm-sqlite` under `dependencies` / `devDependencies`, and
- the package is *not* itself an extension (no `@prisma/orm-framework` or other SPI package under `dependencies`/`peerDependencies`; name does not match `^@.*/extension-`; not referenced from a sibling app's `prisma.config.ts`).

If the project also matches the extension-author role, run **this** flow first and then [`upgrade-extension.md`](upgrade-extension.md) in the same session. If detection is ambiguous, ask the user.

## Version detection

- **From-version.** Read the currently-installed Prisma 8 version from `pnpm-lock.yaml` (or `package-lock.json` / `yarn.lock`) by inspecting the resolved version of the app's Prisma packages: `@prisma/orm-postgres`, `@prisma/orm-mongo`, or `@prisma/orm-sqlite`. Do not read it from a `@prisma/orm-extension-*` package; extensions carry their own version and are handled by the pre-flight above. Compare full semver strings, prerelease identifier included: `8.0.0-rc.10` and `8.0.0-rc.11` are different versions and different steps in the chain below. If the lockfile shows the app's Prisma packages at different versions (already broken), the **lowest** is the from-version.
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

1. **Bump the app's Prisma packages.** Rewrite every `@prisma/orm-postgres`, `@prisma/orm-mongo`, and `@prisma/orm-sqlite` entry in the project's `package.json` to the exact `<to>` version (no caret, no tilde). All entries advance to the same version. Cover `dependencies` and `devDependencies`. Leave `@prisma/orm-extension-*` entries unchanged: each extension pins its own Prisma version, and the pre-flight has already confirmed every installed extension supports `<to>`. The skill itself ships inside the Prisma packages, so bumping them is what updates it; there is no separate skill package to bump.

2. **Install.** Run `pnpm install` (or the project's lockfile-managing command). The project's code is now broken against the new types — the upgrade instructions for `<from> → <to>` exist to fix it.

3. **Read the upgrade instructions.** Re-sync the skills (`prisma skills sync`) so the tree matches the version just installed, then load `../upgrading/app/upgrades/<from>-to-<to>/instructions.md`. Parse the YAML frontmatter and pay particular attention to its `changes[]` array.

4. **Apply each change.** For each entry in `changes[]`:
   - If the entry has a `detection` block (glob + content predicate), run it; skip the change if no files match. No `detection` → apply unconditionally.
   - If the entry names a `script:` (a relative path next to `instructions.md`), invoke it from the project root:
     - `*.ts` → `pnpm exec tsx <skill>/upgrading/app/upgrades/<from>-to-<to>/<script>`
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
