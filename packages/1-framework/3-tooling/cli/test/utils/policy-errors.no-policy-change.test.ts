import { describe, expect, it } from 'vitest';
import type { CliStructuredError } from '../../src/utils/cli-errors';
import {
  errorChangePolicyForbids,
  errorDatabasePoliciesMovedDuringSign,
  errorDataProtectionForbids,
  errorPermitPolicyChangeNeedsRef,
  errorPolicyMismatch,
  type PolicySource,
} from '../../src/utils/policy-errors';
import type { CliInvocation } from '../../src/utils/printed-command';
import { NOT_RECORDED, reference } from './plan-origins';

const TARGET = 'b'.repeat(64);
const invocation: CliInvocation = { cwd: '/work/app', configPath: undefined, dbGiven: true };
const SOURCES: readonly PolicySource[] = [
  { kind: 'marker' },
  { kind: 'ref', refName: 'production' },
];
const DEFAULT_POLICIES = {
  change: ['migrate', 'reconcile'],
  dataProtection: {
    dataLoss: 'data-loss-with-consent',
    accessWidening: 'access-widening-with-consent',
  },
} as const;

const dropColumn = {
  spaceId: 'app',
  migration: '20261118T0900_drop_legacy',
  subject: 'user.legacy_name',
  label: 'Drop column "legacy_name" from "user"',
};
const extensionOperation = { ...dropColumn, spaceId: 'audit' };

function everyPolicyError(): readonly (readonly [string, CliStructuredError])[] {
  const mismatches = [
    [{ setting: 'change', declared: ['migrate'], inForce: ['migrate', 'reconcile'] }],
    [{ setting: 'change', declared: ['migrate', 'reconcile'], inForce: ['migrate'] }],
    [{ setting: 'change', declared: ['reconcile'], inForce: ['migrate'] }],
    [
      {
        setting: 'dataProtection.dataLoss',
        declared: 'data-loss-forbidden',
        inForce: 'data-loss-permitted',
      },
      {
        setting: 'dataProtection.accessWidening',
        declared: 'access-widening-permitted',
        inForce: 'access-widening-forbidden',
      },
    ],
  ] as const;
  const changeRefusals = (['db update', 'db sign', 'db migrate'] as const).flatMap((command) =>
    SOURCES.flatMap((source) =>
      [reference(TARGET), NOT_RECORDED].map(
        (from) =>
          [
            `change policy: ${command}, ${source.kind}`,
            errorChangePolicyForbids({
              spaceId: 'app',
              command,
              change: command === 'db migrate' ? ['reconcile'] : ['migrate'],
              source,
              targetHash: TARGET,
              migrationPlan: { from, to: { kind: 'default' } },
              invocation,
            }),
          ] as const,
      ),
    ),
  );
  const dataProtectionRefusals = (['db migrate', 'db update', 'migration plan'] as const).flatMap(
    (command) =>
      (['dataLoss', 'accessWidening'] as const).flatMap((setting) =>
        SOURCES.flatMap((source) =>
          [[dropColumn], [extensionOperation], [dropColumn, extensionOperation]].map(
            (operations) =>
              [
                `data protection: ${command}, ${setting}, ${source.kind}`,
                errorDataProtectionForbids({
                  spaceId: 'app',
                  command,
                  refusals: [{ setting, source, operations }],
                  invocation,
                }),
              ] as const,
          ),
        ),
      ),
  );
  return [
    ...mismatches.map(
      (differences) =>
        [
          'policy mismatch',
          errorPolicyMismatch({ spaceId: 'app', refName: 'production', differences }),
        ] as const,
    ),
    ...changeRefusals,
    ...dataProtectionRefusals,
    [
      'consent without a ref, command',
      errorPermitPolicyChangeNeedsRef({ command: 'db migrate', to: undefined }),
    ],
    [
      'consent without a ref, control API',
      errorPermitPolicyChangeNeedsRef({ refOption: 'ref', to: TARGET }),
    ],
    [
      'policies moved during sign',
      errorDatabasePoliciesMovedDuringSign({
        spaceId: 'app',
        checked: DEFAULT_POLICIES,
        found: { ...DEFAULT_POLICIES, change: ['migrate'] },
        invocation: { ...invocation, rerunArgs: [] },
      }),
    ],
  ];
}

/** Advice to change or apply a policy, or to make a ref match the database, in any wording these errors have used. */
const SUGGESTS_A_POLICY_CHANGE =
  /\b(change|changes|changing|apply|applies|applying|loosen|tighten)\b[^.]*\bpolic|declare what the database has|\banyway\b/i;

/**
 * A command the advice repeats keeps the `--permit-policy-change` the user gave (ADR 320), which is the user's own
 * consent, not a suggestion; the flag's name is left out before the advice is read.
 */
function suggestsAPolicyChange(advice: string): boolean {
  return SUGGESTS_A_POLICY_CHANGE.test(advice.replaceAll('--permit-policy-change', ''));
}

describe('policy errors', () => {
  it('never suggest changing or applying a database or ref policy', () => {
    const suggesting = everyPolicyError().flatMap(([name, error]) => {
      const envelope = error.toEnvelope();
      return [envelope.fix ?? '', ...envelope.nextActions.map(({ label }) => label)]
        .filter(suggestsAPolicyChange)
        .map((advice) => `${name}: ${advice}`);
    });

    expect(everyPolicyError().length).toBeGreaterThan(50);
    expect(suggesting).toEqual([]);
  });

  it.each([
    'To do it anyway, whoever owns the database must first change its data protection policy.',
    "Have whoever owns the database apply the ref's policies in a deploy.",
    'Make the ref declare what the database has, and have the change reviewed.',
    "Ask the database's owner to loosen the policy.",
  ])('recognises the advice %s as suggesting a policy change', (advice) => {
    expect(suggestsAPolicyChange(advice)).toBe(true);
  });
});
