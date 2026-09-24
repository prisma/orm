# Slice 3: contract-to-PSL printer and `prisma contract print`

_Parent project: `projects/prisma7-contract-source/`. Linear: to be created. Outcome: a user on a Prisma 7 source runs one command and gets a Prisma 8 `contract.prisma` that produces the identical contract. The command is not tied to Prisma 7: it prints the contract of any configured source._

## At a glance

```bash
prisma contract print --output src/prisma/contract.prisma
```

Output begins:

```prisma
// use prisma-8
// Printed from prisma/schema.prisma by `prisma contract print`.
```

## Chosen design

- **Contract-to-PSL printer.** A target-descriptor hook beside `inferPslContract`, implemented for Postgres, that takes the family contract and the configured stack's PSL types and returns a `PslDocumentAst` that reads back as the same contract. Text comes from the existing `printPslFromAst`, which gains a `headerComment` option the command passes; its default leaves `contract infer` output unchanged.
- **Command** `contract print` in `packages/1-framework/3-tooling/cli/src/orm/contract/print.ts`, registered in `family.ts` and `cli.ts`. It loads the contract through whatever source the config names, prints, and writes with `publishTextArtifact`. Output path resolution uses `pslOutputPathFor`, shared with `contract infer`. Refusals exit 2 and write nothing.
- **Round trip test.** For every fixture from slices 1 and 2: interpret the Prisma 7 file, print, interpret the output with the PSL source, compare the serialized contracts and the storage hash.

## Edge cases

| Case | Disposition |
|---|---|
| Output file exists | Warn and overwrite, as `contract infer` does. |
| Output path is a source file the config reads | Exit 2 with `CONTRACT.PRINT_OUTPUT_IS_SOURCE`; nothing is written. |
| Part of the contract PSL cannot carry | Exit 2 with `CONTRACT.PRINT_UNSUPPORTED` naming it; nothing is written. Two Prisma 7 fixtures meet this: one model name in two namespaces. |
| The contract has a default control policy | The PSL file cannot carry it; the result names it so the config sets it on the PSL source. |

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] Round trip hash equality holds for every fixture from slices 1 and 2 that `contract print` can write.
- [ ] The printed output for the end-to-end fixtures emits with the PSL source and `db verify` reports zero findings.
- [ ] `packages/1-framework/3-tooling/cli/README.md` documents `contract print`.
- [ ] `--json` output carries the written path.
