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
  const keepData =
    'Change the contract or the migration so it does not lose data. To keep the data, carry it first with a data transform.';
  const keepAccess =
    'Change the contract or the migration so it does not change who can read or write the rows.';

  it('refuses a migration that loses data under data-loss-forbidden the marker records', () => {
    expect(
      errorDataProtectionForbids({
        spaceId: 'app',
        command: 'db migrate',
        refusals: [{ setting: 'dataLoss', source: { kind: 'marker' }, operations: [dropColumn] }],
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
      }).toEnvelope(),
    ).toEqual({
      ok: false,
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      severity: 'error',
      summary:
        'production declares a data protection policy that forbids changing who can read or write rows',
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
      }).toEnvelope(),
    ).toEqual({
      ok: false,
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      severity: 'error',
      summary:
        "This database's data protection policy forbids data loss and changing who can read or write rows",
      why: 'The marker records dataLoss: data-loss-forbidden. Drop column "legacy_name" from "user" (user.legacy_name), in migration 20261118T0900_drop_legacy of contract space "app". production declares accessWidening: access-widening-forbidden. Disable row-level security on "post" (post), in migration 20261118T0900_drop_legacy of contract space "app".',
      fix: `${keepData} ${keepAccess}`,
      nextActions: [
        { kind: 'user-choice', label: keepData },
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
