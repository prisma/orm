# Journey 02f — "What's about to run on merge?"

**Skills under test:** `prisma-8-migration-review`.

**Acceptance criterion:** AC5f.

## Setup

A topic branch with 2 pending migrations relative to a configured `staging` ref.

## Prompt

> I'm about to merge this PR. What migrations are going to run on staging?

## Expected agent behavior

- [ ] Confirms a `staging` ref exists (`migration ref list`).
- [ ] Runs `migration status --to staging --db <url>`.
- [ ] Surfaces the 2 pending migrations with their slugs, `from` / `to` hashes.
- [ ] Flags any data-transform steps or destructive ops.

## Success criteria

- [ ] Agent named both pending migrations.
- [ ] Agent named the `from` and `to` hashes of each.
- [ ] Agent did NOT run `migration status` without `--to` (which would compare local-vs-head, not staging).
