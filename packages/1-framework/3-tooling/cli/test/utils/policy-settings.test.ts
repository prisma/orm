import { ACCESS_WIDENING_LEVELS, DATA_LOSS_LEVELS } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  DATA_PROTECTION_SETTINGS,
  declaredEntries,
  declaredPolicies,
  declaredSettings,
  isForbiddenLevel,
  levelFromInput,
  policyValueEffect,
  settingsText,
  shortLevels,
} from '../../src/utils/policy-settings';

describe('levelFromInput', () => {
  it('reads a short level as the long form of its own setting', () => {
    expect(levelFromInput(DATA_PROTECTION_SETTINGS.dataLoss, 'forbidden')).toBe(
      'data-loss-forbidden',
    );
    expect(levelFromInput(DATA_PROTECTION_SETTINGS.accessWidening, 'with-consent')).toBe(
      'access-widening-with-consent',
    );
  });

  it("accepts the long form of its own setting and rejects the other setting's", () => {
    expect(levelFromInput(DATA_PROTECTION_SETTINGS.dataLoss, 'data-loss-permitted')).toBe(
      'data-loss-permitted',
    );
    expect(levelFromInput(DATA_PROTECTION_SETTINGS.dataLoss, 'access-widening-permitted')).toBe(
      undefined,
    );
    expect(levelFromInput(DATA_PROTECTION_SETTINGS.accessWidening, 'data-loss-forbidden')).toBe(
      undefined,
    );
  });

  it('rejects a value that is no level', () => {
    expect(levelFromInput(DATA_PROTECTION_SETTINGS.dataLoss, 'never')).toBe(undefined);
    expect(levelFromInput(DATA_PROTECTION_SETTINGS.dataLoss, '')).toBe(undefined);
  });
});

describe('shortLevels', () => {
  it("derives each setting's short levels from the framework's level list", () => {
    expect(shortLevels(DATA_PROTECTION_SETTINGS.dataLoss)).toEqual([
      'forbidden',
      'with-consent',
      'permitted',
    ]);
    expect(shortLevels(DATA_PROTECTION_SETTINGS.accessWidening)).toEqual([
      'forbidden',
      'with-consent',
      'permitted',
    ]);
    expect(DATA_PROTECTION_SETTINGS.dataLoss.levels).toBe(DATA_LOSS_LEVELS);
    expect(DATA_PROTECTION_SETTINGS.accessWidening.levels).toBe(ACCESS_WIDENING_LEVELS);
  });
});

describe('policyValueEffect', () => {
  it.each([
    ['data-loss-with-consent', 'data-loss-forbidden', 'tightens'],
    ['data-loss-permitted', 'data-loss-with-consent', 'tightens'],
    ['data-loss-forbidden', 'data-loss-permitted', 'loosens'],
    ['data-loss-with-consent', 'data-loss-permitted', 'loosens'],
    ['data-loss-forbidden', 'data-loss-forbidden', 'unchanged'],
    ['access-widening-with-consent', 'access-widening-forbidden', 'tightens'],
    ['access-widening-forbidden', 'access-widening-with-consent', 'loosens'],
    ['access-widening-permitted', 'access-widening-permitted', 'unchanged'],
  ] as const)('labels %s to %s as %s', (from, to, effect) => {
    expect(policyValueEffect(from, to)).toBe(effect);
  });

  it.each([
    [['migrate', 'reconcile'], ['migrate'], 'tightens'],
    [['migrate'], ['migrate', 'reconcile'], 'loosens'],
    [['migrate'], ['reconcile'], 'loosens'],
    [['reconcile', 'migrate'], ['migrate', 'reconcile'], 'unchanged'],
  ] as const)('labels change %j to %j as %s', (from, to, effect) => {
    expect(policyValueEffect(from, to)).toBe(effect);
  });
});

describe('declared settings', () => {
  it('reads a declaration by key path and writes it back in the ref format, without empty objects', () => {
    const settings = declaredSettings({
      dataProtection: { accessWidening: 'access-widening-forbidden' },
      change: ['reconcile', 'migrate', 'reconcile'],
    });

    expect(settings).toEqual({
      change: ['migrate', 'reconcile'],
      'dataProtection.accessWidening': 'access-widening-forbidden',
    });
    expect(JSON.stringify(declaredPolicies(settings))).toBe(
      JSON.stringify({
        change: ['migrate', 'reconcile'],
        dataProtection: { accessWidening: 'access-widening-forbidden' },
      }),
    );
    expect(declaredPolicies({ change: undefined })).toBe(undefined);
  });

  it('renders the declared settings as one line', () => {
    expect(
      settingsText(
        declaredEntries(
          declaredSettings({
            change: ['migrate'],
            dataProtection: { dataLoss: 'data-loss-forbidden' },
          }),
        ),
      ),
    ).toBe('change: migrate; dataProtection.dataLoss: data-loss-forbidden');
  });

  it('knows the forbidden levels', () => {
    expect(
      (['data-loss-forbidden', 'access-widening-forbidden'] as const).every(isForbiddenLevel),
    ).toBe(true);
    expect(isForbiddenLevel('data-loss-with-consent')).toBe(false);
    expect(isForbiddenLevel(['migrate'])).toBe(false);
  });
});
