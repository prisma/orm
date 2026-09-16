# Slice 3: contract-to-PSL printer and `prisma contract convert`

_Parent project: `projects/prisma7-contract-source/`. Linear: to be created. Outcome: a user on a Prisma 7 source runs one command and gets a Prisma 8 `contract.prisma` that produces the identical contract._

## At a glance

```bash
prisma contract convert --output src/prisma/contract.prisma
```

Output begins:

```prisma
// use prisma-8
// Converted from prisma/schema.prisma by `prisma contract convert`.
```

## Chosen design

- **Contract-to-PSL printer.** A new target-descriptor hook beside `inferPslContract`, implemented for Postgres and Mongo, that takes the family contract and returns a `PslDocumentAst`. It emits native enum blocks, namespaces, `temporal.timestamp(p, onCreate: now, onUpdate: now)` for the update-generator pair, explicit `map:` only where Prisma 8's derived name would differ from the contract's, explicit `onDelete`/`onUpdate`, and explicit junction models. Text comes from the existing `printPslFromAst`, which gains no options; the header is prepended by the command.
- **Command** `contract convert` in `packages/1-framework/3-tooling/cli/src/orm/contract/convert.ts`, registered in `family.ts` and `cli.ts`. It requires the configured contract source to be a Prisma 7 source, loads the contract through it, prints, and writes with `publishTextArtifact`. Output path resolution reuses `inferredContractPathFor`. Refusals exit 4 and write nothing.
- **Round trip test.** For every fixture from slices 1 and 2: interpret the Prisma 7 file, convert, interpret the output with the PSL source, compare contract hashes.

## Edge cases

| Case | Disposition |
|---|---|
| Config uses a PSL or TypeScript source | Exit 2 with an error saying convert only applies to a Prisma 7 source. |
| Output file exists | Warn and overwrite, as `contract infer` does. |
| A construct the Prisma 8 PSL cannot spell (none expected after slices 1 and 2) | The printer throws an internal error naming the construct; the round trip test catches it. |

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] Round trip hash equality holds for every fixture from slices 1 and 2.
- [ ] The printed output for the end-to-end fixtures emits with the PSL source and `db verify` reports zero findings.
- [ ] `packages/1-framework/3-tooling/cli/README.md` documents `contract convert`.
- [ ] `--json` output carries the written path.
