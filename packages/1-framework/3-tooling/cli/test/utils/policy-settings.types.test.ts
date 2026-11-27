import type { ChangeStrategy, DataLossLevel } from '@internal/framework-components/control';
import { describe, expectTypeOf, it } from 'vitest';
import {
  type DeclaredSettings,
  type GivenSettings,
  type PolicySettingValue,
  policyValueEffect,
} from '../../src/utils/policy-settings';

describe('policy setting types', () => {
  it('compares two values of the setting it is given, and no other', () => {
    expectTypeOf<PolicySettingValue<'change'>>().toEqualTypeOf<readonly ChangeStrategy[]>();
    expectTypeOf<PolicySettingValue<'dataProtection.dataLoss'>>().toEqualTypeOf<DataLossLevel>();
    expectTypeOf(
      policyValueEffect('dataProtection.dataLoss', 'data-loss-forbidden', 'data-loss-permitted'),
    ).toEqualTypeOf<'tightens' | 'loosens' | 'unchanged'>();
    const dataLoss = 'dataProtection.dataLoss';
    const accessWidening = 'access-widening-forbidden';
    // @ts-expect-error an access-widening level is not a data loss level
    policyValueEffect(dataLoss, 'data-loss-forbidden', accessWidening);
    // @ts-expect-error a level is not a change list
    policyValueEffect('change', ['migrate'], 'data-loss-forbidden');
  });

  it('states every setting, undefined where none is declared', () => {
    expectTypeOf<DeclaredSettings>().toEqualTypeOf<{
      readonly change: readonly ChangeStrategy[] | undefined;
      readonly 'dataProtection.dataLoss': DataLossLevel | undefined;
      readonly 'dataProtection.accessWidening':
        | PolicySettingValue<'dataProtection.accessWidening'>
        | undefined;
    }>();
  });

  it('lets a set give a setting or leave it out, never give it as undefined', () => {
    const given: GivenSettings = { change: ['migrate'] };
    // @ts-expect-error a set never removes a setting
    const removing: GivenSettings = { change: undefined };
    expectTypeOf(given).toEqualTypeOf<GivenSettings>();
    expectTypeOf(removing).toEqualTypeOf<GivenSettings>();
  });
});
