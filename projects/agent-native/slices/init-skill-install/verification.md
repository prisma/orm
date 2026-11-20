# Verification record — init-skill-install

Evidence from D3 live runs (Linux, CLI built from the slice branch, live network,
skills@1.5.14, catalog prisma/skills@main with 8 skills). Final PR-description captures come
from D3 R2 (post-`--copy`); the R1 findings below are preserved because they motivated the
spec amendment (D13) and the upstream bug report.

## skills@1.5.14 layout characterization (D3 R1 probes)

| Invocation                                         | Result on disk                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `--agent cursor claude-code codex windsurf`        | `.agents/skills/*` + `skills-lock.json` only; promised Claude Code/Windsurf symlinks absent |
| `--agent claude-code windsurf`                     | still `.agents/skills/*` only                                                               |
| `--agent claude-code` (single)                     | `.claude/skills/*` (copied)                                                                 |
| `--agent cursor claude-code codex windsurf --copy` | `.agents/skills/*` + `.claude/skills/*` + `.windsurf/skills/*`                              |

Also verified: failure path (unreachable registry) leaves init exit 0 with the manual-command
warning; `--no-skills` produces no agent artifacts; `owner/repo#ref` sources work
(`skills add 'prisma/skills#main' --list`), so ref-pinning per the tagging ask is viable.

## Operator to-do (permission-gated external writes)

### 1. Tagging ask — file on prisma/skills

**Title:** Provide per-ORM-minor release tags so prisma init can pin the catalog

**Body:**

## Context

`prisma init` is gaining an integration that installs this catalog automatically at project
scaffolding time, via the upstream `skills` CLI:

```
npx --yes skills@<pinned> add prisma/skills --agent cursor claude-code codex windsurf --skill '*' --copy -y
```

Because `skills add prisma/skills` resolves the repository's default branch, every
`prisma init` picks up whatever is on `main` at that moment. The installed skills can
therefore drift from the ORM version the user just scaffolded — e.g. skills documenting a
newer CLI surface or client API than the one the project actually uses.

## Ask

Establish per-ORM-minor release tags on this repository (for example `v7.3`), so the ORM CLI
can pin the install to the skills snapshot matching the ORM version it ships with:

```
skills add prisma/skills#v7.3 --agent ... --skill '*' --copy -y
```

The `skills` CLI already accepts `owner/repo#ref` sources (verified with
`skills add 'prisma/skills#main' --list` on skills@1.5.14), so nothing is needed on the
installer side — only a tagging convention here, plus a release step that creates (or moves)
the tag whenever the catalog is updated for a given ORM minor.

## Why minor granularity

- `prisma init` ships a specific ORM minor; skills describing a later minor's features would
  misdirect agents working against the scaffolded project.
- Patch-level tags would be churn without benefit: the surfaces these skills document change
  at minor granularity.

The exact convention (tag naming, movable vs. immutable tags, whether a branch per minor is
preferable) is entirely your call — the only requirement on the ORM side is a stable ref per
ORM minor that the CLI can bake into a release.

### 2. Upstream symlink bug — file on vercel-labs/skills

**Title:** `add`: multi-agent installs never create the promised per-agent symlinks

**Body:**

## Summary

With skills@1.5.14, `skills add <source> --agent <a> <b> ... -y` plans "symlink → Claude
Code, Windsurf" for agents that don't read the universal directory, but no symlinks are ever
created. The final "Installed" summary silently drops the symlink line, leaving those agents
without the skill files.

## Repro

```
mkdir /tmp/repro && cd /tmp/repro
npx --yes skills@1.5.14 add prisma/skills --agent cursor claude-code codex windsurf --skill '*' -y
find . -type l   # -> empty
ls .claude       # -> No such file or directory
```

The plan output shows, per skill: `universal: Cursor, Codex` / `symlink → Claude Code,
Windsurf`. On disk afterwards there is only `.agents/skills/*` and `skills-lock.json` — no
`.claude/`, no `.windsurf/`, zero symlinks anywhere (also not in `$HOME`).

## Observed matrix (skills@1.5.14, Linux, non-interactive `-y`)

| Invocation                                              | Result on disk                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `--agent cursor claude-code codex windsurf`             | `.agents/skills/*` + `skills-lock.json` only; promised symlinks absent |
| `--agent claude-code windsurf` (no universal-dir agent) | still `.agents/skills/*` only                                          |
| `--agent claude-code` (single agent)                    | `.claude/skills/*` (copied) — works                                    |
| `--agent cursor claude-code codex windsurf --copy`      | `.agents/skills/*` + `.claude/skills/*` + `.windsurf/skills/*` — works |

Reproduced identically in a scrubbed environment (`env -i`), so agent-session detection
("Agent detected — installing non-interactively") is not the trigger.

## Expected

Either the symlinks the plan promises are created, or the plan/summary should not claim them.

## Impact

Downstream tooling invoking multi-agent installs non-interactively (e.g. `prisma init`,
which now installs this way) has to pass `--copy` to get working files for Claude Code and
Windsurf, at the cost of duplicated content.

## Final captures (D3 R2, post-`--copy`, commit ca261b483)

- Default `prisma init`: exit 0; summary lists `.claude/skills/`, `.windsurf/skills/`,
  `.agents/skills/`, `skills-lock.json`; on disk, all 8 skills present in each of the three
  directories (24 `SKILL.md` files), `find . -type l` → 0 (real copies).
- Failure path (unreachable registry): exit 0; warning with manual command including
  `--copy`.
- `--no-skills`: exit 0; no agent artifacts (path untouched by the amendment).
