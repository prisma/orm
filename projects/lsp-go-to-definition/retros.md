## 2026-10-06 — Final retro: a small feature took days because of process and avoidable rework

**Trigger:** Mandatory at project close (invariant I10).

**What happened:** Two slices (#30563, #30578) delivered go-to-definition and moved binder construction to the caller. The operator repeatedly flagged slowness: per-dispatch full test suites, a 40-minute silent stall, three full-suite runs caused by `--` before test paths, a round spent consolidating setup that parallel helpers had copied into ~33 files, an 11-hour stop on one decision with independent work available, two merges of a fast-moving `main`, and a squash during a rebase that removed the operator's view of what changed since their last review. A rebased head was also pushed without typechecking.

**Root cause:** Gate cadence was copied from the dispatch template instead of sized to the change; briefs named call sites but not the shared shape; the orchestrator rewrote history and pushed rebases without the checks it applies to dispatches. Separately, design rules the operator holds (the binder only binds; interpreters never look names up; no filtering; no compatibility wrappers) were not written down anywhere before the project, so they surfaced one review comment at a time.

**Landing surface(s):**

- Project-context: `drive/calibration/failure-modes.md` § F39 (no history rewrite without asking), F40 (gate after every rebase/merge), F41 (`--` drops test filters), F42 (fan-out without a decided shape).
- Project-context: `drive/calibration/dod.md` § Cadence — full suites once per slice; the orchestrator picks the gate without asking.
- Canonical (repo skill): `skills-contrib/record-upgrade-instructions/SKILL.md` — `@internal/*`-only changes declare `changes: []`.
- ADR: the binder design rules (see close-out PR).
