# Authoring parity integration tests

This directory contains the fixture-driven TS↔PSL authoring parity harness for integration tests.

It also contains side-by-side SQL and Mongo examples that show the same conceptual contract in:

- TypeScript authoring (`contract.ts`)
- PSL authoring (`contract.prisma`)
- emitted canonical JSON (`contract.json`)

## What this suite verifies

The runner in `cli.emit-parity-fixtures.test.ts` validates parity between:

- TS contract authoring (`contract.ts`)
- PSL contract authoring (`schema.prisma`)

For each parity case it asserts:

- normalized IR parity (descriptor's `contractSerializer.deserializeContract`)
- emitted canonical `contract.json` parity
- hash parity (`storageHash`, `profileHash`, and `executionHash` when present)
- determinism (repeated emits are byte-equivalent for `contractJson`)
- provenance invariants (no canonical `sources` metadata in emitted contract)

It also includes diagnostics coverage from invalid PSL fixture inputs.

## Directory layout

`parity/<case>/` contains one parity case:

- `schema.prisma` — PSL input
- `contract.ts` — TS authoring equivalent
- `packs.ts` — shared pack composition used by both providers
- `expected.contract.json` — expected canonical artifact snapshot
- `prisma.config.parity-ts.ts` and `prisma.config.parity-psl.ts` — optional; a case on a target other than Postgres brings its own configs in place of the ones in `templates/`

`diagnostics/<case>/` contains invalid PSL inputs used to assert diagnostics behavior.

`side-by-side/<family>/` contains comparable examples across families:

- `contract.ts` — TypeScript-authored contract
- `contract.prisma` — PSL-authored contract
- `contract.json` — committed emitted artifact snapshot

## How tests are executed

The test runner uses helpers in `authoring-parity-test-helpers.ts` to:

1. discover parity cases from `parity/*`
2. validate required files exist
3. create a temporary integration fixture app test directory
4. copy case runtime inputs (`schema.prisma`, `contract.ts`, `packs.ts`) into the temp directory
5. generate TS + PSL config files used by the emit flow

This keeps fixture data colocated with the runner while still using the existing integration fixture app runtime resolution model.

`expected.contract.json` remains source-of-truth in the fixture directory and is read/written directly there (it is not copied into temp dirs).

## Commands

Run only this suite:

```bash
pnpm --filter integration-tests exec vitest run test/authoring/cli.emit-parity-fixtures.test.ts
```

Run parity suite and existing emit regression:

```bash
pnpm --filter integration-tests exec vitest run test/authoring/cli.emit-parity-fixtures.test.ts
pnpm --filter integration-tests exec vitest run test/cli.emit-command.test.ts
```

Run only the side-by-side examples suite:

```bash
pnpm --filter integration-tests exec vitest run test/authoring/side-by-side-contracts.test.ts
```

Regenerate every authoring fixture (parity `expected.contract.json` and
side-by-side `contract.json`) in one step — this runs as part of the
repo-wide `pnpm fixtures:emit`, so the snapshots stay in sync with the
package's other emitted fixtures:

```bash
pnpm --filter integration-tests run emit:authoring
```

The targeted env-var invocations remain available for regenerating a
single suite. Update expected snapshots for parity cases:

```bash
UPDATE_AUTHORING_PARITY_EXPECTED=1 pnpm --filter integration-tests exec vitest run test/authoring/cli.emit-parity-fixtures.test.ts
```

Update the committed side-by-side `contract.json` snapshots:

```bash
UPDATE_SIDE_BY_SIDE_CONTRACTS=1 pnpm --filter integration-tests exec vitest run test/authoring/side-by-side-contracts.test.ts
```

Both env-var routes write the raw emitter output; run `biome format
--write` on the touched directories afterward (or just use
`emit:authoring`, which does it for you) so the snapshots match the
committed formatting.
