import { describe, expect, it } from 'vitest';
import {
  dbUpdateKeepDataEditAdvice,
  migrationPlanKeepDataEditAdvice,
} from '../../src/utils/keep-data-edit-advice';

const PROJECT = { cwd: '/work/app', configPath: undefined, dbGiven: false };
const WITH_STATEMENTS = {
  ...PROJECT,
  statementArgs: ['--rename Status.OLD:Status.STALE', '--delete Status.ARCHIVED'],
};
const edits = [
  {
    remove: 'this.removeStoredValue({ column: "status" })',
    replaceWith: 'this.replaceStoredValue({ column: "status" })',
  },
  {
    remove: 'this.removeStoredValue({ column: "tags" })',
    replaceWith: 'this.replaceStoredValue({ column: "tags" })',
  },
];
const EDITS_TEXT =
  'replace this.removeStoredValue({ column: "status" }) with this.replaceStoredValue({ column: "status" }), and replace this.removeStoredValue({ column: "tags" }) with this.replaceStoredValue({ column: "tags" })';

describe('the advice that keeps the data of a member that keeps its name with a new stored value', () => {
  it('under migration plan, names every edit to make and the command that runs the file', () => {
    expect(migrationPlanKeepDataEditAdvice(PROJECT)('Status.ARCHIVED', edits, [])).toEqual({
      lead: undefined,
      ways: [
        `To keep that data, answer with --delete Status.ARCHIVED, then in the migration.ts this command writes ${EDITS_TEXT}, run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`{bin} db migrate\`.`,
      ],
    });
  });

  it('under db update, leads with planning the change from the database contract, with the run statements', () => {
    expect(
      dbUpdateKeepDataEditAdvice(WITH_STATEMENTS, 'sha256:0123')('Status.ARCHIVED', edits, []),
    ).toEqual({
      lead: 'db update cannot keep that data in one run, and --delete Status.ARCHIVED removes it.',
      ways: [
        `To keep it, plan the change with \`{bin} migration plan --from sha256:0123 --rename Status.OLD:Status.STALE --delete Status.ARCHIVED\`, in the migration.ts it writes ${EDITS_TEXT}, run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`{bin} db migrate\`.`,
        "To keep it with db update, change it in two runs. First rename member ARCHIVED of enum Status in the contract source to a name the enum does not have and give it a stored value the enum does not use, run `{bin} contract emit`, and run `{bin} db update --rename Status.OLD:Status.STALE --rename 'Status.ARCHIVED:Status.<temporary member>'`. Then rename that member back to ARCHIVED with its new stored value, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.<temporary member>:Status.ARCHIVED'`.",
      ],
    });
  });

  it('under db update with no migration at the database contract, says plainly how db update keeps the data', () => {
    expect(dbUpdateKeepDataEditAdvice(PROJECT, undefined)('Status.ARCHIVED', edits, [])).toEqual({
      lead: 'db update cannot keep that data in one run, and --delete Status.ARCHIVED removes it.',
      ways: [
        "To keep it with db update, change it in two runs. First rename member ARCHIVED of enum Status in the contract source to a name the enum does not have and give it a stored value the enum does not use, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.ARCHIVED:Status.<temporary member>'`. Then rename that member back to ARCHIVED with its new stored value, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.<temporary member>:Status.ARCHIVED'`.",
      ],
    });
  });

  it('under db update, plans swapped members from the database contract, or, with no migration there, changes every swapped member of the enum in two runs through stored values the enum does not use', () => {
    const swap = edits.map((edit) => ({ ...edit, swapsValues: true }));
    const runs =
      "To keep it with db update, change them in two runs. First rename members ARCHIVED and ACTIVE of enum Status in the contract source to names the enum does not have and give each a stored value the enum does not use, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.ARCHIVED:Status.<temporary member for ARCHIVED>' --rename 'Status.ACTIVE:Status.<temporary member for ACTIVE>'`. Then rename those members back to ARCHIVED and ACTIVE with their new stored values, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.<temporary member for ARCHIVED>:Status.ARCHIVED' --rename 'Status.<temporary member for ACTIVE>:Status.ACTIVE'`.";
    const lead =
      'db update cannot keep that data in one run, because members of the enum swap stored values, and --delete Status.ARCHIVED removes it.';

    expect({
      withMigrations: dbUpdateKeepDataEditAdvice(WITH_STATEMENTS, 'sha256:0123')(
        'Status.ARCHIVED',
        swap,
        ['Status.ACTIVE', 'Priority.LOW'],
      ),
      withoutMigrations: dbUpdateKeepDataEditAdvice(PROJECT, undefined)('Status.ARCHIVED', swap, [
        'Status.ACTIVE',
        'Priority.LOW',
      ]),
    }).toEqual({
      withMigrations: {
        lead,
        ways: [
          `To keep it, plan the change with \`{bin} migration plan --from sha256:0123 --rename Status.OLD:Status.STALE --delete Status.ARCHIVED --delete Status.ACTIVE --delete Priority.LOW\`, in the migration.ts it writes ${EDITS_TEXT}, run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`{bin} db migrate\`.`,
        ],
      },
      withoutMigrations: { lead, ways: [runs] },
    });
  });
});
