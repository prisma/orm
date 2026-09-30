import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const refusingJsonb: CodecLookup = {
  get: (id) =>
    id === 'pg/jsonb@1'
      ? {
          id,
          encode: async (value: unknown) => value,
          decode: async (wire: unknown) => wire,
          encodeJson: () => {
            throw new Error('Expected a Money value');
          },
          decodeJson: (json: unknown) => json,
        }
      : undefined,
  targetTypesFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

function lookupOf(codecs: Record<string, Pick<Codec, 'encodeJson'>>): CodecLookup {
  return {
    get: (id) => {
      const codec = codecs[id];
      return codec === undefined
        ? undefined
        : {
            id,
            encode: async (value: unknown) => value,
            decode: async (wire: unknown) => wire,
            decodeJson: (json: unknown) => json,
            ...codec,
          };
    },
    targetTypesFor: () => undefined,
    renderOutputTypeFor: () => undefined,
  };
}

function buildWithDefault(
  field: { readonly codecId: string; readonly value: unknown; readonly many?: boolean },
  codecLookup?: CodecLookup,
) {
  return buildSqlContractFromDefinition(
    {
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [
        {
          modelName: 'Event',
          tableName: 'event',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              fieldName: 'count',
              columnName: 'count',
              descriptor: { codecId: field.codecId, nativeType: 'int8' },
              nullable: false,
              default: { kind: 'literal', value: field.value },
              ...(field.many === true ? { many: true } : {}),
            },
          ],
          id: { columns: ['id'] },
        },
      ],
    },
    codecLookup,
  );
}

function storedDefault(contract: ReturnType<typeof buildWithDefault>): unknown {
  return Object.values(contract.storage.namespaces)[0]?.entries.table?.['event']?.columns['count']
    ?.default;
}

describe('a literal default on a column whose codec the lookup does not hold', () => {
  it('is refused, naming the field and the codec id', () => {
    expect(() => buildWithDefault({ codecId: 'app/counter@1', value: 1 }, lookupOf({}))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Field "Event.count" has a default, but no pack in the contract declares its codec "app/counter@1", so the default cannot be checked. List the pack that owns the codec in `extensions`.',
        meta: {
          modelName: 'Event',
          fieldName: 'count',
          codecId: 'app/counter@1',
          reason: 'codec-not-found',
        },
      }),
    );
  });

  it('is stored as authored when the build is given no lookup at all', () => {
    expect(storedDefault(buildWithDefault({ codecId: 'app/counter@1', value: 1 }))).toEqual({
      kind: 'literal',
      value: 1,
    });
  });
});

describe('a scalar default on a list field', () => {
  it('is refused, naming the field', () => {
    expect(() =>
      buildWithDefault(
        { codecId: 'pg/int8@1', value: 1n, many: true },
        lookupOf({ 'pg/int8@1': { encodeJson: (value) => String(value) } }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Field "Event.count" is a list field, so its default is an array; received bigint. Call .many() before .default().',
        meta: {
          modelName: 'Event',
          fieldName: 'count',
          codecId: 'pg/int8@1',
          reason: 'list-default-not-array',
        },
      }),
    );
  });
});

describe('an internal error thrown while a default is encoded', () => {
  it('is rethrown unchanged', () => {
    const bug = new InternalError('codec bug');
    expect(() =>
      buildWithDefault(
        { codecId: 'pg/int8@1', value: 1n },
        lookupOf({
          'pg/int8@1': {
            encodeJson: () => {
              throw bug;
            },
          },
        }),
      ),
    ).toThrow(bug);
  });
});

describe('a literal default the codec refuses', () => {
  it('names the value-object field and carries the codec message', () => {
    expect(() =>
      buildSqlContractFromDefinition(
        {
          warnings: undefined,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          models: [
            {
              modelName: 'Invoice',
              tableName: 'invoice',
              fields: [
                {
                  fieldName: 'id',
                  columnName: 'id',
                  descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
                  nullable: false,
                },
                {
                  fieldName: 'total',
                  columnName: 'total',
                  valueObjectName: 'Money',
                  nullable: false,
                  default: { kind: 'literal', value: 'twelve' },
                },
              ],
              id: { columns: ['id'] },
            },
          ],
          valueObjects: [
            {
              name: 'Money',
              fields: [
                {
                  fieldName: 'amount',
                  columnName: 'amount',
                  descriptor: { codecId: 'pg/int8@1', nativeType: 'int8' },
                  nullable: false,
                },
              ],
            },
          ],
        },
        refusingJsonb,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Field "Invoice.total" has a default that its codec refuses: Expected a Money value',
        meta: {
          modelName: 'Invoice',
          fieldName: 'total',
          codecId: 'pg/jsonb@1',
          reason: 'codec-refused-default',
        },
      }),
    );
  });
});
