import { textColumn } from '@internal/adapter-postgres/column-types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract, field } from '../../src/exports/contract-builder';

describe('the field exported by contract-builder', () => {
  it('has the presets the defineContract callback receives', () => {
    expect(field.text().build()).toMatchObject({
      descriptor: { codecId: 'pg/text@1' },
      nullable: false,
    });
    expect(field.temporal.timestamptz().optional().build()).toMatchObject({
      descriptor: { codecId: 'pg/timestamptz-temporal@1' },
      nullable: true,
    });
    expect(field.uuidString().build()).toMatchObject({
      descriptor: { codecId: 'sql/char@1', typeParams: { length: 36 } },
      nullable: false,
    });
    expectTypeOf(field.text().build().descriptor?.codecId).toEqualTypeOf<'pg/text@1' | undefined>();
    expectTypeOf(field.temporal.timestamptz().optional().build().nullable).toEqualTypeOf<true>();
  });

  it('keeps field.column as the explicit form', () => {
    expect(field.column(textColumn).optional().build()).toMatchObject({
      descriptor: { codecId: 'pg/text@1' },
      nullable: true,
    });
  });

  it('builds the same contract as the field of the callback', () => {
    const fromCallback = defineContract({}, ({ field: callbackField, model }) => ({
      models: {
        Post: model('Post', {
          fields: { id: callbackField.uuidString(), title: callbackField.text() },
        }),
      },
    }));
    const fromImport = defineContract({}, ({ model }) => ({
      models: {
        Post: model('Post', { fields: { id: field.uuidString(), title: field.text() } }),
      },
    }));
    expect(fromImport.storage).toEqual(fromCallback.storage);
  });
});
