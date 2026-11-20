# Retros — agent-native

## 2026-07-03 — External-tool layout assumed from its docs, falsified live (S1 D3)

**Trigger:** dispatch-failure (I12 stop in D3 R1 of slice `init-skill-install`): the live
`prisma init` run could not satisfy the DoD's `.claude/skills/` condition.

**What happened:** skills@1.5.14 with multiple `--agent` values writes only the universal
`.agents/skills/` tree; the per-agent symlinks its own plan output promises are never
created (upstream bug). The slice spec — and the D2 summary lines built on it — asserted a
layout that did not exist on disk. Resolved by amending the spec to pass `--copy` (decision
D13); one extra round.

**Root cause:** the slice-spec grounding step covered _our_ codebase thoroughly but took
the _external_ CLI's behavior on faith (its README, its own progress output, and prisma-next's
described outcome). No empirical probe of `skills add` was run until the final verification
dispatch — the slice's only contact with external reality was scheduled last, so a wrong
assumption could not surface any earlier. The proximate reading ("upstream bug") is true but
not actionable; the actionable root is the spec-time probing gap.

**Landing surface(s):**

- Project-context: `drive/spec/README.md` § Known constraints & gaps — probe external-tool
  behavior empirically at spec time, or make the probe the first dispatch (dated entry).
- Candidate canonical amendment (for the operator, not applied): `drive-specify-slice`
  § Step 3 "Ground in the codebase" could name external-system probing explicitly; recorded
  here rather than editing canonical skills unattended.
