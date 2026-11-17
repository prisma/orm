import type { CheckExpectation } from './control-migration-types';

export function expectAbsent(object: string): CheckExpectation {
  return { expects: 'absent', object };
}

export function expectPresent(object: string): CheckExpectation {
  return { expects: 'present', object };
}
