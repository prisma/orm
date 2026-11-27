# Spike: does a range on `8.0.0-ea.0` install an old release candidate?

Run on 2026-11-25, with the harness and package managers of [the second install trial](2026-11-24-below-ga-and-monorepo-installs.md).

## The question

Every package is published today as `8.0.0-rc.1` to `8.0.0-rc.26`. The design publishes a package that is not GA at `8.0.0` under its real level, for example MySQL as `8.0.0-ea.0`, and marks its release candidates as deprecated. `8.0.0-ea.0` sorts below `8.0.0-rc.26`. A range on the new version, `~8.0.0-ea.0` or `^8.0.0-ea.0`, admits `8.0.0-rc.26`, and that is the highest version it admits. Which version does a package manager install?

## What was run

Stub packages `mysql` and `tgt-mysql` at `8.0.0-rc.25`, `8.0.0-rc.26`, `8.0.0-ea.0` and `8.0.0-ea.1`, with GA platform stubs at `8.0.0`. An application whose lines are `~8.0.0-ea.0` for the two and `~8.0.0` for the rest, with no lockfile. Each case twice: release candidates not deprecated, and deprecated.

## Result

Installed version of `mysql`, for the lines `~8.0.0-ea.0` (carets gave the same):

| Package manager | `latest` points at `8.0.0-ea.1` | `latest` points at a later minor, release candidates not deprecated | `latest` points at a later minor, release candidates deprecated |
| --- | --- | --- | --- |
| npm | `ea.1` | `rc.26` | `ea.1` |
| pnpm | `ea.1` | `rc.26` | `rc.26`, with a deprecation warning |
| Yarn, both linkers | `rc.26`, or `ea.1` when deprecated | `rc.26` | `ea.1` |
| Bun, both linkers | `rc.26`, deprecated or not | `rc.26` | `rc.26`, no message |

- npm and pnpm prefer the version the `latest` tag points at when it satisfies the range. That is the only reason they picked `ea.1` in the first column. Once `latest` moves to the next minor they pick the highest match.
- Deprecation changes what Yarn picks, and what npm picks once `latest` no longer matches. It does not change pnpm or Bun.
- Bun also gave an automatically installed peer the old release candidate.
- No run printed a warning that would tell the user, other than pnpm's deprecation notice.

## Two controls

- **A later minor.** With `mysql` at `8.1.0-ea.0` and lines `~8.1.0-ea.0`, every package manager installed `8.1.0-ea.0`. There are no old release candidates on that version.
- **A patch number of 1 for the first versions.** With `mysql` at `8.0.1-ea.0` and `8.0.1-ea.1`, and lines `~8.0.1-ea.0`, every package manager installed `8.0.1-ea.1`, with nothing deprecated and no warning. `8.0.1-ea.0` sorts above every `8.0.0-rc.*`.

## What a package manager writes when it is given a range

`add name@~8.0.0-ea.0`: npm, Yarn and Bun wrote the range as given. pnpm wrote the exact version it resolved.

## What follows

Marking the release candidates as deprecated is not enough to make the move down at `8.0.0` work with ranges. The question is with the operator. The proposal is to number the first versions of the packages that move down `8.0.1-<level>.0`, for release `8.0` only.
