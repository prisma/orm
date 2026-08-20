# Release notes

Every stable (`latest`) release ships a committed notes file at `docs/releases/v<version>.md`. Its contents **are** the GitHub Release body: the publish workflow runs `gh release create --notes-file docs/releases/v<version>.md`, so what you commit here is exactly what readers see on the [GitHub Releases](https://github.com/prisma/prisma/releases) page. There is **no auto-generated fallback** — a stable release with no notes file fails to publish rather than shipping flat, uncurated notes.

## When the file must exist

The notes file must be committed **before the release PR merges**. Two modes of the same gate enforce this — both implemented in [`scripts/check-release-notes.mjs`](../../scripts/check-release-notes.mjs) and wired into [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) and [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml):

- **PR mode** (`pnpm check:release-notes --mode pr`) runs on every PR. When a PR changes the root `package.json` `version` (a release bump), it fails unless the matching `docs/releases/v<version>.md` is present — so a release PR that forgot its notes is caught in review, not after merge.
- **Publish mode** (`pnpm check:release-notes --mode publish`) runs in the publish workflow for `latest` builds only, immediately before the Release is created, and fails the publish if the file is missing. Dev/beta builds create no GitHub Release and are not gated.

These files are drafted automatically by the [`draft-release-notes`](../../skills-contrib/draft-release-notes/SKILL.md) skill, which `publish-npm-version` runs before opening the release PR; the maintainer reviews and adjusts the result in the PR. You can also author one by hand using the template below.

## Authoring conventions

- **Write for users, not maintainers.** The audience is someone upgrading their app, not the team that shipped the change. Do not carry internal `TML-NNNN:` issue prefixes — link the PR instead.
- **Categorize** entries under the fixed section order below, and **omit any section that has no entries**.
- **Lead with breaking changes** — they are what a reader scanning the notes most needs to see.
- **Show the impact of breaking changes with a short before/after example.** For the code-visible breaking changes (contract-shape changes, authoring-surface changes, runtime-option changes), nest a compact `before` / `after` snippet under the prose bullet so a reader can see the change at a glance. Source the snippet from the matching `<transition-label>` upgrade recipe so it stays accurate. Lead with PSL (```` ```prisma ````) when the change is on the authoring surface; use TS/JSON only when the change is genuinely a TS/emitted-shape change. Operational-only breaks (version floors, peer-dep changes, package removals) need no example.
- **Link PRs and contributors as absolute markdown links** — `[#1234](https://github.com/prisma/prisma/pull/1234)` and `[@handle](https://github.com/handle)`, never bare `#1234` / `@handle`. Bare references only autolink inside the GitHub Release body, **not** when this file is read as a repo file or in PR review; explicit links work in every context. Attribute contributors, especially first-time ones.
- **Link migration recipes as absolute, tag-pinned URLs** — not repo-relative paths. This file is published verbatim as the GitHub Release body, where repo-relative links do not resolve; pinning to the release tag keeps the link working and rot-proof. A breaking change can affect either audience or both, so link whichever recipe directories exist:
  - User-facing migrations: `https://github.com/prisma/prisma/blob/v<version>/skills/prisma-next-upgrade/upgrades/<transition-label>/`
  - Extension-author migrations: `https://github.com/prisma/prisma/blob/v<version>/skills/prisma-8-extension-upgrade/upgrades/<transition-label>/`

The section order is: **Breaking changes → Features → Fixes → New contributors**.

1. **Breaking changes** — API removals or renames, semantic changes to existing APIs, contract-format changes. Say what the reader must *do*, not just what changed.
2. **Features** — new capabilities.
3. **Fixes** — bug fixes.
4. **New contributors** — first-time contributors, with the PR that welcomed them.

## Template

Copy this into `docs/releases/v<version>.md` and fill it in, dropping any section with no entries:

````md
# v<version>

<optional one- or two-sentence summary of the release's theme>

## Breaking changes

- **<short title>** — <what changed and what the reader must do>. See the [migration recipe](https://github.com/prisma/prisma/blob/v<version>/skills/prisma-next-upgrade/upgrades/<transition-label>/). ([#<pr>](https://github.com/prisma/prisma/pull/<pr>))

  Before:

  ```prisma
  <old shape>
  ```

  After:

  ```prisma
  <new shape>
  ```

## Features

- <new capability>. ([#<pr>](https://github.com/prisma/prisma/pull/<pr>))

## Fixes

- <bug fix>. ([#<pr>](https://github.com/prisma/prisma/pull/<pr>))

## New contributors

- [@<handle>](https://github.com/<handle>) made their first contribution in [#<pr>](https://github.com/prisma/prisma/pull/<pr>)
````

## See also

- [`CHANGELOG.md`](../../CHANGELOG.md) — the rolling, newest-first index; each release entry mirrors its per-release file here under a `## v<version>` header.
- [`docs/oss/versioning.md`](../oss/versioning.md) — the version contract and the release procedure these notes are part of.
