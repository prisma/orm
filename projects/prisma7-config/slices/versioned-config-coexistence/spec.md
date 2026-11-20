# Slice: versioned-config-coexistence

_(Parent project `projects/prisma7-config/`. This slice gives Prisma 7 an independent automatic config namespace while preserving legacy projects.)_

## At a glance

Teach the shared Prisma 7 implementation to prefer `prisma7.config.*` and `.config/prisma7.*`, then fall back to existing config discovery only when that family is absent. Land the runtime contract together with bootstrap recognition, `prisma7.config.ts` generation, user-facing guidance, and dual-entrypoint proof.

## Chosen design

`@prisma/config` owns one deterministic automatic-discovery policy:

```text
explicit --config
  └─ exact requested path

automatic discovery
  ├─ prisma7.config.{js,ts,mjs,cjs,mts,cts}
  ├─ .config/prisma7.{js,ts,mjs,cjs,mts,cts}
  └─ existing prisma.config.* / .config/prisma.* discovery
```

The existing supported-extension order is preserved within each location. Automatic discovery distinguishes “no Prisma 7 candidate exists” from “the selected Prisma 7 candidate failed”: only absence enters legacy discovery. Load, import, syntax, default-export, and config-shape failures retain the selected Prisma 7 path in diagnostics and terminate the command.

Candidate ordering has a single lower-layer definition for supported JavaScript/TypeScript files. Runtime loading consumes the versioned selection, while bootstrap uses a non-executing selection path so project-state and seed inspection identify the same effective supported config without importing arbitrary project code. Legacy JSON, JSONC, JSON5, YAML, YML, and TOML candidates are not added to bootstrap. Existing package.json seed precedence remains unchanged.

Both executable identities in this branch use this policy without identity branching. `Init` always writes `prisma7.config.ts`, retaining its existing identity-specific import (`prisma/config` or `@prisma/prisma7/config`). Shared completion and concrete default-path guidance switch to `prisma7.config.ts`; generic “Prisma config file” language and stable Prisma domain terminology remain generic.

The existing legacy loaded-file diagnostic remains the only output when fallback selects `prisma.config.*`; no warning or deprecation message is introduced.

## Coherence rationale

This is one reviewable compatibility contract: discovery, non-executing detection, generated files, guidance, and installed behavior must agree on one filename namespace. Splitting these surfaces would create an intermediate PR that either generates an undiscoverable file or silently supports a convention the CLI does not teach.

## Scope

**In:** `@prisma/config` automatic candidate selection, selected-file error attribution, and relative-path regressions; bootstrap config presence and seed selection; init file creation and output; shared completion values; concrete CLI, migrate, and internals default-config examples or actionable messages; affected fixtures and snapshots; focused config/CLI tests; packed Prisma 7 compatibility coverage proving both entrypoints share the policy.

**Out:** Prisma 8 config parsing or package behavior; config-content conversion; non-executing bootstrap support for legacy JSON/JSONC/JSON5/YAML/YML/TOML configs; warnings or deprecation; explicit `--config` redesign; schema or directory renames; unrelated prose that uses “Prisma config file” generically; comments and test-only paths that do not teach a user-facing default unless touching them is needed to keep their contract accurate.

## Pre-investigated edge cases

| Edge case                                                                   | Disposition                                  | Notes                                                                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Both config families exist.                                                 | Select the Prisma 7 family.                  | The complete versioned family precedes every legacy candidate.                                                  |
| The selected Prisma 7 config is invalid while a valid legacy config exists. | Hard-fail the Prisma 7 error.                | Falling through could load Prisma 8's incompatible contract.                                                    |
| No Prisma 7 config exists.                                                  | Preserve legacy behavior silently.           | No new warning beyond the existing loaded-file diagnostic.                                                      |
| A config lives under `.config/`.                                            | Support both versioned and legacy locations. | Root versioned candidates precede `.config/prisma7.*`; the complete versioned family precedes legacy discovery. |
| The user supplies `--config`.                                               | Load only the explicit path.                 | Filename and family precedence do not apply.                                                                    |
| Commands are invoked through `prisma` rather than `prisma7`.                | Use the same Prisma 7 policy.                | Both entrypoints in this branch intentionally remain identical.                                                 |

## Slice-specific done conditions

- [ ] A classified audit of production `prisma.config.ts` literals leaves no stale concrete Prisma 7 default-path guidance, while recording generic/domain references that intentionally remain unchanged.
- [ ] Packed or equivalent installed-command evidence proves versioned precedence, hard-failure behavior, and legacy fallback through the Prisma 7 entrypoints rather than only through loader unit tests.

## Open Questions

None.

## References

- Parent project: [`../../spec.md`](../../spec.md)
- Project plan: [`../../plan.md`](../../plan.md)
- Design notes: [`../../design-notes.md`](../../design-notes.md)
- Linear issue: N/A
- Config loader: `packages/config/src/loadConfigFromFile.ts`
- Bootstrap state: `packages/cli/src/bootstrap/project-state.ts`
- Initialization: `packages/cli/src/Init.ts`
- Completion defaults: `packages/internals/src/cli/completion-values.ts`
- Packed compatibility scenario: `packages/client/tests/e2e/prisma7-compatibility/`
