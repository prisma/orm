import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { reportTemporaryValues } from '../../../src/control-api/statements/temporary-values';
import { contractOf } from './statement-fixtures';

const app = asNamespaceId('app');
const destination = contractOf({
  app: {
    models: { User: { fields: ['id', 'email'] } },
    valueObjects: { GeoPoint: ['lat', 'country'] },
  },
});

describe('reportTemporaryValues', () => {
  it('names a field and a value object field as a backfill statement names them, and leaves out storage', () => {
    expect(
      reportTemporaryValues(
        [
          {
            operationIndex: 0,
            subject: { kind: 'field', namespaceId: app, model: 'User', field: 'email' },
            value: "''",
          },
          {
            operationIndex: 1,
            subject: {
              kind: 'valueObjectField',
              namespaceId: app,
              valueObject: 'GeoPoint',
              field: 'country',
            },
            value: '""',
          },
          { operationIndex: 2, subject: { kind: 'storage', name: 'legacy.code' }, value: '0' },
        ],
        destination,
      ),
    ).toEqual([
      { field: 'User.email', value: "''" },
      { field: 'GeoPoint.country', value: '""' },
    ]);
  });

  it('reports a value object field once however many columns it fills', () => {
    const country = {
      kind: 'valueObjectField',
      namespaceId: app,
      valueObject: 'GeoPoint',
      field: 'country',
    } as const;
    expect(
      reportTemporaryValues(
        [0, 1, 2].map((operationIndex) => ({ operationIndex, subject: country, value: '""' })),
        destination,
      ),
    ).toEqual([{ field: 'GeoPoint.country', value: '""' }]);
  });
});
