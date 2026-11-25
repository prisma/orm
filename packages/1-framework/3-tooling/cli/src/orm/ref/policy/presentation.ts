import {
  DEFAULT_DATABASE_POLICIES,
  databasePolicyValueText,
} from '@internal/framework-components/control';
import type { Block, Presentations, Span, Text, Tone } from '@prisma/cli-engine';
import { relative } from 'pathe';
import type {
  RefPolicies,
  RefPoliciesOutcome,
  RefPolicyChange,
  RefPolicyValue,
} from '../../../control-api/operations/ref-policies';
import { fieldLines } from '../../data-lines';

type Setting = RefPolicyChange['setting'];

const DEFAULTS: Readonly<Record<Setting, RefPolicyValue>> = {
  change: DEFAULT_DATABASE_POLICIES.change,
  'dataProtection.dataLoss': DEFAULT_DATABASE_POLICIES.dataProtection.dataLoss,
  'dataProtection.accessWidening': DEFAULT_DATABASE_POLICIES.dataProtection.accessWidening,
};

const EFFECT_TONE: Readonly<Record<RefPolicyChange['effect'], Tone>> = {
  tightens: 'ok',
  loosens: 'warn',
  unchanged: 'muted',
};

function declared(policies: RefPolicies): readonly (readonly [Setting, RefPolicyValue | null])[] {
  return [
    ['change', policies.change],
    ['dataProtection.dataLoss', policies.dataProtection.dataLoss],
    ['dataProtection.accessWidening', policies.dataProtection.accessWidening],
  ];
}

function dataLines(policies: RefPolicies): readonly string[] {
  return fieldLines(
    declared(policies).map(([setting, value]) => [
      setting,
      value === null ? null : typeof value === 'string' ? value : value.join(','),
    ]),
  );
}

function valueText(setting: Setting, value: RefPolicyValue | null): Text {
  return value === null
    ? [{ text: `${databasePolicyValueText(DEFAULTS[setting])} (default)`, tone: 'muted' }]
    : databasePolicyValueText(value);
}

function refHeading(text: string, outcome: RefPoliciesOutcome, cwd: string): Text {
  return [
    { text },
    { text: outcome.result.ref, tone: 'ref' },
    { text: ' declares (' },
    { text: relative(cwd, outcome.refFile), tone: 'identifier' },
    { text: ')' },
  ];
}

function presentations(outcome: RefPoliciesOutcome, human: () => readonly Block[]): Presentations {
  return {
    stdout: () => dataLines(outcome.result.policies),
    next: () => [],
    human,
    json: () => outcome.result,
  };
}

export function showPresentations(outcome: RefPoliciesOutcome, cwd: string): Presentations {
  const { ref, policies } = outcome.result;
  return presentations(outcome, () => [
    { kind: 'summary', status: 'info', text: refHeading('Policies ref ', outcome, cwd) },
    {
      kind: 'fields',
      rows: declared(policies).map(([setting, value]) => ({
        label: setting,
        value:
          value === null
            ? [{ text: 'not declared', tone: 'muted' }]
            : databasePolicyValueText(value),
      })),
    },
    {
      kind: 'summary',
      status: 'info',
      text: `These are what the ref declares, not what a database has. Compare with a database: {bin} migration status --to ${ref} --db <url>`,
    },
  ]);
}

function spans(text: Text): readonly Span[] {
  return typeof text === 'string' ? [{ text }] : text;
}

function changesCard(changes: readonly RefPolicyChange[]): Block {
  return {
    kind: 'fields',
    rows: changes.map(({ setting, before, after, effect }) => ({
      label: setting,
      value: [
        ...spans(valueText(setting, before)),
        { text: '  →  ' },
        ...spans(valueText(setting, after)),
        { text: '  ' },
        { text: effect, tone: EFFECT_TONE[effect] },
      ],
    })),
  };
}

/** What a `set` or `delete` did to the ref file, and what it did not do to any database. */
export function editPresentations(
  outcome: RefPoliciesOutcome,
  cwd: string,
  closing: (changes: readonly RefPolicyChange[]) => string,
): Presentations {
  const { ref, changes } = outcome.result;
  return presentations(outcome, () =>
    changes.length === 0
      ? [
          {
            kind: 'summary',
            status: 'info',
            text: [
              { text: 'Nothing changed: ref ' },
              { text: ref, tone: 'ref' },
              { text: ' already declares these policies. No file was written.' },
            ],
          },
        ]
      : [
          {
            kind: 'summary',
            status: 'ok',
            text: refHeading('Updated the policies ref ', outcome, cwd),
          },
          changesCard(changes),
          { kind: 'summary', status: 'info', text: closing(changes) },
        ],
  );
}
