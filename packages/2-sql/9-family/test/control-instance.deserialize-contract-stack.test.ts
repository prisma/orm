import type { ContractModel, ContractValueObject } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
} from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { col, model, table } from '@internal/sql-contract/factories';
import type {
  SqlControlDriverInstance,
  SqlStorage,
  StorageTable,
} from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { createSqlFamilyInstance } from '../src/core/control-instance';

const int4 = sqlDataType('t/int4', { texts: [{ text: 'int4', written: true }] });
const jsonb = sqlDataType('t/jsonb', { texts: [{ text: 'jsonb', written: true }] });
const text = sqlDataType('t/text', { texts: [{ text: 'text', written: true }] });

const codecDataTypes: Readonly<Record<string, AnyCodecDescriptor['dataType']>> = {
  't/int4@1': int4.id,
  't/jsonb@1': jsonb.id,
  't/text@1': text.id,
};

const codecLookup: CodecLookupWithDescriptors = {
  get: () => undefined,
  renderOutputTypeFor: () => undefined,
  descriptorFor: (codecId) => {
    const dataType = codecDataTypes[codecId];
    if (dataType === undefined) return undefined;
    return {
      codecId,
      dataType,
      traits: [],
      paramsSchema: undefined,
      isParameterized: false,
      factory: () => () => {
        throw new Error('not used');
      },
    };
  },
};

function familyInstance(valueObjectStorageType: string | undefined) {
  const stack = {
    family: { id: 'sql' },
    target: {
      id: 't',
      contractSerializer: {
        deserializeContract: (json: unknown) => json,
        serializeContract: (contract: unknown) => contract,
      },
    },
    adapter: { id: 't-adapter', create: () => ({}) },
    extensions: [],
    codecTypeImports: [],
    extensionIds: [],
    codecLookup,
    dataTypeLookup: createDataTypeLookup([int4, jsonb, text]),
    declaredDataTypes: [],
    codecDescriptors: [],
    authoringContributions: {
      type: {
        Jsonb: { kind: 'typeConstructor', output: { codecId: 't/jsonb@1' } },
        Text: { kind: 'typeConstructor', output: { codecId: 't/text@1' } },
      },
      ...(valueObjectStorageType === undefined ? {} : { valueObjectStorageType }),
    },
  };
  return createSqlFamilyInstance(
    blindCast<Parameters<typeof createSqlFamilyInstance>[0], 'a stack with the slots read here'>(
      stack,
    ),
  );
}

function contractWith(
  tables: Record<string, StorageTable>,
  options: {
    readonly models?: Record<string, ContractModel>;
    readonly valueObjects?: Record<string, ContractValueObject>;
    readonly types?: SqlStorage['types'];
  } = {},
) {
  return createContract<SqlStorage>({
    target: 't',
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: tables },
        }),
      },
      ...(options.types === undefined ? {} : { types: options.types }),
    },
    ...(options.models === undefined ? {} : { models: options.models }),
    ...(options.valueObjects === undefined ? {} : { valueObjects: options.valueObjects }),
  });
}

const columnsPath = `storage.namespaces.${UNBOUND_NAMESPACE_ID}.entries.table.user.columns`;

describe('deserializeContract checks each column against the stack', () => {
  it('accepts a column whose codec represents its data type', () => {
    const contract = contractWith({ user: table({ id: col('t/int4', 't/int4@1') }) });
    expect(() => familyInstance('Jsonb').deserializeContract(contract)).not.toThrow();
  });

  it('refuses a column whose codec represents another data type', () => {
    const contract = contractWith({ user: table({ id: col('t/text', 't/int4@1') }) });
    expect(() => familyInstance('Jsonb').deserializeContract(contract)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.VALIDATION_FAILED',
        message: `${columnsPath}.id: codec t/int4@1 represents t/int4, not t/text`,
      }),
    );
  });

  it('accepts a column whose codec the stack does not know', () => {
    const contract = contractWith({
      user: table({ id: col('t/int4', 't/int4@1'), tags: col('ext/tags', 'ext/tags@1') }),
    });
    expect(() => familyInstance('Jsonb').deserializeContract(contract)).not.toThrow();
  });

  it('refuses a storage type whose codec represents another data type', () => {
    const contract = contractWith(
      { user: table({ id: col('t/int4', 't/int4@1') }) },
      {
        types: {
          Code: { kind: 'codec-instance', codecId: 't/text@1', dataType: 't/int4', typeParams: {} },
        },
      },
    );
    expect(() => familyInstance('Jsonb').deserializeContract(contract)).toThrow(
      'storage.types.Code: codec t/text@1 represents t/text, not t/int4',
    );
  });

  describe('a value-object column', () => {
    const userModel = (): ContractModel =>
      blindCast<ContractModel, 'test model literal with a value-object field'>({
        ...model('user', { id: { column: 'id' }, address: { column: 'address' } }),
        fields: {
          id: { nullable: false, type: { kind: 'scalar', codecId: 't/int4@1' } },
          address: { nullable: false, type: { kind: 'valueObject', name: 'Address' } },
        },
      });
    const valueObjects = {
      Address: {
        fields: { street: { nullable: false, type: { kind: 'scalar', codecId: 't/text@1' } } },
      },
    } satisfies Record<string, ContractValueObject>;
    const contractWithAddress = (codecId: string, dataType: string) =>
      contractWith(
        { user: table({ id: col('t/int4', 't/int4@1'), address: col(dataType, codecId) }) },
        { models: { User: userModel() }, valueObjects },
      );

    it('is accepted when it uses the codec of the stack’s value-object storage type', () => {
      expect(() =>
        familyInstance('Jsonb').deserializeContract(contractWithAddress('t/jsonb@1', 't/jsonb')),
      ).not.toThrow();
    });

    it('is refused when it uses another codec', () => {
      expect(() =>
        familyInstance('Jsonb').deserializeContract(contractWithAddress('t/text@1', 't/text')),
      ).toThrow(
        `${columnsPath}.address: a value-object column uses codec t/jsonb@1, the codec of the stack's value-object storage type Jsonb, not t/text@1`,
      );
    });

    it('is refused when the stack declares no value-object storage type', () => {
      expect(() =>
        familyInstance(undefined).deserializeContract(contractWithAddress('t/jsonb@1', 't/jsonb')),
      ).toThrow(
        `${columnsPath}.address: a value-object column needs the stack's value-object storage type, and the stack declares none`,
      );
    });
  });
});

describe('every family entry point that takes a contract checks it against the stack', () => {
  const mismatched = () => contractWith({ user: table({ id: col('t/text', 't/int4@1') }) });
  const refusal = `${columnsPath}.id: codec t/int4@1 represents t/int4, not t/text`;
  const driver = blindCast<
    SqlControlDriverInstance<string>,
    'the check runs before the driver is used'
  >({});

  it('verify refuses a column whose codec represents another data type', async () => {
    await expect(
      familyInstance('Jsonb').verify({
        driver,
        contract: mismatched(),
        expectedTargetId: 't',
        contractPath: 'contract.json',
      }),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'CONTRACT.VALIDATION_FAILED', message: refusal }),
    );
  });

  it('verifySchema refuses a column whose codec represents another data type', () => {
    expect(() =>
      familyInstance('Jsonb').verifySchema({
        contract: mismatched(),
        schema: blindCast<
          Parameters<ReturnType<typeof familyInstance>['verifySchema']>[0]['schema'],
          'the check runs before the schema is read'
        >({}),
        strict: false,
        frameworkComponents: [],
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.VALIDATION_FAILED', message: refusal }));
  });
});
