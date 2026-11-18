---
name: bumping-biome
description: Bumps `biome` package versions (e.g. `@biomejs/biome`) using `pnpm`, aligns `biome.jsonc` files with the new version/s across the repository and runs biome-related checks. Use when required to update `biome` to a newer version - explicitly or implicitly (e.g. after running `pnpm up`, `pnpm update`, `pnpm upgrade` without specific package names).
---

# Bumping Biome Skill

## Instructions

1. Run `pnpm up -D -w -r @biomejs/biome@<version>` - replace `<version>` with a specific package version provided in the session, otherwise fallback to `latest`.

2. If any `biome.json` files remain, rename them to `biome.jsonc`. Then replace the old package version number in `$schema` with the newly installed package version number from the previous step, in every `biome.jsonc`.

3. Run `pnpm -w lint:fix`. Report any issues/regressions briefly.

4. If there are remaining unsafe fixes following the previous step, offer to run `pnpm -w lint:fix:unsafe` to attempt to fix some of the issues/regressions.

5. If the offer in the previous step is agreed, run the appropriate command, and report any remaining issues/regressions briefly.

6. If there are remaining issues/regressions after the previous step, try and come up with your own suggestions for fixing them and present the plan.

## Don't Do

1. Don't scan for `biome` versions. If the session doesn't include a specific package version number, use `latest`.

2. Don't read the root `package.json` or lockfiles looking for the current `biome` version/s. We'll see the change in version numbers in Git anyway.
