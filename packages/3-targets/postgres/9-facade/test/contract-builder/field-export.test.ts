import { textColumn } from '@internal/adapter-postgres/column-types';
import { describe, expect, it } from 'vitest';
import { defineContract, field, type } from '../../src/exports/contract-builder';

describe('the field exported by contract-builder', () => {
  it('declares a column with field.column', () => {
    expect(field.column(textColumn).optional().build()).toMatchObject({
      descriptor: { codecId: 'pg/text@1' },
      nullable: true,
    });
  });

  it('builds the same contract as the field of the callback', () => {
    const fromCallback = defineContract({}, ({ field: callbackField, model, type: t }) => ({
      models: {
        Post: model('Post', {
          fields: {
            id: callbackField.column(t.Char(36)).id(),
            title: callbackField.column(t.String()),
          },
        }),
      },
    }));
    const fromImport = defineContract({}, ({ model }) => ({
      models: {
        Post: model('Post', {
          fields: {
            id: field.column(type.Char(36)).id(),
            title: field.column(type.String()),
          },
        }),
      },
    }));
    expect(fromImport.storage).toEqual(fromCallback.storage);
  });
});
