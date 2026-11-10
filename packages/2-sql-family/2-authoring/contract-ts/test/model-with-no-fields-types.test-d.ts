import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { ExtractFieldInputTypes, ExtractFieldOutputTypes } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import { model } from '../src/contract-builder';
import type { SqlContractResult } from '../src/contract-types';

declare const postgresPack: TargetPackRef<'sql', 'postgres'>;

const familyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const definition = {
  family: familyPack,
  target: postgresPack,
  models: {
    Legacy: model('Legacy', { fields: {} }).sql({ table: 'legacy_rows' }),
  },
};

type Contract = SqlContractResult<typeof definition>;
type LegacyModel = Contract['domain']['namespaces']['public']['models']['Legacy'];

test('a model with no fields has a field map with no keys', () => {
  expectTypeOf<keyof LegacyModel['fields']>().toEqualTypeOf<never>();
});

test('the output types of a model with no fields have no keys', () => {
  expectTypeOf<ExtractFieldOutputTypes<Contract>['public']['Legacy']>().toEqualTypeOf<
    Record<never, never>
  >();
});

test('the input types of a model with no fields reject every key, as the emitted ones do', () => {
  expectTypeOf<ExtractFieldInputTypes<Contract>['public']['Legacy']>().toEqualTypeOf<
    Record<string, never>
  >();
});
