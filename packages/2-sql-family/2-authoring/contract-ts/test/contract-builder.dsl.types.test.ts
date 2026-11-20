import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, field, model } from '../src/contract-builder';
import { modelsOf } from './contract-test-helpers';
import { columnDescriptor } from './helpers/column-descriptor';

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const int4Column = columnDescriptor('pg/int4@1');

describe('contract DSL type surface', () => {
  it('preserves the typed contract result at the defineContract boundary', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(contract.target).toBe('postgres');
    expect(contract.targetFamily).toBe('sql');
    expectTypeOf(contract.target).toEqualTypeOf<'postgres'>();
    expectTypeOf(contract.targetFamily).toEqualTypeOf<'sql'>();
    expectTypeOf(modelsOf(contract).User.storage.table).toEqualTypeOf<'user'>();
  });

  it('rejects invalid defaultControlPolicy at compile time', () => {
    if (false as boolean) {
      defineContract({
        ...testTypeLookups,
        family: bareFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        // @ts-expect-error invalid control policy literal
        defaultControlPolicy: 'bogus',
        models: {},
      });
    }
  });

  it('rejects invalid per-table control at compile time', () => {
    if (false as boolean) {
      defineContract({
        ...testTypeLookups,
        family: bareFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: {
          User: model('User', {
            fields: { id: field.column(int4Column).id() },
            // @ts-expect-error invalid control policy literal
          }).sql({ table: 'app_user', control: 'bogus' }),
        },
      });
    }
  });
});
