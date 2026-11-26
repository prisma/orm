import type { RefPolicyChange } from '../../../control-api/operations/ref-policies';
import { isForbiddenLevel } from '../../../utils/policy-settings';

export const refPositional = {
  brief: 'Ref name (e.g. staging, production)',
  placeholder: 'ref',
} as const;

export const NOT_A_REASON_TO_CHANGE =
  "A refused deploy or plan is not a reason to change a ref's policies. They\n" +
  'record how the team decided that database may change.';

/** `a`, `a and b`, `a, b and c`. */
export function andList(values: readonly string[]): string {
  return values.length <= 1
    ? values.join('')
    : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

/**
 * What the changes do to `migration plan --to <ref>`, which refuses only what a forbidden level forbids: it starts checking a setting that became forbidden and stops checking one that was. Empty when neither happened.
 */
export function planCheckSentence(ref: string, changes: readonly RefPolicyChange[]): string {
  const starts = changes.flatMap(({ setting, after }) =>
    after !== null && isForbiddenLevel(after) ? [setting] : [],
  );
  const stops = changes.flatMap(({ setting, before }) =>
    before !== null && isForbiddenLevel(before) ? [setting] : [],
  );
  const clauses = [
    ...(starts.length === 0 ? [] : [`now checks plans against ${andList(starts)}`]),
    ...(stops.length === 0 ? [] : [`no longer checks plans against ${andList(stops)}`]),
  ];
  return clauses.length === 0 ? '' : ` {bin} migration plan --to ${ref} ${clauses.join(' and ')}.`;
}
