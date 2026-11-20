import { describe, expect, it } from 'vitest';
import {
  errorChangePolicyForbids,
  errorDataProtectionForbids,
  errorPolicyMismatch,
} from '../../src/utils/policy-errors';
import type { CliInvocation } from '../../src/utils/printed-command';

const TARGET = 'b'.repeat(64);
const invocation: CliInvocation = { cwd: '/work/app', configPath: undefined, dbGiven: true };

describe('errorPolicyMismatch', () => {
  it('names each differing setting the ref declares, and the two ways to make them agree', () => {
    const differences = [
      {
        setting: 'change',
        declared: ['migrate'],
        inForce: ['migrate', 'reconcile'],
      },
      {
        setting: 'dataProtection.dataLoss',
        declared: 'data-loss-forbidden',
        inForce: 'data-loss-with-consent',
      },
    ] as const;
    const recovery =
      "Make the ref match the database, or have whoever owns the database apply the ref's policies.";

    expect(
      errorPolicyMismatch({ spaceId: 'app', refName: 'production', differences }).toEnvelope(),
    ).toEqual({
      ok: false,
      code: 'MIGRATION.POLICY_MISMATCH',
      severity: 'error',
      summary: "The ref's policies differ from the database's",
      why: 'production declares change: migrate; the database has change: migrate, reconcile. production declares dataProtection.dataLoss: data-loss-forbidden; the database has dataProtection.dataLoss: data-loss-with-consent.',
      fix: recovery,
      nextActions: [{ kind: 'user-choice', label: recovery }],
      meta: { spaceId: 'app', refName: 'production', differences },
    });
  });
});

