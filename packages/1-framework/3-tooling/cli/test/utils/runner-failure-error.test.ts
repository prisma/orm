import { migrationRunnerFailure } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { runnerFailureError } from '../../src/utils/runner-failure-error';

const failed = (failingSpace: string | undefined) =>
  migrationRunnerFailure('MIGRATION.EXECUTION_FAILED', 'Operation table.audit failed', {
    why: 'Table already exists. The operations that ran before the failure stay applied.',
    meta: failingSpace === undefined ? {} : { failingSpace },
  });

describe('runnerFailureError', () => {
  it('names the contract space the apply stopped in when it is an extension space', () => {
    expect(runnerFailureError(failed('audit'), []).why).toBe(
      'Table already exists. The operations that ran before the failure stay applied. The apply stopped in contract space "audit".',
    );
  });

  it("keeps the runner's why when the apply stopped in the application's space or names no space", () => {
    expect([
      runnerFailureError(failed('app'), []).why,
      runnerFailureError(failed(undefined), []).why,
    ]).toEqual([
      'Table already exists. The operations that ran before the failure stay applied.',
      'Table already exists. The operations that ran before the failure stay applied.',
    ]);
  });
});
