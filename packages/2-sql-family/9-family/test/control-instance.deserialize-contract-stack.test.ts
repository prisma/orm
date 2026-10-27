import type { ContractModel, ContractValueObject } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
} from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlDataType, sqlRawDataType } from '@internal/sql-contract/data-type';
import { col, model, table } from '@internal/sql-contract/factories';
import type {
  SqlControlDriverInstance,
  SqlStorage,
  StorageTable,
} from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { createContract } from '@repo/test-utils';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { createSqlFamilyInstance } from '../src/core/control-instance';

const int4 = sqlDataType('t/int4', {
  read: (json) => json,
  texts: [{ text: 'int4', written: true }],
});
const jsonb = sqlDataType('t/jsonb', {
  read: (json) => json,
  texts: [{ text: 'jsonb', written: true }],
});
const text = sqlDataType('t/text', {
  read: (json) => json,
  texts: [{ text: 'text', written: true }],
});
/** Two fraction digits under a scale of 2, as PostgreSQL prints a numeric(10,2) value. */
const numeric = sqlDataType('t/numeric', {
  read: (json, params) => {
    if (params['scale'] === 2 && !/^-?\d+\.\d{2}$/.test(String(json))) {
      throw new Error(
        `t/numeric JSON value must have two fraction digits, got ${JSON.stringify(json)}`,
      );
    }
    return json;
  },
  params: type({ 'precision?': 'number', 'scale?': 'number' }),
  texts: [
    { text: 'numeric', written: true },
    { text: 'numeric({precision},{scale})', written: true },
  ],
});

const codecDataTypes: Readonly<Record<string, AnyCodecDescriptor['dataType']>> = {
  't/int4@1': int4.id,
  't/jsonb@1': jsonb.id,
  't/text@1': text.id,
  't/numeric@1': numeric.id,
  'sql/raw@1': sqlRawDataType.id,
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
    dataTypes: {
      entries: {},
      lookup: createDataTypeLookup([int4, jsonb, text, numeric, sqlRawDataType]),
      dataTypeOfCodec: (codecId: string) => codecDataTypes[codecId],
    },
    declaredDataTypes: [],
    codecDescriptors: [],
    controlMutationDefaults: {
      defaultFunctionRegistry: new Map(),
      generatorDescriptors: [],
      defaultFunctionPrintersByGenerator: new Map(),
      componentIdsByGenerator: new Map(),
    },
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

  describe('a literal default', () => {
    const priced = (
      value: unknown,
      typeParams: Record<string, unknown> = { precision: 10, scale: 2 },
    ) =>
      contractWith({
        user: table({
          id: col('t/int4', 't/int4@1'),
          price: {
            ...col('t/numeric', 't/numeric@1'),
            typeParams,
            default: { kind: 'literal', value },
          } as never,
        }),
      });

    it('is accepted when the column type holds it under the column parameters', () => {
      expect(() => familyInstance('Jsonb').deserializeContract(priced('1.50'))).not.toThrow();
    });

    it('is not read when the column type refuses the column parameters, which the parameters check reports', () => {
      expect(() =>
        familyInstance('Jsonb').deserializeContract(priced('1.5', { precision: 'ten', scale: 2 })),
      ).not.toThrow();
    });

    it('is accepted when it is null, which is SQL NULL', () => {
      expect(() => familyInstance('Jsonb').deserializeContract(priced(null))).not.toThrow();
    });

    it('is refused when the column type does not hold it, naming the table and column, and the namespace in its meta', () => {
      expect(() => familyInstance('Jsonb').deserializeContract(priced('1.5'))).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.VALIDATION_FAILED',
          message: `Table "user", column "price": the default "1.5" is not a value of t/numeric: t/numeric JSON value must have two fraction digits, got "1.5"`,
          meta: {
            refusedDefaults: [
              {
                namespaceId: UNBOUND_NAMESPACE_ID,
                table: 'user',
                column: 'price',
                dataType: 't/numeric',
                value: '1.5',
                message: 't/numeric JSON value must have two fraction digits, got "1.5"',
                reason: 'type-refused-default',
              },
            ],
          },
        }),
      );
    });

    it('is read element by element on a list column', () => {
      const listed = contractWith({
        user: table({
          id: col('t/int4', 't/int4@1'),
          prices: {
            ...col('t/numeric', 't/numeric@1'),
            many: true,
            typeParams: { precision: 10, scale: 2 },
            default: { kind: 'literal', value: ['1.50', '2.5'] },
          } as never,
        }),
      });
      expect(() => familyInstance('Jsonb').deserializeContract(listed)).toThrow(
        expect.objectContaining({
          message: `Table "user", column "prices": the default "2.5" at element 2 is not a value of t/numeric: t/numeric JSON value must have two fraction digits, got "2.5"`,
          meta: {
            refusedDefaults: [
              expect.objectContaining({ column: 'prices', value: '2.5', elementIndex: 1 }),
            ],
          },
        }),
      );
    });

    it('is refused on a raw column, whose data type has no literal values, saying to write sql', () => {
      const raw = contractWith({
        user: table({
          id: col('t/int4', 't/int4@1'),
          area: {
            ...col('sql/raw', 'sql/raw@1'),
            typeParams: { sql: 'circle' },
            default: { kind: 'literal', value: '<(0,0),1>' },
          } as never,
        }),
      });
      expect(() => familyInstance('Jsonb').deserializeContract(raw)).toThrow(
        'Table "user", column "area": the default "<(0,0),1>" is not a value of sql/raw: A raw column has no literal values, so its default cannot be a literal. Write the default as a SQL expression: sql`...`.',
      );
    });

    it('refuses a default that is not a list on a list column', () => {
      const scalar = contractWith({
        user: table({
          id: col('t/int4', 't/int4@1'),
          prices: {
            ...col('t/numeric', 't/numeric@1'),
            many: true,
            typeParams: { precision: 10, scale: 2 },
            default: { kind: 'literal', value: '1.50' },
          } as never,
        }),
      });
      expect(() => familyInstance('Jsonb').deserializeContract(scalar)).toThrow(
        'Table "user", column "prices": the default "1.50" is not a list, and the column holds a list of t/numeric',
      );
    });
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
