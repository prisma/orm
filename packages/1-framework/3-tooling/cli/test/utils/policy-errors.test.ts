import { describe, expect, it } from 'vitest';
import { errorChangePolicyForbids, errorPolicyMismatch } from '../../src/utils/policy-errors';
import type { CliInvocation } from '../../src/utils/printed-command';
import { NOT_RECORDED, NOT_RECORDED_REASON, reference } from './plan-origins';

const TARGET = 'b'.repeat(64);
const invocation: CliInvocation = { cwd: '/work/app', configPath: undefined, dbGiven: true };

describe('errorPolicyMismatch', () => {
  const APPLY = "Have whoever owns the database apply the ref's policies in a deploy.";
  const MATCH = 'Make the ref declare what the database has, and have the change reviewed.';

  function advice(differences: Parameters<typeof errorPolicyMismatch>[0]['differences']) {
    const { fix, nextActions } = errorPolicyMismatch({
      spaceId: 'app',
      refName: 'production',
      differences,
    }).toEnvelope();
    return { fix, nextActions };
  }

  it('names each differing setting the ref declares, and for a stricter ref advises applying it', () => {
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

    expect(
      errorPolicyMismatch({ spaceId: 'app', refName: 'production', differences }).toEnvelope(),
    ).toEqual({
      ok: false,
      code: 'MIGRATION.POLICY_MISMATCH',
      severity: 'error',
      summary: "The ref's policies differ from the database's",
      why: 'production declares change: migrate; the database has change: migrate, reconcile. production declares dataProtection.dataLoss: data-loss-forbidden; the database has dataProtection.dataLoss: data-loss-with-consent.',
      fix: APPLY,
      nextActions: [{ kind: 'user-choice', label: APPLY }],
      meta: { spaceId: 'app', refName: 'production', differences },
    });
  });

  it('advises a looser ref to declare what the database has, never to loosen the database', () => {
    expect(
      advice([
        {
          setting: 'dataProtection.accessWidening',
          declared: 'access-widening-permitted',
          inForce: 'access-widening-forbidden',
        },
      ]),
    ).toEqual({ fix: MATCH, nextActions: [{ kind: 'user-choice', label: MATCH }] });
  });

  it('advises a ref that permits more change strategies to declare what the database has', () => {
    expect(
      advice([{ setting: 'change', declared: ['migrate', 'reconcile'], inForce: ['migrate'] }]),
    ).toEqual({ fix: MATCH, nextActions: [{ kind: 'user-choice', label: MATCH }] });
  });

  it('advises applying the ref when matching the database would loosen the ref too', () => {
    expect(advice([{ setting: 'change', declared: ['reconcile'], inForce: ['migrate'] }])).toEqual({
      fix: APPLY,
      nextActions: [{ kind: 'user-choice', label: APPLY }],
    });
  });

  it('gives both sentences, each naming its settings, when the ref is looser in one and stricter in another', () => {
    const match = `For dataProtection.dataLoss: ${MATCH}`;
    const apply = `For change: ${APPLY}`;

    expect(
      advice([
        { setting: 'change', declared: ['migrate'], inForce: ['migrate', 'reconcile'] },
        {
          setting: 'dataProtection.dataLoss',
          declared: 'data-loss-permitted',
          inForce: 'data-loss-with-consent',
        },
      ]),
    ).toEqual({
      fix: `${match} ${apply}`,
      nextActions: [
        { kind: 'user-choice', label: match },
        { kind: 'user-choice', label: apply },
      ],
    });
  });
});

describe('errorChangePolicyForbids', () => {
  it('says why no migration can be authored when no plan can start where the database is', () => {
    expect(
      errorChangePolicyForbids({
        spaceId: 'app',
        command: 'db update',
        change: ['migrate'],
        source: { kind: 'marker' },
        targetHash: TARGET,
        migrationPlan: { from: NOT_RECORDED, to: { kind: 'default' } },
        invocation: undefined,
      }).fix,
    ).toBe(`No migration can be planned to move it. ${NOT_RECORDED_REASON}.`);
  });

  it('refuses db update on a database that changes only through migrations', () => {
    const recovery = `Author a migration with \`{bin} migration plan --from ${TARGET}\`, run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`{bin} db migrate --db <url>\`.`;

    expect(
      errorChangePolicyForbids({
        spaceId: 'app',
        command: 'db update',
        change: ['migrate'],
        source: { kind: 'marker' },
        targetHash: TARGET,
        migrationPlan: { from: reference(TARGET), to: { kind: 'default' } },
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
        migrationPlan: { from: reference(TARGET), to: { kind: 'default' } },
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
        migrationPlan: { from: reference(TARGET), to: { kind: 'default' } },
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
    const recovery = `Author a migration with \`{bin} migration plan --from ${TARGET} --config app.config.ts\`, run \`node <migration directory>/migration.ts --config app.config.ts\` for the directory it writes, and apply it with \`{bin} db migrate --to production --permit-policy-change --config app.config.ts --db <url>\`.`;

    expect(
      errorChangePolicyForbids({
        spaceId: 'app',
        command: 'db update',
        change: ['migrate'],
        source: { kind: 'ref', refName: 'production' },
        targetHash: TARGET,
        migrationPlan: { from: reference(TARGET), to: { kind: 'default' } },
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
        migrationPlan: { from: reference(TARGET), to: { kind: 'default' } },
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
          migrationPlan: { from: reference(TARGET), to: { kind: 'default' } },
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
    const recovery = `Author a migration with \`{bin} migration plan --from ${TARGET}\`, run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`{bin} db migrate --to production --db <url>\`.`;

    expect(
      errorChangePolicyForbids({
        spaceId: 'app',
        command: 'db update',
        change: ['migrate'],
        source: { kind: 'marker' },
        targetHash: TARGET,
        migrationPlan: { from: reference(TARGET), to: { kind: 'default' } },
        ref: { name: 'production', permitPolicyChange: false },
        invocation,
      }).toEnvelope(),
    ).toMatchObject({ fix: recovery, nextActions: [{ kind: 'user-choice', label: recovery }] });
  });
});
