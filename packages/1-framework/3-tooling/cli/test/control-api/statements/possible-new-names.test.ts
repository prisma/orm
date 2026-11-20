import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { possibleNewNames } from '../../../src/control-api/statements/possible-new-names';
import { contractOf } from './statement-fixtures';

const app = asNamespaceId('app');

describe('the new names a removed enum value can have', () => {
  it('leave out a member another rename gives in the same enum only', () => {
    const context = {
      origin: contractOf({ app: { enums: { Phase: ['OLD', 'GONE'], Status: ['OLD'] } } }),
      destination: contractOf({ app: { enums: { Phase: ['NEW'], Status: ['NEW'] } } }),
      renames: [
        {
          kind: 'rename',
          entity: 'enumValue',
          from: { namespaceId: app, enum: 'Phase', member: 'OLD' },
          to: { namespaceId: app, enum: 'Phase', member: 'NEW' },
        },
      ] as const,
    };

    expect({
      phase: possibleNewNames(
        { kind: 'enumValue', namespaceId: app, enum: 'Phase', member: 'GONE' },
        context,
      ),
      status: possibleNewNames(
        { kind: 'enumValue', namespaceId: app, enum: 'Status', member: 'OLD' },
        context,
      ),
    }).toEqual({ phase: [], status: ['NEW'] });
  });
});

describe('the new names a removed value object field can have', () => {
  it('leave out a field another rename gives in the same value object only', () => {
    const context = {
      origin: contractOf({
        app: { valueObjects: { Address: ['note', 'gone'], GeoPoint: ['note'] } },
      }),
      destination: contractOf({
        app: { valueObjects: { Address: ['label'], GeoPoint: ['label'] } },
      }),
      renames: [
        {
          kind: 'rename',
          entity: 'valueObjectField',
          from: { namespaceId: app, valueObject: 'Address', field: 'note' },
          to: { namespaceId: app, valueObject: 'Address', field: 'label' },
        },
      ] as const,
    };

    expect({
      address: possibleNewNames(
        { kind: 'valueObjectField', namespaceId: app, valueObject: 'Address', field: 'gone' },
        context,
      ),
      geoPoint: possibleNewNames(
        { kind: 'valueObjectField', namespaceId: app, valueObject: 'GeoPoint', field: 'note' },
        context,
      ),
    }).toEqual({ address: [], geoPoint: ['label'] });
  });
});
