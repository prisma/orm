import { describe, expect, it } from 'vitest';
import { errorDataProtectionForbids } from '../../src/utils/policy-errors';
import type { CliInvocation } from '../../src/utils/printed-command';
import { NOT_RECORDED, NOT_RECORDED_REASON, reference } from './plan-origins';

const invocation: CliInvocation = { cwd: '/work/app', configPath: undefined, dbGiven: true };

describe('errorDataProtectionForbids', () => {
  const dropColumn = {
    spaceId: 'app',
    migration: '20261118T0900_drop_legacy',
    operationId: 'column.user.legacy_name.drop',
    subject: 'user.legacy_name',
    label: 'Drop column "legacy_name" from "user"',
  };
  const disableRls = {
    spaceId: 'app',
    migration: '20261118T0900_drop_legacy',
    operationId: 'rowLevelSecurity.public.post.disable',
    subject: 'post',
    label: 'Disable row-level security on "post"',
  };
  const markerCloses =
    'To do it anyway, whoever owns the database must first change its data protection policy.';
  const refCloses =
    'To do it anyway, whoever owns that database must first change the data protection policy production declares.';
  const lossForbidden =
    "This database's data protection policy forbids losing data, so these operations cannot run on it.";
  const keepData = `${lossForbidden} If another database has already applied a migration listed here, keep it as it is. For a migration no database has applied, delete the migration and any later ones no database has applied, and plan again: with --rename if a model or field was only renamed, with --convert if its type changed, or after putting back in the contract what the migration removes. ${markerCloses}`;
  const keepAccess = `production declares a data protection policy that forbids changing who can read or write data, so these operations cannot run on the database it describes. Keep the contract's access rules as they are. ${refCloses}`;
  const keepDataPlanned = `${lossForbidden} If a model or field was only renamed, state the rename with --rename <old>:<new>. Otherwise keep it in the contract. ${markerCloses}`;

  it('refuses a migration that loses data under data-loss-forbidden the marker records', () => {
    expect(
      errorDataProtectionForbids({
        spaceId: 'app',
        command: 'db migrate',
        refusals: [{ setting: 'dataLoss', source: { kind: 'marker' }, operations: [dropColumn] }],
        invocation,
      }).toEnvelope(),
    ).toEqual({
      ok: false,
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      severity: 'error',
      summary: "This database's data protection policy forbids data loss",
      why: 'The marker records dataLoss: data-loss-forbidden. Drop column "legacy_name" from "user" (user.legacy_name), in migration 20261118T0900_drop_legacy of contract space "app".',
      fix: keepData,
      nextActions: [{ kind: 'user-choice', label: keepData }],
      meta: {
        spaceId: 'app',
        command: 'db migrate',
        settings: [{ setting: 'dataLoss', level: 'data-loss-forbidden' }],
        operations: [{ setting: 'dataLoss', ...dropColumn }],
      },
    });
  });

  it('refuses an access change under access-widening-forbidden the ref declares, naming the ref', () => {
    const { migration: _migration, ...planned } = disableRls;
    expect(
      errorDataProtectionForbids({
        spaceId: 'app',
        command: 'migration plan',
        refusals: [
          {
            setting: 'accessWidening',
            source: { kind: 'ref', refName: 'production' },
            operations: [planned],
          },
        ],
        invocation,
      }).toEnvelope(),
    ).toEqual({
      ok: false,
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      severity: 'error',
      summary:
        'production declares a data protection policy that forbids changing who can read or write data',
      why: 'production declares accessWidening: access-widening-forbidden. Disable row-level security on "post" (post), in contract space "app".',
      fix: keepAccess,
      nextActions: [{ kind: 'user-choice', label: keepAccess }],
      meta: {
        spaceId: 'app',
        command: 'migration plan',
        settings: [{ setting: 'accessWidening', level: 'access-widening-forbidden' }],
        operations: [{ setting: 'accessWidening', ...planned }],
      },
    });
  });

  it('tells a db migrate user to keep a migration another database applied, under access-widening-forbidden', () => {
    expect(
      errorDataProtectionForbids({
        spaceId: 'app',
        command: 'db migrate',
        refusals: [
          { setting: 'accessWidening', source: { kind: 'marker' }, operations: [disableRls] },
        ],
        invocation,
      }).toEnvelope().fix,
    ).toBe(
      `This database's data protection policy forbids changing who can read or write data, so these operations cannot run on it. If another database has already applied a migration listed here, keep it as it is. For a migration no database has applied, delete the migration and any later ones no database has applied, put the contract's access rules back as they were, and plan again. ${markerCloses}`,
    );
  });

  it.each([
    [
      'dataLoss',
      dropColumn,
      `production declares a data protection policy that forbids losing data, so these operations cannot run on the database it describes. If another database has already applied a migration listed here, keep it as it is. For a migration no database has applied, delete the migration and any later ones no database has applied, and plan again: with --rename if a model or field was only renamed, with --convert if its type changed, or after putting back in the contract what the migration removes. ${refCloses}`,
    ],
    [
      'accessWidening',
      disableRls,
      `production declares a data protection policy that forbids changing who can read or write data, so these operations cannot run on the database it describes. If another database has already applied a migration listed here, keep it as it is. For a migration no database has applied, delete the migration and any later ones no database has applied, put the contract's access rules back as they were, and plan again. ${refCloses}`,
    ],
  ] as const)(
    'tells a db migrate user what to do when a ref forbids %s',
    (setting, operation, fix) => {
      expect(
        errorDataProtectionForbids({
          spaceId: 'app',
          command: 'db migrate',
          refusals: [
            { setting, source: { kind: 'ref', refName: 'production' }, operations: [operation] },
          ],
          invocation,
        }).toEnvelope().fix,
      ).toBe(fix);
    },
  );

  describe('an operation in an extension contract space', () => {
    const extensionOwns =
      'Contract space "audit" belongs to an extension, so do not edit or delete its migrations; ask the extension\'s author for a version without the operation.';
    const accessForbidden =
      "This database's data protection policy forbids changing who can read or write data, so these operations cannot run on it.";
    const keptApplied =
      'If another database has already applied a migration listed here, keep it as it is.';
    const dropAuditColumn = {
      ...dropColumn,
      spaceId: 'audit',
      migration: '20261001T0800_audit_trim',
      operationId: 'column.audit_entry.detail.drop',
      subject: 'audit_entry.detail',
      label: 'Change the type of column "detail" of "audit_entry"',
      loss: 'typeChange',
    } as const;
    const disableAuditRls = {
      ...disableRls,
      spaceId: 'audit',
      migration: '20261001T0800_audit_trim',
      operationId: 'rowLevelSecurity.public.audit_entry.disable',
      subject: 'audit_entry',
      label: 'Disable row-level security on "audit_entry"',
    };
    const fixOf = (
      command: 'db migrate' | 'db update',
      refusals: Parameters<typeof errorDataProtectionForbids>[0]['refusals'],
    ) =>
      errorDataProtectionForbids({ spaceId: 'app', command, refusals, invocation }).toEnvelope()
        .fix;

    it.each([
      [
        'db migrate',
        'dataLoss',
        dropAuditColumn,
        `${lossForbidden} ${extensionOwns} ${markerCloses}`,
      ],
      [
        'db migrate',
        'accessWidening',
        disableAuditRls,
        `${accessForbidden} ${extensionOwns} ${markerCloses}`,
      ],
      [
        'db update',
        'dataLoss',
        dropAuditColumn,
        `${lossForbidden} ${extensionOwns} ${markerCloses}`,
      ],
      [
        'db update',
        'accessWidening',
        disableAuditRls,
        `${accessForbidden} ${extensionOwns} ${markerCloses}`,
      ],
    ] as const)(
      'tells a %s user not to change it, and gives no advice for the application, under %s',
      (command, setting, operation, fix) => {
        expect(
          fixOf(command, [{ setting, source: { kind: 'marker' }, operations: [operation] }]),
        ).toBe(fix);
      },
    );

    it.each([
      [
        'db migrate',
        'dataLoss',
        dropColumn,
        dropAuditColumn,
        `${lossForbidden} ${keptApplied} For an application migration no database has applied, delete the migration and any later ones no database has applied, and plan again: with --rename if a model or field was only renamed, with --convert if its type changed, or after putting back in the contract what the migration removes. ${extensionOwns} ${markerCloses}`,
      ],
      [
        'db migrate',
        'accessWidening',
        disableRls,
        disableAuditRls,
        `${accessForbidden} ${keptApplied} For an application migration no database has applied, delete the migration and any later ones no database has applied, put the contract's access rules back as they were, and plan again. ${extensionOwns} ${markerCloses}`,
      ],
      [
        'db update',
        'dataLoss',
        dropColumn,
        dropAuditColumn,
        `${lossForbidden} For the application's operations: if a model or field was only renamed, state the rename with --rename <old>:<new>. Otherwise keep it in the contract. ${extensionOwns} ${markerCloses}`,
      ],
      [
        'db update',
        'accessWidening',
        disableRls,
        disableAuditRls,
        `${accessForbidden} For the application's operations, keep the contract's access rules as they are. ${extensionOwns} ${markerCloses}`,
      ],
    ] as const)(
      'gives a %s user advice for the application and for the extension when one setting refuses both, under %s',
      (command, setting, inApp, inExtension, fix) => {
        expect(
          fixOf(command, [
            { setting, source: { kind: 'marker' }, operations: [inApp, inExtension] },
          ]),
        ).toBe(fix);
      },
    );

    it('names every extension contract space that holds a refused operation', () => {
      expect(
        fixOf('db migrate', [
          {
            setting: 'dataLoss',
            source: { kind: 'marker' },
            operations: [dropAuditColumn, { ...dropAuditColumn, spaceId: 'geo' }, dropAuditColumn],
          },
        ]),
      ).toBe(
        `${lossForbidden} Contract spaces "audit" and "geo" belong to extensions, so do not edit or delete their migrations; ask the extensions' authors for versions without the operations. ${markerCloses}`,
      );
    });

    it('advises each setting by where its operations are when one refusal is in the application and the other in an extension', () => {
      expect(
        fixOf('db migrate', [
          { setting: 'dataLoss', source: { kind: 'marker' }, operations: [dropColumn] },
          { setting: 'accessWidening', source: { kind: 'marker' }, operations: [disableAuditRls] },
        ]),
      ).toBe(`${keepData} ${accessForbidden} ${extensionOwns} ${markerCloses}`);
    });
  });

  it('reports both settings in one error when a run breaks both', () => {
    expect(
      errorDataProtectionForbids({
        spaceId: 'app',
        command: 'db update',
        refusals: [
          { setting: 'dataLoss', source: { kind: 'marker' }, operations: [dropColumn] },
          {
            setting: 'accessWidening',
            source: { kind: 'ref', refName: 'production' },
            operations: [disableRls],
          },
        ],
        invocation,
      }).toEnvelope(),
    ).toEqual({
      ok: false,
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      severity: 'error',
      summary:
        "This database's data protection policy forbids data loss and changing who can read or write data",
      why: 'The marker records dataLoss: data-loss-forbidden. Drop column "legacy_name" from "user" (user.legacy_name), in migration 20261118T0900_drop_legacy of contract space "app". production declares accessWidening: access-widening-forbidden. Disable row-level security on "post" (post), in migration 20261118T0900_drop_legacy of contract space "app".',
      fix: `${keepDataPlanned} ${keepAccess}`,
      nextActions: [
        { kind: 'user-choice', label: keepDataPlanned },
        { kind: 'user-choice', label: keepAccess },
      ],
      meta: {
        spaceId: 'app',
        command: 'db update',
        settings: [
          { setting: 'dataLoss', level: 'data-loss-forbidden' },
          { setting: 'accessWidening', level: 'access-widening-forbidden' },
        ],
        operations: [
          { setting: 'dataLoss', ...dropColumn },
          { setting: 'accessWidening', ...disableRls },
        ],
      },
    });
  });
});

