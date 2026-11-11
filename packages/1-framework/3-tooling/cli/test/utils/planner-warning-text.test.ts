import { describe, expect, it } from 'vitest';
import { plannerWarningText } from '../../src/utils/planner-warning-text';

describe('plannerWarningText', () => {
  it('prints the summary, then the why', () => {
    expect(
      plannerWarningText({
        kind: 'documentsNotRewritten',
        summary: 'Field "User.status" gains enum "Status"',
        why: 'Write a dataTransform before the validator change.',
      }),
    ).toBe(
      'Field "User.status" gains enum "Status". Write a dataTransform before the validator change.',
    );
  });

  it('keeps the summary as it is when it ends a sentence or has no why', () => {
    expect([
      plannerWarningText({ kind: 'k', summary: 'Index dropped.', why: 'It is unused.' }),
      plannerWarningText({ kind: 'k', summary: 'control policy suppressed: table "auth.x"' }),
    ]).toEqual(['Index dropped. It is unused.', 'control policy suppressed: table "auth.x"']);
  });
});
