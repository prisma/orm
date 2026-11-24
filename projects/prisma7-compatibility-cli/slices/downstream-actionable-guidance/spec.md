# Slice: downstream-actionable-guidance

_(Parent project `projects/prisma7-compatibility-cli/`. This slice completes the user-actionable Prisma 7 identity below the CLI-owned composition layer.)_

## At a glance

Propagate the selected CLI executable name through `@prisma/migrate`, generator orchestration, and Prisma Client generator diagnostics so commands reached through `prisma7` tell users to run `prisma7`, while ordinary `prisma` output and stable Prisma domain names remain unchanged. This produces the identity-complete unpublished artifact that release integration can consume.

## Chosen design

`packages/cli/src/bin.ts` and `Generate` remain the distribution-identity owners. They pass the already-selected primitive executable name downstream; lower packages do not import `CliDistributionIdentity`, infer from `process.argv`, inspect package layout, or acquire distribution semantics.

Identity-sensitive lower APIs take a required primitive such as `cliCommand: string`:

```ts
MigrateDev.new(identity)
getGenerators({ ..., cliCommand: identity })
getCommandWithExecutor(`${cliCommand} migrate dev`)
```

The standalone migrate entrypoint and ordinary tests pass `'prisma'` explicitly. Migrate command help becomes instance-bound where necessary so usage, examples, unknown-command help, and runtime recovery instructions share the same executable name. Utility error constructors and data-loss guidance receive the primitive at the point where their actionable command is rendered.

Generator orchestration carries the primitive only as far as user-facing diagnostics need it:

- missing-model guidance emitted by `getGenerators` uses the selected executable;
- the built-in Prisma Client generator's missing-`@prisma/client` recovery message tells the user to rerun the selected executable;
- registry construction/configuration conveys the primitive without introducing a CLI dependency or mutating global identity state.

The migration is exhaustive for actionable command/package guidance reachable from `prisma7 migrate`, `prisma7 db`, and `prisma7 generate`. It deliberately does not rename Prisma domain concepts: `Prisma`, `Prisma Migrate`, `schema.prisma`, `prisma.config.ts`, `prisma/`, `.prisma`, `@prisma/client`, `PRISMA_*`, docs URLs, protocols, and engine/runtime paths remain stable. Generated-client runtime diagnostics that execute later without CLI invocation context remain ordinary Prisma guidance rather than receiving ambient identity.

## Coherence rationale

This is one reviewable mechanical fan-out of a single contract: every lower-layer message reachable from the selected CLI invocation renders the primitive executable name supplied by the CLI, with ordinary Prisma as the explicit control. Splitting migrate and generator diagnostics would leave an identity-incomplete artifact between PRs and duplicate the same propagation/audit reasoning.

## Scope

**In:** `packages/cli` construction of migrate/db commands and generator orchestration; `packages/migrate` command help, examples, runtime recovery/errors, and utilities containing actionable executable references; `packages/internals` missing-model generator guidance; the built-in Prisma Client generator/registry path needed to render missing-client recovery guidance; existing ordinary tests updated to pass `'prisma'`; focused dual-identity tests; representative packed `prisma7` command evidence; a final classified literal audit over the named lower packages.

**Out:** release/version rewriting and publication; package-manager acceptance; Prisma 8 behavior beyond preserving the ordinary Prisma control; generated-client runtime errors without CLI invocation context; low-level resolved/nested dependency paths; stable Prisma terminology and file/package names; a shared branding framework, global/env identity channel, or lower-package import from `packages/cli`.

## Pre-investigated edge cases

| Edge case                                                                                | Disposition                                                                          | Notes                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Static migrate help cannot read an instance executable name.                             | Make identity-sensitive help instance-bound or generated from a pure renderer.       | Unknown-command and help-error paths must use the same selected value, not a static fallback. |
| The migrate package has its own executable entrypoint.                                   | Pass `'prisma'` explicitly there.                                                    | Lower packages do not infer a distribution identity.                                          |
| The default generator registry is currently a module-global instance.                    | Convey the executable through an invocation-scoped registry/generator configuration. | Do not mutate a shared registry or use ambient state that can leak between invocations/tests. |
| Prisma Client runtime errors can occur after generation with no originating CLI process. | Keep those out of identity propagation.                                              | This slice changes diagnostics causally emitted by the active CLI/generator invocation only.  |
| Package-manager command formatting wraps complete command strings.                       | Substitute the executable before calling the existing formatter.                     | Preserve npm/pnpm/Yarn/Bun executor detection and argument formatting.                        |

## Slice-specific done conditions

- [ ] A classified production-literal audit finds no unclassified actionable ordinary-`prisma` command/package guidance reachable from `prisma7 migrate`, `prisma7 db`, or `prisma7 generate`, and the packed compatibility scenario proves representative migrate, db, and generator output through the installed `prisma7` executable.

## Open Questions

None.

## References

- Parent project: `projects/prisma7-compatibility-cli/spec.md`
- Project plan: `projects/prisma7-compatibility-cli/plan.md`
- Prior identity seam: `projects/prisma7-compatibility-cli/slices/cli-owned-distribution-identity/spec.md`
- CLI composition: `packages/cli/src/bin.ts`, `packages/cli/src/Generate.ts`
- Migrate composition and guidance: `packages/migrate/src/commands/`, `packages/migrate/src/utils/errors.ts`, `packages/migrate/src/utils/handleEvaluateDataloss.ts`
- Generator diagnostics: `packages/internals/src/get-generators/getGenerators.ts`, `packages/internals/src/utils/missingGeneratorMessage.ts`, `packages/client-generator-registry/src/default.ts`, `packages/client-generator-js/src/resolvePrismaClient.ts`
