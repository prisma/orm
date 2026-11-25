import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  dbUpdateKeepDataEditAdvice,
  migrationPlanKeepDataEditAdvice,
} from '../../src/utils/keep-data-edit-advice';
import { NOT_RECORDED_REASON, originOf, reference, toEmitted } from './plan-origins';

const member = (name: string, enumName = 'Status', namespace = 'app') => ({
  subject: {
    kind: 'enumValue' as const,
    namespaceId: asNamespaceId(namespace),
    enum: enumName,
    member: name,
  },
  text: `${enumName}.${name}`,
  edits: [],
});
const ARCHIVED = member('ARCHIVED');
const ACTIVE = member('ACTIVE');

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
const EDITED = { ...ARCHIVED, edits };
const EDITS_TEXT =
  'replace this.removeStoredValue({ column: "status" }) with this.replaceStoredValue({ column: "status" }), and replace this.removeStoredValue({ column: "tags" }) with this.replaceStoredValue({ column: "tags" })';

describe('the advice that keeps the data of a member that keeps its name with a new stored value', () => {
  it('under migration plan, names every edit to make and the command that runs the file', () => {
    expect(migrationPlanKeepDataEditAdvice(PROJECT)(EDITED, [EDITED])).toEqual({
      lead: undefined,
      ways: [
        `To keep that data, answer with --delete Status.ARCHIVED, then in the migration.ts this command writes ${EDITS_TEXT}, run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`{bin} db migrate\`.`,
      ],
    });
  });

  it('under db update --to a ref, plans the change to that ref and applies to it', () => {
    const [way] = dbUpdateKeepDataEditAdvice(PROJECT, {
      from: originOf('sha256:0123'),
      to: reference('production'),
    })(EDITED, [EDITED]).ways;

    expect(way).toContain(
      '`{bin} migration plan --from sha256:0123 --to production --delete Status.ARCHIVED`',
    );
    expect(way).toContain('apply it with `{bin} db migrate --to production`');
  });

  it('under db update, leads with planning the change from the database contract, with the run statements', () => {
    expect(
      dbUpdateKeepDataEditAdvice(WITH_STATEMENTS, toEmitted(originOf('sha256:0123')))(EDITED, [
        EDITED,
      ]),
    ).toEqual({
      lead: 'db update cannot keep that data in one run, and --delete Status.ARCHIVED removes it.',
      ways: [
        `To keep it, plan the change with \`{bin} migration plan --from sha256:0123 --rename Status.OLD:Status.STALE --delete Status.ARCHIVED\`, in the migration.ts it writes ${EDITS_TEXT}, run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`{bin} db migrate\`.`,
        "To keep it with db update, change it in two runs. First rename member ARCHIVED of enum Status in the contract source to a name the enum does not have and give it a stored value the enum does not use, run `{bin} contract emit`, and run `{bin} db update --rename Status.OLD:Status.STALE --rename 'Status.ARCHIVED:Status.<temporary member>'`. Then rename that member back to ARCHIVED with its final stored value, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.<temporary member>:Status.ARCHIVED'`.",
      ],
    });
  });

  it('under db update with no migration at the database contract, says plainly how db update keeps the data', () => {
    expect(
      dbUpdateKeepDataEditAdvice(PROJECT, toEmitted(originOf(undefined)))(EDITED, [EDITED]),
    ).toEqual({
      lead: 'db update cannot keep that data in one run, and --delete Status.ARCHIVED removes it.',
      ways: [
        `No migration can be planned to keep it. ${NOT_RECORDED_REASON}.`,
        "To keep it with db update, change it in two runs. First rename member ARCHIVED of enum Status in the contract source to a name the enum does not have and give it a stored value the enum does not use, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.ARCHIVED:Status.<temporary member>'`. Then rename that member back to ARCHIVED with its final stored value, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.<temporary member>:Status.ARCHIVED'`.",
      ],
    });
  });

  it('under db update, plans swapped members from the database contract, or, with no migration there, changes every swapped member of the enum in two runs through stored values the enum does not use', () => {
    const swap = edits.map((edit) => ({ ...edit, swapsValues: true }));
    const swapped = { ...ARCHIVED, edits: swap };
    const kept = [
      swapped,
      {
        ...ACTIVE,
        edits: [{ remove: 'remove active', replaceWith: 'replace active', swapsValues: true }],
      },
      member('LOW', 'Priority'),
    ];
    const runs =
      "To keep it with db update, change them in two runs. First rename members ARCHIVED and ACTIVE of enum Status in the contract source to names the enum does not have and give each a stored value the enum does not use, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.ARCHIVED:Status.<temporary member for ARCHIVED>' --rename 'Status.ACTIVE:Status.<temporary member for ACTIVE>'`. Then rename those members back to ARCHIVED and ACTIVE with their final stored values, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.<temporary member for ARCHIVED>:Status.ARCHIVED' --rename 'Status.<temporary member for ACTIVE>:Status.ACTIVE'`.";
    const lead =
      'db update cannot keep that data in one run, because members of the enum swap stored values, and --delete Status.ARCHIVED removes it.';

    expect({
      withMigrations: dbUpdateKeepDataEditAdvice(
        WITH_STATEMENTS,
        toEmitted(originOf('sha256:0123')),
      )(swapped, kept),
      withoutMigrations: dbUpdateKeepDataEditAdvice(PROJECT, toEmitted(originOf(undefined)))(
        swapped,
        kept,
      ),
    }).toEqual({
      withMigrations: {
        lead,
        ways: [
          `To keep it, plan the change with \`{bin} migration plan --from sha256:0123 --rename Status.OLD:Status.STALE --delete Status.ARCHIVED --delete Status.ACTIVE\`, in the migration.ts it writes ${EDITS_TEXT}, and replace remove active with replace active, run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`{bin} db migrate\`.`,
        ],
      },
      withoutMigrations: {
        lead,
        ways: [`No migration can be planned to keep it. ${NOT_RECORDED_REASON}.`, runs],
      },
    });
  });

  it('under db update, names the members in the order the questions ask about them, whichever member the question is about', () => {
    const kept = [EDITED, { ...ACTIVE, edits }];
    const advice = dbUpdateKeepDataEditAdvice(PROJECT, toEmitted(originOf(undefined)));

    expect(advice(ACTIVE, kept).ways).toEqual(advice(EDITED, kept).ways);
  });

  it('under db update, changes in two runs only the members of the same enum, told apart by namespace and not by printed name', () => {
    const elsewhere = member('ACTIVE', 'Status', 'other');
    expect(
      dbUpdateKeepDataEditAdvice(PROJECT, toEmitted(originOf(undefined)))(ARCHIVED, [
        ARCHIVED,
        elsewhere,
      ]),
    ).toEqual(
      dbUpdateKeepDataEditAdvice(PROJECT, toEmitted(originOf(undefined)))(ARCHIVED, [ARCHIVED]),
    );
  });

  it('with no edit to make, gives only the two db update runs, and nothing under migration plan', () => {
    const runs =
      "To keep it with db update, change it in two runs. First rename member ARCHIVED of enum Status in the contract source to a name the enum does not have and give it a stored value the enum does not use, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.ARCHIVED:Status.<temporary member>'`. Then rename that member back to ARCHIVED with its final stored value, run `{bin} contract emit`, and run `{bin} db update --rename 'Status.<temporary member>:Status.ARCHIVED'`.";
    const lead =
      'db update cannot keep that data in one run, and --delete Status.ARCHIVED removes it.';

    expect({
      dbUpdate: dbUpdateKeepDataEditAdvice(PROJECT, toEmitted(originOf('sha256:0123')))(ARCHIVED, [
        ARCHIVED,
      ]),
      migrationPlan: migrationPlanKeepDataEditAdvice(PROJECT)(ARCHIVED, [ARCHIVED]),
    }).toEqual({
      dbUpdate: { lead, ways: [runs] },
      migrationPlan: { lead: undefined, ways: [] },
    });
  });
});

describe('the plan db update advises for kept members of several enums', () => {
  const lowEdit = { remove: 'removeStoredValue(low)', replaceWith: 'replaceStoredValue(low)' };
  const archivedEdit = {
    remove: 'removeStoredValue(archived)',
    replaceWith: 'replaceStoredValue(archived)',
  };

  it('answers with --delete only the members whose edits it gives, and gives the edits of each', () => {
    const archived = { ...ARCHIVED, edits: [archivedEdit] };
    const low = { ...member('LOW', 'Priority'), edits: [lowEdit] };
    const kept = [archived, { ...ACTIVE, edits: [] }, low];

    expect(
      dbUpdateKeepDataEditAdvice(PROJECT, toEmitted(originOf('sha256:0123')))(archived, kept)
        .ways[0],
    ).toBe(
      'To keep it, plan the change with `{bin} migration plan --from sha256:0123 --delete Status.ARCHIVED --delete Priority.LOW`, in the migration.ts it writes replace removeStoredValue(archived) with replaceStoredValue(archived), and replace removeStoredValue(low) with replaceStoredValue(low), run `node <migration directory>/migration.ts` for the directory it writes, and apply it with `{bin} db migrate`.',
    );
  });
});
