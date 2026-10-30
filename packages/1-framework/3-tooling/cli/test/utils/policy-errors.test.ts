import { describe, expect, it } from 'vitest';
import { errorChangePolicyForbids, errorPolicyMismatch } from '../../src/utils/policy-errors';
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
    const recovery = 'Author a migration with {bin} migration plan, then deploy it.';

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

  it("names the ref when the refused change policy is the ref's declaration", () => {
    expect(
      errorChangePolicyForbids({
        spaceId: 'app',
        command: 'db update',
        change: ['migrate'],
        source: { kind: 'ref', refName: 'production' },
        targetHash: TARGET,
        invocation,
      }).toEnvelope(),
    ).toMatchObject({
      why: 'production declares change: migrate, so db update may not move it.',
      meta: { spaceId: 'app', command: 'db update', change: ['migrate'] },
    });
  });
});
