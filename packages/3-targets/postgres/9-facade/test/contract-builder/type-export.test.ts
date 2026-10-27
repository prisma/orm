import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract, field, gen, type } from '../../src/exports/contract-builder';

describe('the type exported by contract-builder', () => {
  it('declares a fragment field with the column a TimestamptzTemporal contract field stores', () => {
    const fragmentField = field.column(type.TimestamptzTemporal()).optional().build();
    const contract = defineContract({}, ({ field: callbackField, model, type: callbackType }) => ({
      models: {
        Post: model('Post', {
          fields: {
            id: callbackField.column(callbackType.Int()).id(),
            createdAt: callbackField.column(callbackType.TimestamptzTemporal()).optional(),
          },
        }),
      },
    }));

    expect(fragmentField).toMatchObject({
      descriptor: { codecId: 'pg/timestamptz-temporal@1' },
      nullable: true,
    });
    expect(
      contract.storage.namespaces['public']?.entries.table['Post']?.columns['createdAt'],
    ).toEqual({
      codecId: fragmentField.descriptor?.codecId,
      dataType: 'pg/timestamptz',
      many: false,
      nullable: true,
    });
    expectTypeOf(fragmentField.descriptor?.codecId).toEqualTypeOf<
      'pg/timestamptz-temporal@1' | undefined
    >();
  });

  it('builds the same contract as the type of the callback', () => {
    const fromCallback = defineContract(
      {},
      ({ field: callbackField, model, type: callbackType, gen: callbackGen }) => ({
        models: {
          Token: model('Token', {
            fields: {
              id: callbackField.column(callbackType.Char(36)).id().onCreate(callbackGen.uuid()),
            },
          }),
        },
      }),
    );
    const fromImport = defineContract({}, ({ model }) => ({
      models: {
        Token: model('Token', {
          fields: { id: field.column(type.Char(36)).id().onCreate(gen.uuid()) },
        }),
      },
    }));
    expect(fromImport.storage).toEqual(fromCallback.storage);
    expect(fromImport.execution).toEqual(fromCallback.execution);
  });
});
