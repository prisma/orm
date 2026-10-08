import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { createSqlFamilyInstance } from '../src/core/control-instance';
import { makeStack } from './control-instance-stack.helpers';

function captureError(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('sql family instance structured error codes', () => {
  it('raises CONTRACT.INFER_UNSUPPORTED when the target descriptor has no inferPslContract', () => {
    const instance = createSqlFamilyInstance(makeStack());
    const error = captureError(() => instance.inferPslContract?.(undefined as never));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.INFER_UNSUPPORTED',
      meta: { targetId: 'postgres' },
    });
  });

  it('raises CONTRACT.PACK_CONTRIBUTION_INVALID when a required classifier descriptor operation is missing', () => {
    const instance = createSqlFamilyInstance(makeStack());
    const error = captureError(() => instance.classifySubjectGranularity?.({} as SchemaDiffIssue));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
      meta: { targetId: 'postgres', operation: 'classifySubjectGranularity' },
    });
  });
});
