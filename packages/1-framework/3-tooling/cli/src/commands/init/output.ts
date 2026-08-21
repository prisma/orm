import { type } from 'arktype';

/**
 * arktype schema for the structured success document `init --json` writes
 * to stdout (FR1.5). The same shape backs the human-readable outro
 * renderer (FR10), so the two output modes carry identical information.
 *
 * `target` is normalised to the user-facing flag value (`mongodb` rather
 * than the internal `mongo`) so consumers can round-trip the document
 * straight into a follow-up `--target` invocation.
 *
 * The `ok: true` literal is the documented success/error discriminator —
 * see [Style Guide § JSON Semantics](../../../../../../../docs/CLI%20Style%20Guide.md#json-semantics).
 * Error envelopes (`CliErrorEnvelope`) carry `ok: false` so consumers can
 * branch with `if (doc.ok)` without inspecting the rest of the structure.
 */
export const InitOutputSchema = type({
  ok: 'true',
  target: "'postgres'|'mongodb'",
  authoring: "'psl'|'typescript'",
  schemaPath: 'string',
  filesWritten: 'string[]',
  /**
   * FR9.1 — paths removed from disk during this run: contract artifacts
   * (`contract.json`, `contract.d.ts`, `ops.json`, `migration.json`) an
   * earlier run left behind, which only a re-init has, and the retired
   * agent-skill directories, which every run removes when it finds them.
   */
  filesDeleted: 'string[]',
  /**
   * What became of the dependency install. `skipped` is the deliberate
   * `--skip-install`; `failed` is an install that ran and did not succeed,
   * which leaves a scaffolded project that cannot run yet. `deps` and
   * `devDeps` list what was installed, so both non-`installed` states
   * carry them empty.
   */
  packagesInstalled: {
    status: "'installed'|'skipped'|'failed'",
    deps: 'string[]',
    devDeps: 'string[]',
  },
  contractEmitted: 'boolean',
  nextSteps: 'string[]',
  warnings: 'string[]',
});

export type InitOutput = typeof InitOutputSchema.infer;

/** What became of the dependency install, as the document reports it. */
export type InstallStatus = InitOutput['packagesInstalled']['status'];

/**
 * Serialises the output document for `--json`. Sorted keys are not enforced
 * — `JSON.stringify` preserves insertion order, and the schema field order
 * is the documented order, which matches what users will see when they
 * `jq .` the result.
 */
export function formatInitJson(output: InitOutput): string {
  return JSON.stringify(output, null, 2);
}

/**
 * Builds the `nextSteps` array from the resolved scaffold state. Steps are
 * ordered by the workflow a user needs to follow: install what is missing →
 * configure connection → (emit if not yet done) → run a starter query →
 * docs / agent skill.
 *
 * The strings are stable and human-readable; agents wanting to act on them
 * should match on substrings (e.g. "DATABASE_URL") rather than exact text,
 * since copy may evolve.
 */
export function buildNextSteps(options: {
  readonly target: 'postgres' | 'mongodb';
  /**
   * A project whose dependencies are not installed cannot emit or run,
   * whether the install was skipped or attempted and failed. Both states put
   * the install back at the top of the list, saying which happened.
   */
  readonly packagesInstalled: InstallStatus;
  readonly contractEmitted: boolean;
  readonly emitCommand: string;
  readonly schemaPath: string;
  /**
   * Whether the project-level Prisma Next skill sync actually ran
   * and succeeded during this `init`. When false (the user passed
   * `--skip-skills`, so the sync was skipped), the
   * "registered with your agent runtime" step is omitted — the skip is
   * already surfaced in the warnings array with a manual-install hint.
   */
  readonly skillRegistered: boolean;
}): string[] {
  const steps: string[] = [];
  let stepNumber = 1;
  const push = (text: string): void => {
    steps.push(`${stepNumber}. ${text}`);
    stepNumber += 1;
  };
  if (options.packagesInstalled === 'failed') {
    push(
      'Install the project dependencies with your package manager — the install this run attempted failed, so nothing else here will work yet.',
    );
  }
  if (options.packagesInstalled === 'skipped') {
    push('Install the project dependencies with your package manager (this run skipped them).');
  }
  push('Set DATABASE_URL in your environment (export it or add it to .env).');
  if (!options.contractEmitted) {
    push(`Emit the contract: \`${options.emitCommand}\``);
    push(`Edit your schema at ${options.schemaPath}, then re-run the emit command.`);
  } else {
    push(`Edit your schema at ${options.schemaPath}, then re-run \`${options.emitCommand}\`.`);
  }
  push('Open prisma-next.md for a quick reference on how to write your first typed query.');
  if (options.skillRegistered) {
    push(
      'Prisma Next skills are registered with your agent runtime — open the project in your IDE and ask the agent to add a model, run a query, or plan a migration.',
    );
  }
  return steps;
}
