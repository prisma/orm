import type { KeepDataEdit } from '@internal/framework-components/control';
import type { MigrationPlanArguments } from '../control-api/operations/plan-arguments';
import type { KeepDataAdvice, KeepDataEditAdvice } from '../control-api/statements/plan-questions';
import { statementFlag } from '../control-api/statements/statement-flag';
import { type CliInvocation, printedWayToTarget, quotedPlan } from './printed-command';
import { runWrittenFile } from './runner-failure-advice';

function editsText(edits: readonly KeepDataEdit[]): string {
  return edits
    .map(({ remove, replaceWith }) => `replace ${remove} with ${replaceWith}`)
    .join(', and ');
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

/**
 * How `db update` says to keep the data of a subject: it cannot in one run. It plans the change with the `migration plan` `migrationPlan` gives, answering with `--delete` each kept subject whose edits the target gives.
 */
export function dbUpdateKeepDataEditAdvice(
  invocation: CliInvocation,
  migrationPlan: MigrationPlanArguments,
): KeepDataEditAdvice {
  const origin = migrationPlan.from;
  return (subject, kept): KeepDataAdvice => {
    const deleteFlag = statementFlag({ verb: 'delete', text: subject.text });
    const lead = `db update cannot keep that data in one run, and ${deleteFlag} removes it.`;
    const edited = kept.filter(({ edits }) => edits.length > 0);
    if (origin.kind === 'none' && edited.length > 0) {
      return {
        lead,
        ways: [`No migration can be planned to keep it. ${origin.reason}.`],
      };
    }
    if (subject.edits.length === 0) {
      return { lead, ways: [] };
    }
    const deletes = edited.map(({ text }) => statementFlag({ verb: 'delete', text }));
    const plan = printedWayToTarget(invocation, migrationPlan, [
      ...otherStatements(invocation, [subject.text]).filter((flag) => !deletes.includes(flag)),
      ...deletes,
    ]);
    if (plan.kind === 'on-disk') {
      return {
        lead,
        ways: [
          `${plan.reason}. To keep it, in the migration.ts of the one that removes it ${editsText(edited.flatMap(({ edits }) => edits))}, run that migration.ts with \`node\`, and apply them with \`${plan.apply}\`.`,
        ],
      };
    }
    if (plan.kind === 'none' || plan.kind === 'at-target') {
      return {
        lead,
        ways: [`No migration can be planned to keep it. ${plan.reason}.`],
      };
    }
    return {
      lead,
      ways: [
        `To keep it, plan the change with ${quotedPlan(plan)}, in the migration.ts it writes ${editsText(edited.flatMap(({ edits }) => edits))}, ${plan.afterPlan}.`,
      ],
    };
  };
}
