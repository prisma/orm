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

/** The run's statements, without the deletes that answer `subjects`. */
function otherStatements(
  invocation: CliInvocation,
  subjects: readonly string[],
): readonly string[] {
  const answers = subjects.map((text) => statementFlag({ verb: 'delete', text }));
  return (invocation.statementArgs ?? []).filter((flag) => !answers.includes(flag));
}

function enumAndMember(subject: string): { readonly enumName: string; readonly member: string } {
  const dot = subject.lastIndexOf('.');
  return { enumName: subject.slice(0, dot), member: subject.slice(dot + 1) };
}

function listed(words: readonly string[]): string {
  return words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * Two runs of `db update` that keep the data when members keep their names and only their stored values change, which no rename statement can name. The first run renames each member to a temporary member with a stored value the enum does not use, so its rename rewrites the stored values, and the second renames it back with its new stored value the same way. Passing through unused values means no rewrite writes a value another rewrite replaces, so members that swap values are kept too.
 */
function twoRuns(invocation: CliInvocation, subject: string, others: readonly string[]): string {
  const { enumName } = enumAndMember(subject);
  const subjects = [
    subject,
    ...others.filter((other) => enumAndMember(other).enumName === enumName),
  ];
  const members = subjects.map((each) => enumAndMember(each).member);
  const one = members.length === 1;
  const temporary = (member: string) =>
    `${enumName}.<temporary member${one ? '' : ` for ${member}`}>`;
  const emit = quoted(cliCommand(invocation, 'contract emit'));
  const first = cliCommand(invocation, 'db update', [
    ...otherStatements(invocation, subjects),
    ...members.map((member) =>
      statementFlag({ verb: 'rename', text: `${enumName}.${member}:${temporary(member)}` }),
    ),
  ]);
  const second = cliCommand(
    invocation,
    'db update',
    members.map((member) =>
      statementFlag({ verb: 'rename', text: `${temporary(member)}:${enumName}.${member}` }),
    ),
  );
  const names = listed(members);
  return one
    ? `To keep it with db update, change it in two runs. First rename member ${names} of enum ${enumName} in the contract source to a name the enum does not have and give it a stored value the enum does not use, run ${emit}, and run ${quoted(first)}. Then rename that member back to ${names} with its new stored value, run ${emit}, and run ${quoted(second)}.`
    : `To keep it with db update, change them in two runs. First rename members ${names} of enum ${enumName} in the contract source to names the enum does not have and give each a stored value the enum does not use, run ${emit}, and run ${quoted(first)}. Then rename those members back to ${names} with their new stored values, run ${emit}, and run ${quoted(second)}.`;
}

/**
 * How `db update` says to keep the data of a subject: it cannot in one run. It plans the change
 * with `migration plan` from the contract the database is at, when a migration ends there, or
 * changes the stored values in two runs through temporary members; members that swap values do
 * that only when no migration ends there.
 */
export function dbUpdateKeepDataEditAdvice(
  invocation: CliInvocation,
  databaseStorageHash: string | undefined,
): KeepDataEditAdvice {
  return (subject, edits, others): KeepDataAdvice => {
    const deleteFlag = statementFlag({ verb: 'delete', text: subject });
    const swaps = edits.some(({ swapsValues }) => swapsValues === true);
    const lead = swaps
      ? `db update cannot keep that data in one run, because members of the enum swap stored values, and ${deleteFlag} removes it.`
      : `db update cannot keep that data in one run, and ${deleteFlag} removes it.`;
    const runs = twoRuns(invocation, subject, others);
    if (databaseStorageHash === undefined) return { lead, ways: [runs] };
    const deletes = [subject, ...others].map((text) => statementFlag({ verb: 'delete', text }));
    const plan = printedPlanCommand(invocation, databaseStorageHash, [
      ...otherStatements(invocation, [subject]).filter((flag) => !deletes.includes(flag)),
      ...deletes,
    ]);
    return {
      lead,
      ways: [
        `To keep it, plan the change with ${quoted(plan)}, in the migration.ts it writes ${editsText(edits)}, ${runWrittenFile(invocation)}.`,
        ...(swaps ? [] : [runs]),
      ],
    };
  };
}
