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

/** A sentence that talks about a policy, a level or what may change, a ref, the policy commands or the consent flag. */
const ABOUT_POLICIES =
  /polic|forbid|consent|permit|declare|level|loosen|tighten|relax|strict|\bref\b|refs\/|\.json|dataLoss|accessWidening|dataProtection|data loss|losing data|read or write|allow|accept|owner|owns/i;

const SETTING =
  '(change|dataProtection\\.dataLoss|dataProtection\\.accessWidening|dataLoss|accessWidening)';
const FORBIDS = '(losing data|data loss|changing who can read or write data)';

/** Every sentence about policies that a policy error may say, and nothing else. */
const ALLOWED_SENTENCES: readonly RegExp[] = [
  /^The ref's policies differ from the database's$/,
  new RegExp(`^\\S+ declares ${SETTING}: [^;]+; the database has ${SETTING}: .+\\.$`),
  /^Nothing runs while \S+ declares policies that differ from the database's\.$/,
  /^Report the difference to whoever owns the database\.$/,
  /^(\S+ declares a change policy that|This database's change policy) permits only (db update|migrations)$/,
  /^(\S+ declares|The marker records) change: [a-z, ]+, so (db update|db sign|db migrate) may not (move|sign) it\.$/,
  new RegExp(
    `^(\\S+ declares a data protection policy that|This database's data protection policy) forbids ${FORBIDS}( and ${FORBIDS})?$`,
  ),
  new RegExp(
    `^(\\S+ declares|The marker records) ${SETTING}: (data-loss|access-widening)-forbidden\\.$`,
  ),
  new RegExp(
    `^\\S+ declares a data protection policy that forbids ${FORBIDS}, so these operations cannot run on the database it describes\\.$`,
  ),
  new RegExp(
    `^This database's data protection policy forbids ${FORBIDS}, so these operations cannot run on it\\.$`,
  ),
  /^--permit-policy-change needs --to <ref>$/,
  /^No ref was given, so there are no policies to write\.$/,
  /^\S+ is not a ref, so it declares no policies to write\.$/,
  /^Name the ref whose policies to write with --to <ref>, or leave out --permit-policy-change\.$/,
  /^permitPolicyChange needs (a ref|a target of kind ref)$/,
  /^Pass (the ref|a target of kind ref) whose policies to write, or leave out permitPolicyChange\.$/,
  /^The database's policies changed while db sign ran$/,
  /^The database's policies changed after db sign checked them: .+\.$/,
  /^Sign again, which checks the policies anew: .+$/,
];

/** The `--to <ref> --permit-policy-change` a ref-sourced change-policy refusal repeats from the user's own command. */
const USERS_CONSENT = /(--to \S+) --permit-policy-change/g;

function sentencesOf(text: string): readonly string[] {
  return text.split(/(?<=\.)\s+/).filter((sentence) => sentence.length > 0);
}

/** The sentences about policies that no policy error is known to say. */
function unknownPolicySentences(
  texts: readonly string[],
  options: { readonly repeatsTheUsersConsent: boolean },
): readonly string[] {
  return texts.flatMap(sentencesOf).filter((sentence) => {
    const read = options.repeatsTheUsersConsent ? sentence.replace(USERS_CONSENT, '$1') : sentence;
    return ABOUT_POLICIES.test(read) && !ALLOWED_SENTENCES.some((allowed) => allowed.test(read));
  });
}

function textsOf(error: CliStructuredError): readonly string[] {
  const envelope = error.toEnvelope();
  return [
    envelope.summary,
    envelope.why ?? '',
    envelope.fix ?? '',
    ...envelope.nextActions.flatMap((action) => [action.label, action.command ?? '']),
  ];
}

describe('policy errors', () => {
  it('say about policies only the sentences they are known to say', () => {
    const errors = everyPolicyError();
    const unknown = errors.flatMap(([name, error]) =>
      unknownPolicySentences(textsOf(error), {
        repeatsTheUsersConsent: name.startsWith('change policy:') && name.endsWith(', ref'),
      }).map((sentence) => `${name}: ${sentence}`),
    );

    expect(errors.length).toBeGreaterThan(50);
    expect(unknown).toEqual([]);
  });

  it.each([
    'To do it anyway, whoever owns the database must first change its data protection policy.',
    "Have whoever owns the database apply the ref's policies in a deploy.",
    'Make the ref declare what the database has, and have the change reviewed.',
    'Ask the owner to relax the policy.',
    'Or update the ref so it declares what the database has.',
    "To record the ref's settings, rerun with --permit-policy-change.",
    'Edit the ref file migrations/app/refs/production.json and deploy again.',
    'Run prisma migration ref policy set production --data-loss permitted.',
    'Ask the owner to permit data loss.',
    'Lower the data protection level.',
    "Ask the database's owner to allow the loss.",
    'Remove dataLoss from production.',
    'Ask whoever owns the database to accept the change.',
    'Have the owner switch dataProtection.dataLoss off.',
  ])('rejects the sentence %s', (sentence) => {
    const mismatch = errorPolicyMismatch({
      spaceId: 'app',
      refName: 'production',
      differences: [
        { setting: 'change', declared: ['migrate'], inForce: ['migrate', 'reconcile'] },
      ],
    }).toEnvelope();

    expect(
      unknownPolicySentences([mismatch.fix ?? '', sentence], { repeatsTheUsersConsent: false }),
    ).toEqual([sentence]);
  });

  it('rejects --permit-policy-change outside the command a ref refusal repeats', () => {
    expect(
      unknownPolicySentences(['Run `{bin} db update --to production --permit-policy-change`.'], {
        repeatsTheUsersConsent: false,
      }),
    ).toHaveLength(1);
  });
});
