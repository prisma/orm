import { describe, expect, it } from 'vitest';
import { matchConsents } from '../../../src/control-api/statements/plan-questions';

const invoice = { text: 'billing.Invoice', removedNamespace: 'billing' };
const receipt = { text: 'billing.Receipt', removedNamespace: 'billing' };
const user = { text: 'User', removedNamespace: undefined };

describe('matchConsents', () => {
  it('matches the same --delete flags the same way in either order', () => {
    for (const texts of [
      ['billing', 'billing.Invoice'],
      ['billing.Invoice', 'billing'],
    ]) {
      const matched = matchConsents('delete', [invoice, receipt], texts);
      expect(matched.unused).toEqual([]);
      expect([...matched.answered]).toEqual([
        [0, 'billing.Invoice'],
        [1, 'billing'],
      ]);
    }
  });

  it('refuses a namespace --delete whose questions subject flags all answered, in either order', () => {
    for (const texts of [
      ['billing', 'billing.Invoice'],
      ['billing.Invoice', 'billing'],
    ]) {
      expect(matchConsents('delete', [invoice], texts).unused).toEqual([
        {
          verb: 'delete',
          text: 'billing',
          alreadyAnsweredBy: { kind: 'namespace', namespace: 'billing' },
        },
      ]);
    }
  });

  it('answers one operation per --allow, and refuses an --allow left over', () => {
    expect([...matchConsents('allow', [user, user], ['User']).answered]).toEqual([[0, 'User']]);
    expect(matchConsents('allow', [user, user], ['User', 'User', 'User']).unused).toEqual([
      {
        verb: 'allow',
        text: 'User',
        alreadyAnsweredBy: {
          kind: 'subject',
          subject: 'User',
          flag: { verb: 'allow', text: 'User' },
        },
      },
    ]);
  });
});
