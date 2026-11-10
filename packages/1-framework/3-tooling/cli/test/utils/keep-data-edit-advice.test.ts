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
        "To keep it with db update, rename member ARCHIVED of enum Status in the contract source to a name the enum does not have, keep its new stored value, run `{bin} contract emit`, and run `{bin} db update --rename Status.OLD:Status.STALE --rename 'Status.ARCHIVED:Status.<new member>'`. Then rename the member back to ARCHIVED, run `{bin} contract emit`, and run `{bin} db update` again.",
      ],
    });
  });

  it('under db update with no migration at the database contract, says plainly how db update keeps the data', () => {
    expect(dbUpdateKeepDataEditAdvice(PROJECT, undefined)('Status.ARCHIVED', edits, [])).toEqual({
      lead: 'db update cannot keep that data in one run, and --delete Status.ARCHIVED removes it.',
      ways: [
        "To keep it with db update, rename member ARCHIVED of enum Status in the contract source to a name the enum does not have, keep its new stored value, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.ARCHIVED:Status.<new member>'`. Then rename the member back to ARCHIVED, run `{bin} contract emit`, and run `{bin} db update` again.",
      ],
    });
  });

  it('under db update, offers no two-run way for members that swap stored values, which a first run refuses as a cycle, and plans every swapped value together', () => {
    const swap = edits.map((edit) => ({ ...edit, swapsValues: true }));

    expect({
      withMigrations: dbUpdateKeepDataEditAdvice(WITH_STATEMENTS, 'sha256:0123')(
        'Status.ARCHIVED',
        swap,
        ['Status.ACTIVE'],
      ),
      withoutMigrations: dbUpdateKeepDataEditAdvice(PROJECT, undefined)('Status.ARCHIVED', swap, [
        'Status.ACTIVE',
      ]),
    }).toEqual({
      withMigrations: {
        lead: 'db update cannot keep that data, because members of the enum swap stored values, and --delete Status.ARCHIVED removes it.',
        ways: [
          `To keep it, plan the change with \`{bin} migration plan --from sha256:0123 --rename Status.OLD:Status.STALE --delete Status.ARCHIVED --delete Status.ACTIVE\`, in the migration.ts it writes ${EDITS_TEXT}, run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`{bin} db migrate\`.`,
        ],
      },
      withoutMigrations: {
        lead: 'db update cannot keep that data, because members of the enum swap stored values, and --delete Status.ARCHIVED removes it. Only a migration can keep it, and no migration ends at the contract the database is at.',
        ways: [],
      },
    });
  });
});
