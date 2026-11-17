import { describe, expect, it } from 'vitest';
import { dbInitPlanningFailedError } from '../../src/utils/db-init-failure';

const typeMismatch = { kind: 'typeMismatch', summary: 'Column "user"."age" changes type' };
const refusedWidening = {
  kind: 'policy-violation',
  summary: 'widening operation disallowed',
  refusedOperationClass: 'widening',
} as const;

describe('dbInitPlanningFailedError', () => {
  it('points at db update when any conflict is a refused operation class, beside conflicts that are not', () => {
    const error = dbInitPlanningFailedError([typeMismatch, refusedWidening]);
    expect({ code: error.code, nextActions: error.nextActions }).toEqual({
      code: 'MIGRATION.PLANNING_FAILED',
      nextActions: [
        {
          kind: 'run-command',
          label: 'Apply the change with db update',
          command: '{bin} db update',
        },
      ],
    });
  });

  it('keeps the planning failure as it is when no operation class was refused', () => {
    const error = dbInitPlanningFailedError([typeMismatch]);
    expect({ code: error.code, why: error.why }).toEqual({
      code: 'MIGRATION.PLANNING_FAILED',
      why: 'Column "user"."age" changes type',
    });
  });
});
