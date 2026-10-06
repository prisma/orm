import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { defineContract } from '@internal/postgres/contract-builder';
import { describe, expect, it } from 'vitest';
import { pgGeometryColumn } from '../src/core/codecs';
import { geometry } from '../src/exports/column-types';
import postgis from '../src/exports/pack';

function buildWithLocation(descriptor: ColumnTypeDescriptor) {
  return defineContract({ extensions: { postgis } }, ({ field, model }) => ({
    models: {
      Place: model('Place', {
        fields: { id: field.id.uuidv4String(), location: field.column(descriptor) },
      }),
    },
  }));
}

describe('geometry column type parameters', () => {
  it.each([
    ['pgGeometryColumn({ srid: 0 })', pgGeometryColumn({ srid: 0 })],
    ['geometry({ srid: 0 })', geometry({ srid: 0 })],
  ])('%s fails when the contract is built', (_, descriptor) => {
    expect(() => buildWithLocation(descriptor)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPE_PARAMS_INVALID',
        meta: {
          dataType: 'postgis/geometry',
          parameters: ['srid'],
          modelName: 'Place',
          fieldName: 'location',
        },
      }),
    );
  });

  it('builds a geometry column whose srid the data type accepts', () => {
    expect(() => buildWithLocation(pgGeometryColumn({ srid: 4326 }))).not.toThrow();
  });
});
