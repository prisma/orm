import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  appliedStatementsInOrder,
  backfillOfDefaultedField,
  fieldStatementColumns,
  planStatements,
} from '../src/core/migrations/statement-planning';
import { ALL_CLASSES, contractOf, fakeTarget, planned } from './statement-fixtures';

const app = asNamespaceId('app');
const contract = contractOf({
  Place: { table: 'place', fields: { id: 'id', location: 'location' } },
  Bug: { table: 'bug', fields: { id: 'id', type: 'type' } },
});

describe('a value object field rename', () => {
  it('plans no call among the renames', () => {
    expect(
      planned(
        planStatements({
          statements: [
            {
              kind: 'rename',
              entity: 'valueObjectField',
              from: { namespaceId: app, valueObject: 'GeoPoint', field: 'lat' },
              to: { namespaceId: app, valueObject: 'GeoPoint', field: 'latitude' },
            },
          ],
          fromContract: contract,
          contract,
          policy: ALL_CLASSES,
          target: fakeTarget(['app.Place']),
        }),
      ),
    ).toMatchObject({ calls: [], appliedStatements: [{ operationIndexes: [] }] });
  });
});

describe('a value object member backfill and a variant convert', () => {
  const memberBackfill = {
    kind: 'backfill',
    entity: 'valueObjectField',
    field: { namespaceId: app, valueObject: 'Place', field: 'location' },
  } as const;
  const variantConvert = {
    kind: 'convert',
    entity: 'model',
    model: { namespaceId: app, model: 'Bug' },
  } as const;

  it('name no column for the field strategies', () => {
    expect(fieldStatementColumns([memberBackfill, variantConvert], contract)).toEqual({
      convert: [],
      backfill: [],
    });
  });

  it('are not refused as a backfill of a defaulted field', () => {
    expect(backfillOfDefaultedField([memberBackfill], contract, contract)).toBeUndefined();
  });

  it('account for no operations yet', () => {
    expect(appliedStatementsInOrder([memberBackfill, variantConvert], [])).toEqual([
      { statement: memberBackfill, operationIndexes: [] },
      { statement: variantConvert, operationIndexes: [] },
    ]);
  });
});
