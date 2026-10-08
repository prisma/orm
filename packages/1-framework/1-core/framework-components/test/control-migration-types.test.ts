import { describe, expect, it } from 'vitest';
import type {
  MigrationPlannerConflict,
  MigrationPlannerSuccessResult,
} from '../src/control/control-migration-types';

const stubPlan = null as unknown as MigrationPlannerSuccessResult['plan'];

describe('MigrationPlannerSuccessResult', () => {
  it('omits warnings when the list is empty', () => {
    const result: MigrationPlannerSuccessResult = {
      kind: 'success',
      plan: stubPlan,
      appliedStatements: [],
    };
    expect(result).toEqual({
      kind: 'success',
      plan: stubPlan,
      appliedStatements: [],
    });
    expect('warnings' in result).toBe(false);
  });

  it('carries frozen warnings when present', () => {
    const warning: MigrationPlannerConflict = {
      kind: 'controlPolicySuppressedCall',
      summary: 'control policy suppressed: createTable(users)',
    };
    const result: MigrationPlannerSuccessResult = {
      kind: 'success',
      plan: stubPlan,
      appliedStatements: [],
      warnings: Object.freeze([Object.freeze(warning)]),
    };
    expect(result.warnings).toEqual([warning]);
  });
});