describe('errorChangePolicyForbids', () => {
  it('refuses db update on a database that changes only through migrations', () => {
    const recovery =
      'Author a migration with {bin} migration plan, then apply it with {bin} db migrate --db <url>.';

    expect(
      errorChangePolicyForbids({
        spaceId: 'app',
        command: 'db update',
        change: ['migrate'],
        source: { kind: 'marker' },
        targetHash: TARGET,
        invocation,
      }).toEnvelope(),
    ).toEqual({
      ok: false,
      code: 'MIGRATION.CHANGE_POLICY_FORBIDS',
      severity: 'error',
      summary: "This database's change policy permits only migrations",
      why: 'The marker records change: migrate, so db update may not move it.',
      fix: recovery,
      nextActions: [{ kind: 'user-choice', label: recovery }],
      meta: { spaceId: 'app', command: 'db update', change: ['migrate'] },
    });
  });

  it('refuses db sign the same way', () => {
    expect(
      errorChangePolicyForbids({
        spaceId: 'app',
        command: 'db sign',
        change: ['migrate'],
        source: { kind: 'marker' },
        targetHash: TARGET,
        invocation,
      }).toEnvelope(),
    ).toMatchObject({
      summary: "This database's change policy permits only migrations",
      why: 'The marker records change: migrate, so db sign may not sign it.',
      meta: { spaceId: 'app', command: 'db sign', change: ['migrate'] },
    });
  });

  it('refuses db migrate on a database that changes only through db update, and gives the command', () => {
    const reconcile = `{bin} db update --to ${TARGET} --db <url>`;

    expect(
      errorChangePolicyForbids({
        spaceId: 'app',
        command: 'db migrate',
        change: ['reconcile'],
        source: { kind: 'marker' },
        targetHash: TARGET,
        invocation,
      }).toEnvelope(),
    ).toEqual({
      ok: false,
      code: 'MIGRATION.CHANGE_POLICY_FORBIDS',
      severity: 'error',
      summary: "This database's change policy permits only db update",
      why: 'The marker records change: reconcile, so db migrate may not move it.',
      fix: `Reconcile the database: ${reconcile}`,
      nextActions: [{ kind: 'run-command', label: 'Reconcile the database', command: reconcile }],
      meta: { spaceId: 'app', command: 'db migrate', change: ['reconcile'] },
    });
  });

  it("names the ref when db update is refused by the ref's declaration, and applies the migration to the ref with the flag the user gave", () => {
    const recovery =
      'Author a migration with {bin} migration plan --config app.config.ts, then apply it with {bin} db migrate --to production --permit-policy-change --config app.config.ts --db <url>.';

    expect(
      errorChangePolicyForbids({
        spaceId: 'app',
        command: 'db update',
        change: ['migrate'],
        source: { kind: 'ref', refName: 'production' },
        targetHash: TARGET,
        invocation: { ...invocation, configPath: 'app.config.ts' },
      }).toEnvelope(),
    ).toEqual({
      ok: false,
      code: 'MIGRATION.CHANGE_POLICY_FORBIDS',
      severity: 'error',
      summary: 'production declares a change policy that permits only migrations',
      why: 'production declares change: migrate, so db update may not move it.',
      fix: recovery,
      nextActions: [{ kind: 'user-choice', label: recovery }],
      meta: { spaceId: 'app', command: 'db update', change: ['migrate'] },
    });
  });

  it("names the ref when db migrate is refused by the ref's declaration, and reconciles to the ref with the flag the user gave", () => {
    const reconcile =
      '{bin} db update --to production --permit-policy-change --config app.config.ts --db <url>';

    expect(
      errorChangePolicyForbids({
        spaceId: 'app',
        command: 'db migrate',
        change: ['reconcile'],
        source: { kind: 'ref', refName: 'production' },
        targetHash: TARGET,
        invocation: { ...invocation, configPath: 'app.config.ts' },
      }).toEnvelope(),
    ).toEqual({
      ok: false,
      code: 'MIGRATION.CHANGE_POLICY_FORBIDS',
      severity: 'error',
      summary: 'production declares a change policy that permits only db update',
      why: 'production declares change: reconcile, so db migrate may not move it.',
      fix: `Reconcile the database: ${reconcile}`,
      nextActions: [{ kind: 'run-command', label: 'Reconcile the database', command: reconcile }],
      meta: { spaceId: 'app', command: 'db migrate', change: ['reconcile'] },
    });
  });

  it.each([
    {
      permitPolicyChange: true,
      reconcile: '{bin} db update --to production --permit-policy-change --db <url>',
    },
    { permitPolicyChange: false, reconcile: '{bin} db update --to production --db <url>' },
  ])(
    "names the ref the user gave when the marker's policy refuses db migrate, repeating --permit-policy-change only when given: $permitPolicyChange",
    ({ permitPolicyChange, reconcile }) => {
      expect(
        errorChangePolicyForbids({
          spaceId: 'app',
          command: 'db migrate',
          change: ['reconcile'],
          source: { kind: 'marker' },
          targetHash: TARGET,
          ref: { name: 'production', permitPolicyChange },
          invocation,
        }).toEnvelope(),
      ).toMatchObject({
        summary: "This database's change policy permits only db update",
        why: 'The marker records change: reconcile, so db migrate may not move it.',
        fix: `Reconcile the database: ${reconcile}`,
        nextActions: [{ kind: 'run-command', label: 'Reconcile the database', command: reconcile }],
      });
    },
  );

  it("names the ref the user gave when the marker's policy refuses db update", () => {
    const recovery =
      'Author a migration with {bin} migration plan, then apply it with {bin} db migrate --to production --db <url>.';

    expect(
      errorChangePolicyForbids({
        spaceId: 'app',
        command: 'db update',
        change: ['migrate'],
        source: { kind: 'marker' },
        targetHash: TARGET,
        ref: { name: 'production', permitPolicyChange: false },
        invocation,
      }).toEnvelope(),
    ).toMatchObject({ fix: recovery, nextActions: [{ kind: 'user-choice', label: recovery }] });
  });
});

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
  const keepData = `${lossForbidden} If another database has already applied a migration listed here, keep it as it is. For a migration no database has applied: if a model or field was only renamed or its type changed, delete the migration and plan it again with --rename or --convert; otherwise remove the operation from the migration. ${markerCloses}`;
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
      `This database's data protection policy forbids changing who can read or write data, so these operations cannot run on it. If another database has already applied a migration listed here, keep it as it is. For a migration no database has applied, remove the operation from the migration. ${markerCloses}`,
    );
  });

  it.each([
    [
      'dataLoss',
      dropColumn,
      `production declares a data protection policy that forbids losing data, so these operations cannot run on the database it describes. If another database has already applied a migration listed here, keep it as it is. For a migration no database has applied: if a model or field was only renamed or its type changed, delete the migration and plan it again with --rename or --convert; otherwise remove the operation from the migration. ${refCloses}`,
    ],
    [
      'accessWidening',
      disableRls,
      `production declares a data protection policy that forbids changing who can read or write data, so these operations cannot run on the database it describes. If another database has already applied a migration listed here, keep it as it is. For a migration no database has applied, remove the operation from the migration. ${refCloses}`,
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

  describe('a migration in an extension contract space', () => {
    const extensionOwns =
      "A migration in an extension's contract space belongs to that extension, so do not edit or delete it; ask the extension's author for a version without the operation.";
    const dropAuditColumn = {
      ...dropColumn,
      spaceId: 'audit',
      migration: '20261001T0800_audit_trim',
      operationId: 'column.audit_entry.detail.drop',
      subject: 'audit_entry.detail',
      label: 'Drop column "detail" from "audit_entry"',
    };
    const disableAuditRls = {
      ...disableRls,
      spaceId: 'audit',
      migration: '20261001T0800_audit_trim',
      operationId: 'rowLevelSecurity.public.audit_entry.disable',
      subject: 'audit_entry',
      label: 'Disable row-level security on "audit_entry"',
    };

    it.each([
      ['dataLoss', dropAuditColumn, `${lossForbidden} ${extensionOwns} ${markerCloses}`],
      [
        'accessWidening',
        disableAuditRls,
        `This database's data protection policy forbids changing who can read or write data, so these operations cannot run on it. ${extensionOwns} ${markerCloses}`,
      ],
    ] as const)(
      'tells a db migrate user not to change it, and leaves out the advice for application migrations, under %s',
      (setting, operation, fix) => {
        expect(
          errorDataProtectionForbids({
            spaceId: 'app',
            command: 'db migrate',
            refusals: [{ setting, source: { kind: 'marker' }, operations: [operation] }],
            invocation,
          }).toEnvelope(),
        ).toMatchObject({ fix, nextActions: [{ kind: 'user-choice', label: fix }] });
      },
    );

    it('gives the advice for application migrations and for extension migrations when a refusal holds both', () => {
      const fix = `${lossForbidden} If another database has already applied a migration listed here, keep it as it is. For a migration no database has applied: if a model or field was only renamed or its type changed, delete the migration and plan it again with --rename or --convert; otherwise remove the operation from the migration. ${extensionOwns} ${markerCloses}`;

      expect(
        errorDataProtectionForbids({
          spaceId: 'app',
          command: 'db migrate',
          refusals: [
            {
              setting: 'dataLoss',
              source: { kind: 'marker' },
              operations: [dropColumn, dropAuditColumn],
            },
          ],
          invocation,
        }).toEnvelope(),
      ).toMatchObject({ fix, nextActions: [{ kind: 'user-choice', label: fix }] });
    });

    it('advises each setting by where its operations are when one refusal is in the application and the other in an extension', () => {
      const keepExtensionAccess = `This database's data protection policy forbids changing who can read or write data, so these operations cannot run on it. ${extensionOwns} ${markerCloses}`;

      expect(
        errorDataProtectionForbids({
          spaceId: 'app',
          command: 'db migrate',
          refusals: [
            { setting: 'dataLoss', source: { kind: 'marker' }, operations: [dropColumn] },
            {
              setting: 'accessWidening',
              source: { kind: 'marker' },
              operations: [disableAuditRls],
            },
          ],
          invocation,
        }).toEnvelope().fix,
      ).toBe(`${keepData} ${keepExtensionAccess}`);
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
    }).toEnvelope();

    expect(envelope.nextActions).toEqual([
      {
        kind: 'user-choice',
        label:
          "This database's data protection policy forbids losing data, so these operations cannot run on it. If a model or field was only renamed, state the rename with --rename <old>:<new>. For a type change, write the conversion with {bin} migration plan --convert <field> --config app.config.ts. Otherwise keep it in the contract. To do it anyway, whoever owns the database must first change its data protection policy.",
      },
    ]);
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
