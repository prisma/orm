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
  /** `prisma7` when an existing Prisma 7 schema is the contract source. */
  authoring: "'psl'|'typescript'|'prisma7'",
  /** The starter schema init wrote, or the Prisma 7 schema it points the config at. */
  schemaPath: 'string',
  filesWritten: 'string[]',
  /**
   * FR9.1 — paths removed from disk during this run: contract artifacts
   * (`contract.json`, `contract.d.ts`, `ops.json`, `migration.json`) an
   * earlier run left behind, which only a re-init has, and the retired
   * agent-skill directories, which every run removes when it finds them.
   */
  filesDeleted: 'string[]',
  /** The Prisma 7 config moved out of Prisma 8's way; empty on a normal run. */
  filesRenamed: type({ from: 'string', to: 'string' }).array(),
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
  /**
   * What the Prisma 7 path did beyond a normal run: the schema adopted, the
   * config renamed (or `null` when it was already `prisma7.config.*`), the
   * `package.json` scripts now invoking `prisma7`, and the Prisma 7 package
   * specs installed or listed to install. `null` on a normal run.
   */
  prisma7: type({
    schemaPath: 'string',
    configRenamedTo: 'string | null',
    scriptsRewritten: 'string[]',
    packagesMoved: 'string[]',
  }).or('null'),
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
  /** Set on the Prisma 7 path: the steps become the transition routine. */
  readonly prisma7: {
    readonly packagesMoved: readonly string[];
    readonly clientMoved: boolean;
  } | null;
}): string[] {
  const steps: string[] = [];
  let stepNumber = 1;
  const push = (text: string): void => {
    steps.push(`${stepNumber}. ${text}`);
    stepNumber += 1;
  };
  if (options.prisma7 !== null) {
    pushPrisma7Steps(push, { ...options, prisma7: options.prisma7 });
    return steps;
  }
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
  push('Open prisma-8.md for a quick reference on how to write your first typed query.');
  push(
    'Working with a coding agent? Run `prisma init` in this project to set up the Prisma agent skills.',
  );
  return steps;
}

/** The install that precedes the Prisma 7 check failed, so nothing was written. */
export const NEXT_STEPS_BEFORE_SCAFFOLD: readonly string[] = [
  '1. Install the project dependencies with your package manager. The install this run attempted failed before anything was written.',
  '2. Run `prisma orm init` again.',
];
export const DB_SIGN_STEP =
  'Adopt your existing database: `prisma db sign` verifies it against the contract and records the signing marker and the `db` ref. It makes no change to the database schema.';
export const PRISMA7_ROUTES_STEP =
  'Move your routes one at a time to the Prisma 8 client in src/prisma/db.ts.';
export const PRISMA7_LOOP_STEP =
  'After each `prisma7 migrate dev`, run `prisma contract emit` and then `prisma db sign`.';
export const PRISMA7_GENERATE_STEP =
  'Run `prisma7 generate` so the Prisma 7 client matches the Prisma 7 CLI.';
export const PRISMA7_QUICK_REFERENCE_STEP =
  'Open prisma-8.md for a quick reference on the transition loop and your first typed query.';
export const AGENT_SKILLS_STEP =
  'Working with a coding agent? Run `prisma init` in this project to set up the Prisma agent skills.';

/**
 * The transition routine, project requirement 7: init set Prisma 8 up beside
 * Prisma 7 and stopped, so every database action here is one the user runs.
 */
function pushPrisma7Steps(
  push: (text: string) => void,
  options: {
    readonly packagesInstalled: InstallStatus;
    readonly contractEmitted: boolean;
    readonly emitCommand: string;
    readonly prisma7: { readonly packagesMoved: readonly string[]; readonly clientMoved: boolean };
  },
): void {
  const moved = options.prisma7.packagesMoved;
  const including = moved.length === 0 ? '' : ` That includes ${moved.join(', ')}.`;
  push('Set DATABASE_URL in your environment (export it or add it to .env).');
  if (options.packagesInstalled === 'failed') {
    push(
      `Install the project dependencies with your package manager — the install this run attempted failed, so nothing else here will work yet.${including}`,
    );
  }
  if (options.packagesInstalled === 'skipped') {
    const listed = moved.length === 0 ? '' : `, including ${moved.join(', ')}`;
    push(
      `Install the project dependencies with your package manager (this run skipped them)${listed}.`,
    );
  }
  if (!options.contractEmitted) {
    push(`Emit the contract: \`${options.emitCommand}\``);
  }
  push(DB_SIGN_STEP);
  push(PRISMA7_ROUTES_STEP);
  push(PRISMA7_LOOP_STEP);
  if (options.prisma7.clientMoved) {
    push(PRISMA7_GENERATE_STEP);
  }
  push(PRISMA7_QUICK_REFERENCE_STEP);
  push(AGENT_SKILLS_STEP);
}
