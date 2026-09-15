# Dispatch 3: `prisma contract convert`

**Slice plan:** `projects/prisma7-contract-source/slices/03-contract-to-psl-and-convert/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Give users the cutover command: `prisma contract convert` loads the configured Prisma 7 source, prints it as Prisma 8 PSL through dispatch 2's hook, and writes the file, so that switching `contract:` to the written file and running `contract emit` produces the same contract.

## Scope

In, one commit per numbered item:

1. **The command** `packages/1-framework/3-tooling/cli/src/orm/contract/convert.ts`, built from `infer.ts`'s shape (`defineOrmCommand`, `needs: { config: ormConfigSection }`, `--output`, the overwrite warning, `publishTextArtifact`, `inferredContractPathFor`, a `--json` document carrying `psl.path`). Registered in `orm/family.ts` and `orm/cli.ts` under the `contract` group. Loading goes through the same code `contract emit` uses to build the source context and call `source.load` (`control-api/operations/contract-emit.ts`); extract a shared function rather than copying it, and keep `contract emit` byte-for-byte in behaviour. Source diagnostics on failure print exactly as they do for `contract emit` (code, file, line, message in the human output). The header passed to `printPsl` is `Converted from <schema path as configured> by \`prisma contract convert\`.`
2. **Refusals.** A config whose `contract.source.format` is not `prisma7` fails with a structured error (`CONTRACT.CONVERT_REQUIRES_PRISMA7_SOURCE`, or the closest existing family of codes; follow `.agents/rules/cli-error-handling.mdc`) that says convert applies only to a Prisma 7 source and names the format found; nothing is written. A target without the print capability fails with the family instance's `CONTRACT.CONVERT_UNSUPPORTED`.
3. **Unit tests** in `packages/1-framework/3-tooling/cli/test/orm/contract-convert.test.ts` with injected doubles, as `contract-infer.test.ts` does: happy path writes the file with the header and reports the path; `--output` respected; overwrite warns; refusal on a PSL source writes nothing; `--json` shape.
4. **The cutover journey** in `test/integration/test/cli-journeys/prisma7-source.e2e.test.ts`: after the existing emit, sign, verify steps, run `contract convert`, rewrite the fixture app's `prisma.config.ts` to the PSL source pointing at the written file, run `contract emit`, and assert `db verify` reports zero findings and the emitted `contract.json` equals the one the Prisma 7 source emitted (three hashes and the domain plane; the hashes are in the file). Use `runOnEngine` and the journey helpers; add a `runContractConvert` helper beside `runContractInfer` if missing.
5. **CLI help and README.** `packages/1-framework/3-tooling/cli/README.md` documents `contract convert` beside `contract infer`, in the cutover order the public guide's phase 4 uses (convert, switch `contract:`, `contract emit`, `migration plan --name baseline`, `db sign`, `migration ref set db <timestamp>_baseline`, remove Prisma 7). Regenerate any auto-generated CLI reference the repo keeps (`.agents/rules/cli-package-exports.mdc`, `pnpm lint:docs`).

Out: the example app and the Prisma 7 source README (dispatch 4). Mongo. Any change to the printer beyond a defect the journey exposes (fix it in its own commit with a test, and say so).

## Completed when

- [ ] The journey test is green and its report quotes the verify summary line and the hash comparison.
- [ ] `contract emit` tests unchanged and green; `pnpm --filter @internal/cli test`, `typecheck`, `lint`; `pnpm --filter integration-tests test cli-journeys/prisma7-source`; `pnpm lint:docs`; `pnpm lint:framework-vocabulary` (the CLI is framework; do not add family words); root typecheck.
- [ ] `prisma contract convert --help` output pasted in the report.

## Halt conditions

- The command needs `@prisma/cli-engine` changes. Report the constraint.
- The journey shows the converted contract differing from the source's. Do not patch the fixture; report the diff (likely a printer defect; fix under the rule above only if the cause is clear and local).

## References

- Dispatch 2's hook; `orm/contract/infer.ts`; `control-api/operations/contract-emit.ts`; `test/integration/test/cli-journeys/prisma7-source.e2e.test.ts` and `utils/journey-test-helpers.ts`; `docs/CLI Style Guide.md`; `.agents/rules/cli-error-handling.mdc`, `.agents/rules/cli-e2e-test-patterns.mdc`.
- Public guide phase 4: https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql (read it before writing the README text; project notes may be stale).
- Rules, commits, heartbeat, return shape: as dispatch 1.
