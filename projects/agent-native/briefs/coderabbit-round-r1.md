# Brief: post-review fixes — CodeRabbit round (cross-slice)

## Task

Address the accepted CodeRabbit findings on the three code PRs: one commit per branch,
pushed (updates the open PRs).

## Fix 1 — S1 branch (`tml-2968-...`, worktree `agent-native-s1`; updates #29689)

`packages/cli/src/init/skill-install.ts`: `defaultExec` runs execa with no `timeout`; a hung
network call would hang `prisma init` indefinitely, defeating the non-fatal design. Add
`timeout: 60_000` to the execa options in `defaultExec` (a killed process rejects → the
existing `{ ok: false, manualCommand }` path). Doc-comment the constant-in-place if a "why"
is not obvious. Gates: `pnpm run tsc` + `pnpm exec vitest run
src/__tests__/skill-install.vitest.ts` from packages/cli.

## Fix 2 — S3 branch (`tml-2969-...`, worktree `agent-native-s3`; updates #29691)

`packages/cli/src/__tests__/mcp-safety.vitest.ts`:
(a) the fixture's `prisma.config.ts` imports `@prisma/config`, whose `main` points at
`dist/` — if `packages/config/dist/index.js` is missing, the failure is a confusing module
resolution error instead of your fail-clear message. Extend the existing module-level
precondition check to also assert that file exists, with the same actionable error style.
(b) `client.close()` only runs in the `finally` around `callTool`; a `connect()` failure
leaks the spawned stdio process. Move `await client.connect(transport)` inside the
try/finally.
Gates: `pnpm run tsc` + the vitest file green (twice, it's a safety pin).

## Fix 3 — S2 branch (`tml-2971-...`, worktree `agent-native-s1`; updates #29690)

`packages/cli/src/utils/skills/skills-offer.ts`: the already-installed markers check
`skills-lock.json`, `.claude/skills/prisma-*`, `.agents/skills/prisma-*` — but S1's `--copy`
install also writes `.windsurf/skills/`. Add `.windsurf/skills/prisma-*` as a fourth marker
(spec already amended). Update/extend the corresponding unit tests (the marker `test.each`
and the foreign-entry negative case if applicable). Gates: `pnpm run tsc` + `pnpm exec
vitest run src/__tests__/skills-offer.vitest.ts`.

**Branch order note:** commit Fix 1 on the S1 branch first, then switch to the S2 branch and
**rebase it onto the updated S1 head is NOT wanted** — leave S2 stacked where it is (its PR
diff is computed against the S1 branch ref; no rebase needed). Just commit Fix 3 on S2's own
head. Fix 2 is independent (s3 worktree).

## Completed when

- [ ] Three commits (one per branch), conventional style, each referencing the finding it
      addresses in the body (plain English, no CodeRabbit IDs needed).
- [ ] All three branches pushed (updates the open PRs — pre-authorized).
- [ ] Gates green per fix; commands recorded.

## Constraints (terse)

Explicit staging; no amend; no force-push; heartbeats as usual. Time-box: 40 minutes.
Halt conditions: any fix turns out to require interface changes beyond the named lines.

Same return shape. Begin.
