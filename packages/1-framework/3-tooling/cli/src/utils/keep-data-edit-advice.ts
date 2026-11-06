import type { KeepDataEdit } from '@internal/framework-components/control';
import type { KeepDataAdvice, KeepDataEditAdvice } from '../control-api/statements/plan-questions';
import { statementFlag } from '../control-api/statements/statement-flag';
import { type CliInvocation, cliCommand, printedPlanCommand } from './printed-command';
import { runWrittenFile } from './runner-failure-advice';

function editsText(edits: readonly KeepDataEdit[]): string {
  return edits
    .map(({ remove, replaceWith }) => `replace ${remove} with ${replaceWith}`)
    .join(', and ');
}

function quoted(command: string): string {
  return `\`${command}\``;
}

/** How `migration plan` says to keep the data of a subject: answer with a delete, then make the edits in the file it writes. */
export function migrationPlanKeepDataEditAdvice(invocation: CliInvocation): KeepDataEditAdvice {
  return (subject, edits) => ({
    lead: undefined,
    ways: [
      `To keep that data, answer with ${statementFlag({ verb: 'delete', text: subject })}, then in the migration.ts this command writes ${editsText(edits)}, ${runWrittenFile(invocation)}.`,
    ],
  });
}

/** The run's statements, without the delete that answers `subject`. */
function otherStatements(invocation: CliInvocation, subject: string): readonly string[] {
  const answer = statementFlag({ verb: 'delete', text: subject });
  return (invocation.statementArgs ?? []).filter((flag) => flag !== answer);
}

/** Two runs of `db update`: one renames the member to a new member with the new stored value, and the next renames it back. */
function twoRuns(invocation: CliInvocation, subject: string): string {
  const dot = subject.lastIndexOf('.');
  const enumName = subject.slice(0, dot);
  const member = subject.slice(dot + 1);
  const emit = quoted(cliCommand(invocation, 'contract emit'));
  const rename = statementFlag({ verb: 'rename', text: `${subject}:${enumName}.<new member>` });
  const first = cliCommand(invocation, 'db update', [
    ...otherStatements(invocation, subject),
    rename,
  ]);
  return `To keep it with db update, rename member ${member} of enum ${enumName} in the contract source to a name the enum does not have, keep its new stored value, run ${emit}, and run ${quoted(first)}. Then rename the member back to ${member}, run ${emit}, and run ${quoted(cliCommand(invocation, 'db update'))} again.`;
}

/**
 * How `db update` says to keep the data of a subject: it cannot in one run. It plans the change
 * with `migration plan` from the contract the database is at, when a migration ends there, or
 * renames the member to a new member and back in two runs.
 */
export function dbUpdateKeepDataEditAdvice(
  invocation: CliInvocation,
  databaseStorageHash: string | undefined,
): KeepDataEditAdvice {
  return (subject, edits, others): KeepDataAdvice => {
    const deleteFlag = statementFlag({ verb: 'delete', text: subject });
    const swaps = edits.some(({ swapsValues }) => swapsValues === true);
    const lead = swaps
      ? `db update cannot keep that data, because members of the enum swap stored values, and ${deleteFlag} removes it.`
      : `db update cannot keep that data in one run, and ${deleteFlag} removes it.`;
    if (databaseStorageHash === undefined) {
      return swaps
        ? {
            lead: `${lead} Only a migration can keep it, and no migration ends at the contract the database is at.`,
            ways: [],
          }
        : { lead, ways: [twoRuns(invocation, subject)] };
    }
    const deletes = [subject, ...others].map((text) => statementFlag({ verb: 'delete', text }));
    const plan = printedPlanCommand(invocation, databaseStorageHash, [
      ...otherStatements(invocation, subject).filter((flag) => !deletes.includes(flag)),
      ...deletes,
    ]);
    return {
      lead,
      ways: [
        `To keep it, plan the change with ${quoted(plan)}, in the migration.ts it writes ${editsText(edits)}, ${runWrittenFile(invocation)}.`,
        ...(swaps ? [] : [twoRuns(invocation, subject)]),
      ],
    };
  };
}
