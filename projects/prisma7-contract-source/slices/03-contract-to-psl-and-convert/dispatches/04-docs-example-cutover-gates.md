# Dispatch 4: docs, example cutover, upgrade entries, closing gates

**Slice plan:** `projects/prisma7-contract-source/slices/03-contract-to-psl-and-convert/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Make the cutover a documented, demonstrated, upgrade-recorded feature: the example app runs it, the READMEs describe it in the public guide's phase 4 terms, the upgrade skills carry entries for the two behaviour changes this PR makes to existing Prisma 8 users, and every repo-wide check is green.

## Scope

In, one commit per numbered item:

1. **Example cutover.** `examples/prisma7-adoption` gains a cutover step: `prisma contract convert`, a second config file (or a documented switch) pointing `contract:` at the written `contract.prisma`, `contract emit`, and `db verify` with zero findings; then the phase 4 steps the guide names (`migration plan --name baseline`, `db sign`, `migration ref set db <timestamp>_baseline`). The example's vitest run covers the cutover; the README gets a "Cutover" section in the guide's order and names the guide. Read https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql first; project notes may be stale.
2. **READMEs.** `packages/2-sql/2-authoring/contract-prisma7/README.md` gains a cutover section pointing at the command; `packages/3-extensions/postgres/README.md`'s `prisma7Schema` section gets the one-paragraph cutover pointer; `packages/1-framework/3-tooling/cli/README.md` (done in dispatch 3) is cross-checked for consistency.
3. **Upgrade entries** in `skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.11-to-8.0.0-rc.12/instructions.md` (the file exists with `changes: []`; append entries): (a) `json-default-literal-is-json-text`: a string literal `@default("…")` on a `Json`/`Jsonb` column is now parsed as JSON text; a contract that meant the JSON *string* must now write the quoted form (`@default("\"text\"")`); detection glob `**/*.prisma`, a token-precise predicate for a string default on a JSON-typed field; (b) `scalar-list-fields-keep-type-params`: emitted `contract.d.ts` for scalar list fields now carries `typeParams`; run `contract emit` once; detection on `contract.json`. Extension side: only if `packages/3-extensions/` changed in this PR beyond the README (check `git diff prisma7-contract-source..HEAD -- packages/3-extensions`); if only docs changed, add the frontmatter comment the extension file already uses. Validate by execution per `skills-contrib/record-upgrade-instructions/SKILL.md`, at least for (b).
4. **Closing gates**: `pnpm build`, `pnpm lint:deps`, `pnpm lint:docs`, `pnpm lint:framework-vocabulary` (count must equal the threshold; if a CLI change moved it, adjust the threshold in `scripts/lint-framework-vocabulary.config.json` downward only or remove the vocabulary), `pnpm lint:throws`, `pnpm lint:casts`, `pnpm test:packages`, `pnpm test:integration`, `pnpm fixtures:check`, `node scripts/check-upgrade-coverage.mjs --mode pr --prev prisma7-contract-source`, `node scripts/coverage-config.test.mjs` if a package was added, root typecheck; grep for `projects/` references outside `projects/`. Save every output under `wip/` and quote the summary lines.

Out: any new feature. Mongo.

## Completed when

- [ ] `pnpm --filter prisma7-adoption test` green including the cutover step; README section present.
- [ ] Both upgrade entries present and validated; coverage check exit 0 against `prisma7-contract-source`.
- [ ] Every gate above exit 0, quoted.

## Halt conditions

- The example's cutover step exposes a converter defect. Report the diff; fix only if local and clear, in its own commit with a test.
- `migration plan --name baseline` or `migration ref set` behaves differently from the guide. Report; do not work around.

## References

- Slice spec § Cutover in the guide's terms; the guide; `skills-contrib/record-upgrade-instructions/SKILL.md`; `examples/prisma7-adoption/README.md` and its test; the slice 4 DoD walk `projects/prisma7-contract-source/slices/04-prisma7-adoption-example/dod-walk.md`.
- Rules, commits, heartbeat, return shape: as dispatch 1.
