import type { RefPolicyValue } from '../../../control-api/operations/ref-policies';
import { FORBIDDEN_LEVEL } from '../../../utils/data-protection-settings';

export const refPositional = {
  brief: 'Ref name (e.g. staging, production)',
  placeholder: 'ref',
} as const;

export const DO_NOT_LOOSEN_TO_GET_PAST_A_REFUSAL =
  "A refused deploy or plan is not a reason to loosen a ref's policies. Change\n" +
  'them only when the team means to change how that database may change, and\n' +
  'have the change reviewed like code.';

const FORBIDDEN_LEVELS: readonly RefPolicyValue[] = Object.values(FORBIDDEN_LEVEL);

/** A data protection level at which `migration plan --to <ref>` refuses the plans it forbids. */
export function isForbiddenLevel(value: RefPolicyValue): boolean {
  return FORBIDDEN_LEVELS.includes(value);
}

/** `a`, `a and b`, `a, b and c`. */
export function andList(values: readonly string[]): string {
  return values.length <= 1
    ? values.join('')
    : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}
