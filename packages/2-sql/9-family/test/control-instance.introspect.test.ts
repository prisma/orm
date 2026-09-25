import type {
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import type { SqlControlAdapter } from '../src/core/control-adapter';
import { createSqlFamilyInstance } from '../src/core/control-instance';

type IntrospectCall = {
  readonly contract: unknown;
  readonly schema: string | undefined;
};

function makeStack(calls: IntrospectCall[]) {
  const adapterStub = {
    familyId: 'sql',
    targetId: 'postgres',
    introspect: async (
      _driver: SqlControlDriverInstance<'postgres'>,
      contract?: unknown,
      schema?: string,
    ) => {
      calls.push({ contract, schema });
      return new SqlSchemaIR({ tables: {} });
    },
  } as unknown as SqlControlAdapter<string>;

  return createControlStack({
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      create: (() => ({})) as unknown as ControlFamilyDescriptor<'sql'>['create'],
      emission: {
        id: 'sql',
        generateStorageType: () => '{ readonly storageHash: StorageHash }',
        generateModelStorageType: () => 'Record<string, never>',
        getFamilyImports: () => [],
        getFamilyTypeAliases: () => '',
        getTypeMapsExpression: () => 'unknown',
        getContractWrapper: (base: string) => `export type Contract = ${base};`,
      },
    },
    target: {
      kind: 'target',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      contractSerializer: {
        deserializeContract: (json) => json as never,
        serializeContract: (contract) => contract as never,
      },
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    } as ControlTargetDescriptor<'sql', 'postgres'>,
    adapter: {
      kind: 'adapter',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      create: (() => adapterStub) as unknown as (stack: unknown) => never,
    },
    extensions: [],
  });
}

describe('SqlFamilyInstance.introspect', () => {
  const driver = {} as SqlControlDriverInstance<string>;

  it('forwards the requested schema to the control adapter', async () => {
    const calls: IntrospectCall[] = [];
    const instance = createSqlFamilyInstance(makeStack(calls));

    await instance.introspect({ driver, schema: 'sales' });

    expect(calls).toEqual([{ contract: undefined, schema: 'sales' }]);
  });

  it('leaves the schema undefined so the adapter applies its own default', async () => {
    const calls: IntrospectCall[] = [];
    const instance = createSqlFamilyInstance(makeStack(calls));

    await instance.introspect({ driver });

    expect(calls).toEqual([{ contract: undefined, schema: undefined }]);
  });

  it('passes the contract alongside the schema for contract-guided walks', async () => {
    const calls: IntrospectCall[] = [];
    const instance = createSqlFamilyInstance(makeStack(calls));
    const contract = { marker: 'contract' };

    await instance.introspect({ driver, contract, schema: 'sales' });

    expect(calls).toEqual([{ contract, schema: 'sales' }]);
  });
});