describe('errorDataProtectionForbids advice', () => {
  it('advises --convert through migration plan for a type change db update refuses', () => {
    const envelope = errorDataProtectionForbids({
      spaceId: 'app',
      command: 'db update',
      refusals: [
        {
          setting: 'dataLoss',
          source: { kind: 'marker' },
          operations: [
            {
              spaceId: 'app',
              operationId: 'column.user.age.type',
              subject: 'User.age',
              label: 'Change the type of column "age"',
              loss: 'typeChange',
            },
          ],
        },
      ],
      invocation: { ...invocation, configPath: 'app.config.ts' },
      migrationPlan: { from: reference('db'), to: { kind: 'default' } },
    }).toEnvelope();

    expect(envelope.nextActions).toEqual([
      {
        kind: 'user-choice',
        label:
          "This database's data protection policy forbids losing data, so these operations cannot run on it. If a model or field was only renamed, state the rename with --rename <old>:<new>. For a type change, write the conversion with `{bin} migration plan --from db --convert <field> --config app.config.ts`. Otherwise keep it in the contract. To do it anyway, whoever owns the database must first change its data protection policy.",
      },
    ]);
  });

  it('says why a type change cannot be written as a migration when no plan can start where the database is', () => {
    const { fix } = errorDataProtectionForbids({
      spaceId: 'app',
      command: 'db update',
      refusals: [
        {
          setting: 'dataLoss',
          source: { kind: 'marker' },
          operations: [
            {
              spaceId: 'app',
              operationId: 'column.user.age.type',
              subject: 'User.age',
              label: 'Change the type of column "age"',
              loss: 'typeChange',
            },
          ],
        },
      ],
      invocation,
      migrationPlan: { from: NOT_RECORDED, to: { kind: 'default' } },
    });

    expect(fix).toContain(
      `A type change cannot be written as a migration here. ${NOT_RECORDED_REASON}.`,
    );
    expect(fix).not.toContain('migration plan --');
  });

  it.each(['db migrate', 'db update', 'migration plan'] as const)(
    'never offers --permit-policy-change, --delete or --allow from %s',
    (command) => {
      const { fix } = errorDataProtectionForbids({
        spaceId: 'app',
        command,
        refusals: [
          {
            setting: 'dataLoss',
            source: { kind: 'marker' },
            operations: [{ spaceId: 'app', subject: 'User.age', label: 'x', loss: 'typeChange' }],
          },
          {
            setting: 'accessWidening',
            source: { kind: 'marker' },
            operations: [{ spaceId: 'app', subject: 'User', label: 'y' }],
          },
        ],
        invocation,
      }).toEnvelope();

      expect(fix).not.toMatch(/--permit-policy-change|--delete|--allow/);
    },
  );
});
