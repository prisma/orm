import { databasePolicyValueText } from '@internal/framework-components/control';
import type { Block, Presentations, Span, Text, Tone } from '@prisma/cli-engine';
import { relative } from 'pathe';
import type {
  RefPoliciesOutcome,
  RefPolicyChange,
} from '../../../control-api/operations/ref-policies';
import {
  DEFAULT_SETTINGS,
  declaredEntries,
  POLICY_SETTINGS,
  type PolicySetting,
  type PolicySettingValue,
} from '../../../utils/policy-settings';
import { fieldLines } from '../../data-lines';

const EFFECT_TONE: Readonly<Record<RefPolicyChange['effect'], Tone>> = {
  tightens: 'ok',
  loosens: 'warn',
  unchanged: 'muted',
};

function dataLines(outcome: RefPoliciesOutcome): readonly string[] {
  return fieldLines(
    declaredEntries(outcome.declared).map(([setting, value]) => [
      setting,
      typeof value === 'string' ? value : value.join(','),
    ]),
  );
}

/** A value before the change: one the ref did not declare is shown as the default it stood for. */
function beforeText(setting: PolicySetting, value: PolicySettingValue | null): Text {
  return value === null
    ? [{ text: `${databasePolicyValueText(DEFAULT_SETTINGS[setting])} (default)`, tone: 'muted' }]
    : databasePolicyValueText(value);
}

/** A value after the change: a removed setting is not declared, and deploys stop comparing it. */
function afterText(value: PolicySettingValue | null): Text {
  return value === null ? NOT_DECLARED : databasePolicyValueText(value);
}

const NOT_DECLARED: Text = [{ text: 'not declared', tone: 'muted' }];

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
    stdout: () => dataLines(outcome),
    next: () => [],
    human,
    json: () => outcome.result,
  };
}

export function showPresentations(outcome: RefPoliciesOutcome, cwd: string): Presentations {
  const { ref } = outcome.result;
  return presentations(outcome, () => [
    { kind: 'summary', status: 'info', text: refHeading('Policies ref ', outcome, cwd) },
    {
      kind: 'fields',
      rows: POLICY_SETTINGS.map((setting) => {
        const value = outcome.declared[setting];
        return {
          label: setting,
          value: value === undefined ? NOT_DECLARED : databasePolicyValueText(value),
        };
      }),
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
        ...spans(beforeText(setting, before)),
        { text: '  →  ' },
        ...spans(afterText(after)),
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
  wording: {
    /** Why nothing changed, after "ref <name>". */
    readonly nothingChanged: string;
    readonly closing: (changes: readonly RefPolicyChange[]) => string;
  },
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
              { text: ` ${wording.nothingChanged}. No file was written.` },
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
          { kind: 'summary', status: 'info', text: wording.closing(changes) },
        ],
  );
}
