# Slice 6: `migration ref policy` commands — plan

Spec: [`spec.md`](spec.md). One pull request in prisma/orm, branch `tml-3959-ref-policy-commands`, from `main`. The prisma-cli pull request is a later step, after an ORM release carries this one.

## Dispatches

One persistent implementer (Opus, medium effort) runs both dispatches in order. One persistent reviewer (Opus, high effort) reviews each.

### 1. The commands and the advice change

**Outcome:** `prisma-next migration ref policy show|set|delete` behave as the spec says, such that the commands can do nothing a hand edit of the ref file cannot, and no output of theirs, and no error anywhere, advises loosening a ref's policies.

- Tests first, in `packages/1-framework/3-tooling/cli/test/orm/` (next to `ref-set.test.ts`), for every item in the spec's Tests section that runs without a database, including the source check and the "no output names the consent flag" check.
- The strictness comparison and the short-to-long mapping, in the CLI package, derived from the level lists in `framework-components/src/control/database-policies.ts`.
- The three commands under `src/orm/ref/policy/`, their operations in `src/control-api/operations/`, not exported from `src/exports/control-api.ts`.
- The group in `BIN_GROUPS` and the commands in `createBinCommands` (`src/orm/cli.ts`) and in `src/orm/family.ts`.
- `migration ref list` human table shows declared policies.
- `MIGRATION.POLICY_MISMATCH` advice chosen per difference (`src/utils/policy-errors.ts`), with tests for a looser ref, a stricter ref and both.

**Builds on:** nothing. **Hands to:** dispatch 2.

### 2. The journey, the decision record and the docs

**Outcome:** a reader of the docs, the skill or the help learns the commands exist, what they do not do, and that a refusal is not a reason to change a ref's policies, such that no doc or skill text suggests changing a policy.

- The PGlite journey from the spec's Tests section, beside `test/integration/test/cli.database-policies.migrate.e2e.test.ts`.
- A new ADR amending ADR 320, as the spec says. Check the next free ADR number on `main` and in open pull requests first. A pointer from ADR 320 to it.
- The docs and skill files the spec lists, and every place that quotes the old `POLICY_MISMATCH` or `DATA_PROTECTION_FORBIDS` advice. No text may suggest changing a policy.

**Builds on:** dispatch 1. **Hands to:** review.

## Failure modes to watch

- A user-facing message names our functions or internals (F59). Read every new string as a user would.
- Validation that passes locally and fails in CI because lint or the test project's typecheck was not run (F14).
- A change in what a command prints passes package tests and fails an integration file that asserts the old text. Search `test/integration` for the old advice text and run the files that assert it.
- Destructive git operations without orchestrator approval (F5): none allowed.

## Checks

- Each dispatch: `pnpm build` (the whole workspace, never one package), `pnpm typecheck`, `pnpm --filter @internal/cli lint` (use the CLI package's real name), the CLI package's touched test files, `pnpm lint:deps`, `pnpm lint:ratchets`.
- Dispatch 2 adds the new journey file, the integration files that assert `POLICY_MISMATCH` text, and the CLI package's coverage run.
- Never a whole test suite on this machine. CI runs those.
