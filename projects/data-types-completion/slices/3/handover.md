# Handover: slice 3 of "Data types own column types" (TML-3531)

Written by sif-13 on 2026-10-08, when Will halted the session ahead of a rate limit.

## Context

- Previous transcript, for context: `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-data-types-value-ownership-7ec585/b9357800-b0c0-4ade-97ce-bd4fa04c6a1c.jsonl`. It is long. Read Will's messages first (`jq -r 'select(.type=="user") | .message.content | strings' <file>`), then the last few hundred lines.
- Project: "Data types own column types", Linear project P-TML-1145. Docs are in `projects/data-types-completion/`. Slices 1 (TML-3386) and 2 (TML-3388, #30576) are merged.
- Slice 3 is TML-3531: a data type owns its values, and a codec converts them. A value is a `DataTypeValue` `{ type, params, value }`. A codec has four methods: `fromDataTypeValue`, `toDataTypeValue`, `fromWire` and `toWire`.
- Design: ADR 254 (`docs/architecture docs/adrs/ADR 254 - Data types and casts.md`) and decisions 1 to 23 in `design-notes.md` under "A data type owns its values". Will approved decisions 1 to 20; I added 21 to 23 after #30628 merged into ADR 254.
- Design PR [prisma/orm#30656](https://github.com/prisma/orm/pull/30656), branch `data-types-value-ownership-design`, is open and waiting for Will. The implementation branch includes it, and the branch has fixed ADR 254 in places since (the JSON projection paragraph). Bring the design PR up to date or close it into the slice PR, whichever Will prefers.
- Slice plan: `slices/3/plan.md` has dispatches a to h. Briefs are in `slices/3/briefs/`. `common-rules.md` names the old worktree path; change it to yours before the next dispatch.
- Findings and rulings, round by round: `slices/3/build-review.md`. Inventories and probe scripts: `slices/3/notes/`.

## Where the work stands

Branch `tml-3531-data-type-values` is pushed to the `bot` remote. Main has moved since the branch last merged it; merge main (never rebase).

- **Dispatch a** (values and the four codec methods) is done and closed after three review rounds. Its rulings are in `notes/dispatch-a-rulings.md` and `build-review.md`.
- **Dispatch b** (database JSON read with `fromWire`; JSON projections cast to text) is built. Review round 1's findings, S3-b-R1-1 to R1-10, are logged with rulings in `build-review.md`. The fixes are in commits `70d3259f29` to `0e9254eb14`, and `eefeaa4e37` records their status. Every finding is fixed except R1-6 (include cells pass the row's `signal`). The ORM sends no signal with any query, so there is none to pass on, and adding one is a public API change. I accept R1-6 as not applicable; record that in the log. Next: run review round 2 on `682ee5dd54..eefeaa4e37`'s fix commits, then close dispatch b.
- **Dispatches c to h** have not started. Briefs c and d are written; e to h are not. Write them from the plan's table, as for a to d.

## Carried forward

These are already recorded in `plan.md` or `build-review.md`:

- Dispatch f removes `contract infer`'s use of `readReportedValue`. That is the lenient reader's last caller.
- Dispatch g's upgrade instruction must cover:
  - Postgres contracts that store a default in another spelling than their parameters give (`"1.5"` on `numeric(10,2)`, a padded `char`, a time finer than its precision);
  - SQLite REAL and INTEGER columns holding text that is not a number, which `fromWire` now refuses;
  - a two-dimensional text array, now refused;
  - `min` and `max` of `text[]`, which now return an array;
  - the renaming of `emptyResultJson` to `emptyResultWire`.
- Dispatch h documents `DataType.fromCodec`, the constructor codecs use, in ADR 254 and the codec guide, and fixes `emptyResultJson` in `docs/reference/aggregate-descriptor-guide.md` and `error-reference.md`.
- Dispatch d also narrows the `sqlite/datetime@1` and `sqlite/json@1` readers, which dispatch b left wide.

## Open with Will

- TML-3406 is assigned to him and In Progress. Dispatch e deletes its subject.
- The bot's GitHub token appeared in an old transcript and should be rotated.
- Linear refused two relation updates on TML-3531 with 503 errors: the relation to TML-3479 is missing, and the one to TML-3387 may be missing too.

## Rules

- Subagents run on Opus; pass `model: "opus"` explicitly.
- Run node, pnpm and commits through `mise exec --`.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and no AI attribution.
- Push only to the `bot` remote. Never rebase, amend or force-push.
- No full integration or e2e runs locally.
- The orchestrator writes ADRs, specs, plans, briefs and PR text; subagents research, implement and review.
- Write plainly and briefly. Never use the question UI. Ask Will only about design-level decisions.
- After dispatch h: run `/drive-code-review` without the walkthrough, fix what it finds, do the manual QA in `plan.md`, then hand back to Will.
