import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract, field, gen, type } from '../../src/exports/contract-builder';

describe('the type exported by contract-builder', () => {
  it('writes the rewrite the exported field names for a removed preset', () => {
    expect(() => Reflect.get(Reflect.get(field, 'id'), 'uuidv4String')).toThrow(
      'Write field.column(type.sql.UuidString()).id().onCreate(gen.uuid()).',
    );
    const fromCallback = defineContract(
      {},
      ({ field: callbackField, model, type: callbackType, gen: callbackGen }) => ({
        models: {
          Token: model('Token', {
            fields: {
              id: callbackField.column(callbackType.sql.Char(36)).id().onCreate(callbackGen.uuid()),
            },
          }),
        },
      }),
    );
    const fromImport = defineContract({}, ({ model }) => ({
      models: {
        Token: model('Token', {
          fields: { id: field.column(type.sql.Char(36)).id().onCreate(gen.uuid()) },
        }),
      },
    }));
    expect(fromImport.storage).toEqual(fromCallback.storage);
    expect(fromImport.execution).toEqual(fromCallback.execution);
  });

  it('declares a fragment field with the codec of the type constructor', () => {
    const fragmentField = field.column(type.DateTime()).optional().build();
    expect(fragmentField).toMatchObject({
      descriptor: { codecId: 'sqlite/datetime@1' },
      nullable: true,
    });
    expectTypeOf(fragmentField.descriptor?.codecId).toEqualTypeOf<
      'sqlite/datetime@1' | undefined
    >();
  });
});
