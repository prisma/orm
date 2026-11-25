import { ACCESS_WIDENING_LEVELS, DATA_LOSS_LEVELS } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  DATA_PROTECTION_FLAGS,
  levelFromFlag,
  policyMoveEffect,
  shortLevels,
} from '../../src/utils/policy-settings';

describe('levelFromFlag', () => {
  it('reads a short level as the long form of its own setting', () => {
    expect(levelFromFlag(DATA_PROTECTION_FLAGS.dataLoss, 'forbidden')).toBe('data-loss-forbidden');
    expect(levelFromFlag(DATA_PROTECTION_FLAGS.accessWidening, 'with-consent')).toBe(
      'access-widening-with-consent',
    );
  });

  it("accepts the long form of its own setting and rejects the other setting's", () => {
    expect(levelFromFlag(DATA_PROTECTION_FLAGS.dataLoss, 'data-loss-permitted')).toBe(
      'data-loss-permitted',
    );
    expect(levelFromFlag(DATA_PROTECTION_FLAGS.dataLoss, 'access-widening-permitted')).toBe(
      undefined,
    );
    expect(levelFromFlag(DATA_PROTECTION_FLAGS.accessWidening, 'data-loss-forbidden')).toBe(
      undefined,
    );
  });

  it('rejects a value that is no level', () => {
    expect(levelFromFlag(DATA_PROTECTION_FLAGS.dataLoss, 'never')).toBe(undefined);
    expect(levelFromFlag(DATA_PROTECTION_FLAGS.dataLoss, '')).toBe(undefined);
  });
});

describe('shortLevels', () => {
  it("derives each setting's short levels from the framework's level list", () => {
    expect(shortLevels(DATA_PROTECTION_FLAGS.dataLoss)).toEqual([
      'forbidden',
      'with-consent',
      'permitted',
    ]);
    expect(shortLevels(DATA_PROTECTION_FLAGS.accessWidening)).toEqual([
      'forbidden',
      'with-consent',
      'permitted',
    ]);
    expect(DATA_PROTECTION_FLAGS.dataLoss.levels).toBe(DATA_LOSS_LEVELS);
    expect(DATA_PROTECTION_FLAGS.accessWidening.levels).toBe(ACCESS_WIDENING_LEVELS);
  });
});

describe('policyMoveEffect', () => {
  it.each([
    ['data-loss-with-consent', 'data-loss-forbidden', 'tightens'],
    ['data-loss-permitted', 'data-loss-with-consent', 'tightens'],
    ['data-loss-forbidden', 'data-loss-permitted', 'loosens'],
    ['data-loss-with-consent', 'data-loss-permitted', 'loosens'],
    ['data-loss-forbidden', 'data-loss-forbidden', 'unchanged'],
  ] as const)('labels dataLoss %s to %s as %s', (from, to, effect) => {
    expect(policyMoveEffect({ setting: 'dataProtection.dataLoss', from, to })).toBe(effect);
  });

  it.each([
    ['access-widening-with-consent', 'access-widening-forbidden', 'tightens'],
    ['access-widening-forbidden', 'access-widening-with-consent', 'loosens'],
    ['access-widening-permitted', 'access-widening-permitted', 'unchanged'],
  ] as const)('labels accessWidening %s to %s as %s', (from, to, effect) => {
    expect(policyMoveEffect({ setting: 'dataProtection.accessWidening', from, to })).toBe(effect);
  });

  it.each([
    [['migrate', 'reconcile'], ['migrate'], 'tightens'],
    [['migrate'], ['migrate', 'reconcile'], 'loosens'],
    [['migrate'], ['reconcile'], 'loosens'],
    [['reconcile', 'migrate'], ['migrate', 'reconcile'], 'unchanged'],
  ] as const)('labels change %j to %j as %s', (from, to, effect) => {
    expect(policyMoveEffect({ setting: 'change', from, to })).toBe(effect);
  });
});
