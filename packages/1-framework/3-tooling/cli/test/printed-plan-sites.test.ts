import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'pathe';
import { describe, expect, it } from 'vitest';

const TOOLING = join(__dirname, '..', '..');
const SCANNED = [join(TOOLING, 'cli', 'src'), join(TOOLING, 'migration', 'src')];
const PRINTED_PLAN = /(\{bin\}|prisma) migration plan|cliCommand\([^,]+,\s*'migration plan'/;

/**
 * The places that print a `migration plan` without asking the rule in `plan-arguments.ts`, each with
 * what makes the printed command resolve. A new place fails this test: route it through
 * `printedPlan`, or add it here with the reason it runs.
 */
const ALLOWED: readonly {
  readonly file: string;
  readonly text: string;
  readonly reason: string;
}[] = [
  {
    file: 'cli/src/utils/printed-command.ts',
    text: "cliCommand(invocation, 'migration plan', [...argumentWords('--from', from)",
    reason: 'The rule printer: it prints only a reference or the default the rule derived.',
  },
  {
    file: 'cli/src/utils/printed-command.ts',
    text: "cliCommand(invocation, 'migration plan', ['--from', CONTRACT_PLACEHOLDER",
    reason: 'A choice the rule derived, printed as a user-choice, never as a command to run.',
  },
  {
    file: 'cli/src/utils/cli-errors.ts',
    text: "'Run `{bin} migration plan` first.'",
    reason:
      'errorRefSetHashNotInGraph with no graph nodes: on an empty graph `migration plan` plans from the empty database or baselines the db ref.',
  },
  {
    file: 'cli/src/utils/cli-errors.ts',
    text: "runCommandAction('Plan the first migration', '{bin} migration plan')",
    reason: 'errorRefSetHashNotInGraph with no graph nodes, as above.',
  },
  {
    file: 'cli/src/utils/cli-errors.ts',
    text: "'Run `{bin} migration plan` to create a migration first.'",
    reason:
      'errorNoMigrations, raised by `migration show` only when the app space has no packages.',
  },
  {
    file: 'cli/src/utils/cli-errors.ts',
    text: "runCommandAction('Create the first migration', '{bin} migration plan')",
    reason: 'errorNoMigrations, as above.',
  },
  {
    file: 'cli/src/utils/cli-errors.ts',
    text: '`{bin} migration plan --from ${ref.name}`',
    reason:
      'Refs from getReachableRefs, which keeps only refs whose contract is a graph node, so `--from <ref>` resolves.',
  },
  {
    file: 'cli/src/utils/cli-errors.ts',
    text: '`Or pass the origin explicitly: \\`{bin} migration plan ${fromSuggestion}\\`.`',
    reason: 'Printed only when reachable refs exist; fromSuggestion names them, as above.',
  },
  {
    file: 'cli/src/utils/cli-errors.ts',
    text: "'{bin} migration plan --from @empty'",
    reason: '`--from @empty` always resolves, to an empty database.',
  },
  {
    file: 'cli/src/control-api/operations/migration-new.ts',
    text: "'Run `{bin} migration plan` first:",
    reason:
      'Printed only for `ref-needs-baseline`, an empty graph with a db ref, where `migration plan` baselines the ref.',
  },
];

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const printedLines = SCANNED.flatMap(sourceFiles).flatMap((path) =>
  readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => PRINTED_PLAN.test(line) && !/^\s*(\*|\/\/)/.test(line))
    .map((line) => ({ file: relative(TOOLING, path), line })),
);

describe('every printed migration plan goes through the rule or states why it runs', () => {
  it('finds no printed migration plan outside the allowed places', () => {
    const outside = printedLines.filter(
      ({ file, line }) =>
        !ALLOWED.some((allowed) => allowed.file === file && line.includes(allowed.text)),
    );
    expect(outside).toEqual([]);
  });

  it('finds each allowed place, so the list stays true', () => {
    const missing = ALLOWED.filter(
      (allowed) =>
        !printedLines.some(
          ({ file, line }) => file === allowed.file && line.includes(allowed.text),
        ),
    );
    expect(missing).toEqual([]);
  });
});
