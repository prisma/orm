import type { EnumValueCoordinate, KeepDataEdit } from '@internal/framework-components/control';
import type { MigrationPlanArgument } from '../control-api/operations/plan-arguments';
import type {
  KeepDataAdvice,
  KeepDataEditAdvice,
  KeptSubject,
} from '../control-api/statements/plan-questions';
import { statementFlag } from '../control-api/statements/statement-flag';
import { type CliInvocation, cliCommand, printedPlan, quotedPlan } from './printed-command';
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
  return ({ text, edits }) => ({
    lead: undefined,
    ways:
      edits.length === 0
        ? []
        : [
            `To keep that data, answer with ${statementFlag({ verb: 'delete', text })}, then in the migration.ts this command writes ${editsText(edits)}, ${runWrittenFile(invocation)}.`,
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

function listed(words: readonly string[]): string {
  return words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The members of `kept` in the enum of `subject`, compared by namespace and enum, in the order given. */
function sameEnum(
  subject: EnumValueCoordinate,
  kept: readonly KeptSubject[],
): readonly { readonly member: string; readonly text: string }[] {
  return kept.flatMap(({ subject: each, text }) =>
    each.kind === 'enumValue' &&
    each.namespaceId === subject.namespaceId &&
    each.enum === subject.enum
      ? [{ member: each.member, text }]
      : [],
  );
}

/**
 * Two runs of `db update` that keep the data when members keep their names and only their stored values change, which no rename statement can name. The first run renames each member to a temporary member with a stored value the enum does not use, so its rename rewrites the stored values, and the second renames it back with its final stored value the same way. Passing through unused values means no rewrite writes a value another rewrite replaces, so members that swap values are kept too. `undefined` for a subject that is no enum value.
 */
function twoRuns(
  invocation: CliInvocation,
  subject: KeptSubject,
  kept: readonly KeptSubject[],
): string | undefined {
  if (subject.subject.kind !== 'enumValue') return undefined;
  const enumName = subject.text.slice(0, -(subject.subject.member.length + 1));
  const same = sameEnum(subject.subject, kept);
  const members = same.map(({ member }) => member);
  const subjects = same.map(({ text }) => text);
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
    ? `To keep it with db update, change it in two runs. First rename member ${names} of enum ${enumName} in the contract source to a name the enum does not have and give it a stored value the enum does not use, run ${emit}, and run ${quoted(first)}. Then rename that member back to ${names} with its final stored value, run ${emit}, and run ${quoted(second)}.`
    : `To keep it with db update, change them in two runs. First rename members ${names} of enum ${enumName} in the contract source to names the enum does not have and give each a stored value the enum does not use, run ${emit}, and run ${quoted(first)}. Then rename those members back to ${names} with their final stored values, run ${emit}, and run ${quoted(second)}.`;
}

/**
 * How `db update` says to keep the data of a subject: it cannot in one run. It plans the change with `migration plan` from `origin` when the target gives edits, answering with `--delete` each kept subject whose edits it gives, or changes the stored values in two runs through temporary members; members whose edits swap values do that only when no plan can start where the database is.
 */
export function dbUpdateKeepDataEditAdvice(
  invocation: CliInvocation,
  origin: MigrationPlanArgument,
): KeepDataEditAdvice {
  return (subject, kept): KeepDataAdvice => {
    const deleteFlag = statementFlag({ verb: 'delete', text: subject.text });
    const swaps = subject.edits.some(({ swapsValues }) => swapsValues === true);
    const lead = swaps
      ? `db update cannot keep that data in one run, because members of the enum swap stored values, and ${deleteFlag} removes it.`
      : `db update cannot keep that data in one run, and ${deleteFlag} removes it.`;
    const runs = twoRuns(invocation, subject, kept);
    const runWays = runs === undefined ? [] : [runs];
    const edited = kept.filter(({ edits }) => edits.length > 0);
    if (origin.kind === 'none' && edited.length > 0) {
      return {
        lead,
        ways: [`No migration can be planned to keep it. ${origin.reason}.`, ...runWays],
      };
    }
    if (subject.edits.length === 0) {
      return { lead, ways: runWays };
    }
    const deletes = edited.map(({ text }) => statementFlag({ verb: 'delete', text }));
    const plan = printedPlan(invocation, { from: origin }, [
      ...otherStatements(invocation, [subject.text]).filter((flag) => !deletes.includes(flag)),
      ...deletes,
    ]);
    if (plan.kind === 'none') {
      return {
        lead,
        ways: [`No migration can be planned to keep it. ${plan.reason}.`, ...runWays],
      };
    }
    return {
      lead,
      ways: [
        `To keep it, plan the change with ${quotedPlan(plan)}, in the migration.ts it writes ${editsText(edited.flatMap(({ edits }) => edits))}, ${runWrittenFile(invocation)}.`,
        ...(swaps ? [] : runWays),
      ],
    };
  };
}
