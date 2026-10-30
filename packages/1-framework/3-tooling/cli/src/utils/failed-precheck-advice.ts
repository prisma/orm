import type { FailedPrecheckReport } from '../control-api/types';
import { chooseAction, runCommandAction } from './next-actions';
import { type CliInvocation, cliCommand } from './printed-command';
import type { RunnerAdvice } from './runner-advice';

/** The way out of a failed check before an operation of `db migrate`. */
export function migrateFailedPrecheckAdvice(
  report: FailedPrecheckReport,
  invocation: CliInvocation,
): RunnerAdvice {
  const migrate = `\`${cliCommand(invocation, 'db migrate')}\``;
  if (report.planStartsFromMarker) {
    return [
      chooseAction(
        `If the check is about the rows, as one that no object holds both of two keys is, change the rows that fail it and run ${migrate} again. Otherwise the database has drifted from its migration history: it is not in the state the migrations before this one leave. See how it differs from the contract with \`${cliCommand(invocation, 'db verify')}\`, change the database or the migration so they agree, and run ${migrate} again`,
      ),
    ];
  }
  return [
    runCommandAction(
      `The database has no migration marker, so ${migrate} applies every migration from the first, and the database may already be ahead of this one. If its schema already matches the contract, adopt it instead`,
      cliCommand(invocation, 'db sign'),
    ),
  ];
}

/** The way out of a failed check before an operation of `db init`, which runs only on a database with no marker. */
export function dbInitFailedPrecheckAdvice(invocation: CliInvocation): RunnerAdvice {
  return [
    runCommandAction(
      `The database already holds part of the schema \`${cliCommand(invocation, 'db init')}\` would create. If its schema already matches the contract, adopt it instead`,
      cliCommand(invocation, 'db sign'),
    ),
  ];
}
