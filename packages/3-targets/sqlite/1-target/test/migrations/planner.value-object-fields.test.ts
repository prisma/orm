import { asNamespaceId } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  conflictsOf,
  type MemberSpec,
  placeContract,
  plan,
  rename,
  renderedCalls,
  succeeded,
} from './value-object-planner-fixtures';

const GEO = { lat: 'scalar', lng: 'scalar' } as const;
const GEO_RENAMED = { latitude: 'scalar', lng: 'scalar' } as const;
const location = { field: 'location', valueObject: 'GeoPoint' };

describe('SQLite planner, value object fields', () => {
  it('renames the key in a column that holds the value object, and gives the statement its operation', () => {
    const statement = rename('GeoPoint', 'lat', 'latitude');
    const result = succeeded(
      plan(
        placeContract({ GeoPoint: GEO }, [location], 'from'),
        placeContract({ GeoPoint: GEO_RENAMED }, [location], 'to'),
        [statement],
      ),
    );
    expect(renderedCalls(result)).toEqual([
      'this.renameStoredKey({ table: "place", column: "location", path: "$.lat", to: "latitude" })',
    ]);
    expect(result.appliedStatements).toEqual([{ statement, operationIndexes: [0] }]);
    expect(result.dataLoss).toEqual([]);
  });

  it('renames the key in every element of a list column', () => {
    const stops = { field: 'stops', valueObject: 'GeoPoint', many: true };
    expect(
      renderedCalls(
        plan(
          placeContract({ GeoPoint: GEO }, [stops], 'from'),
          placeContract({ GeoPoint: GEO_RENAMED }, [stops], 'to'),
          [rename('GeoPoint', 'lat', 'latitude')],
        ),
      ),
    ).toEqual([
      'this.renameStoredKey({ table: "place", column: "stops", path: "$[*].lat", to: "latitude" })',
    ]);
  });

  it('renames an outer key before an inner one, writing the inner path with the new outer name', () => {
    const address = { field: 'address', valueObject: 'Address' };
    expect(
      renderedCalls(
        plan(
          placeContract(
            {
              GeoPoint: GEO,
              Address: {
                point: { valueObject: 'GeoPoint' },
                history: { valueObject: 'GeoPoint', many: true },
              },
            },
            [address],
            'from',
          ),
          placeContract(
            {
              GeoPoint: GEO_RENAMED,
              Address: {
                location: { valueObject: 'GeoPoint' },
                history: { valueObject: 'GeoPoint', many: true },
              },
            },
            [address],
            'to',
          ),
          [rename('GeoPoint', 'lat', 'latitude'), rename('Address', 'point', 'location')],
        ),
      ),
    ).toEqual([
      'this.renameStoredKey({ table: "place", column: "address", path: "$.point", to: "location" })',
      'this.renameStoredKey({ table: "place", column: "address", path: "$.location.lat", to: "latitude" })',
      'this.renameStoredKey({ table: "place", column: "address", path: "$.history[*].lat", to: "latitude" })',
    ]);
  });

  it('writes the key rename under the new name of a column the same plan renames', () => {
    const result = plan(
      placeContract({ GeoPoint: GEO }, [location], 'from'),
      placeContract({ GeoPoint: GEO_RENAMED }, [{ ...location, field: 'where' }], 'to'),
      [
        {
          kind: 'rename',
          entity: 'field',
          from: {
            namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
            model: 'Place',
            field: 'location',
          },
          to: { namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID), model: 'Place', field: 'where' },
        },
        rename('GeoPoint', 'lat', 'latitude'),
      ],
    );
    expect(renderedCalls(result)).toEqual([
      'this.renameStoredKey({ table: "place", column: "where", path: "$.lat", to: "latitude" })',
    ]);
  });

  it('removes a field the destination lacks, and names the value object field as the subject', async () => {
    const result = succeeded(
      plan(
        placeContract({ GeoPoint: GEO }, [location], 'from'),
        placeContract({ GeoPoint: { lat: 'scalar' } }, [location], 'to'),
      ),
    );
    expect(renderedCalls(result)).toEqual([
      'this.removeStoredKey({ table: "place", column: "location", path: "$.lng" })',
    ]);
    const ops = await Promise.all(result.plan.operations);
    expect(result.dataLoss).toEqual([
      {
        operationIndex: ops.findIndex((op) => op.label.startsWith('Remove key')),
        subject: {
          kind: 'valueObjectField',
          namespaceId: UNBOUND_NAMESPACE_ID,
          valueObject: 'GeoPoint',
          field: 'lng',
        },
        loss: 'drop',
        label: 'Remove key "lng" at path "$" in column "location" of "place"',
      },
    ]);
  });

  it('refuses a removal under a policy that does not allow destructive operations', () => {
    const conflicts = conflictsOf(
      plan(
        placeContract({ GeoPoint: GEO }, [location], 'from'),
        placeContract({ GeoPoint: { lat: 'scalar' } }, [location], 'to'),
        [],
        { allowedOperationClasses: ['additive', 'widening'] },
      ),
    );
    expect(conflicts.map(({ summary }) => summary)).toEqual([
      'Operation "Remove key "lng" at path "$" in column "location" of "place"" requires class "destructive", but policy allows only: additive, widening',
    ]);
  });

  it('refuses a rename through a value object that contains itself', () => {
    const items = { field: 'items', valueObject: 'NavItem', many: true };
    const nav = (label: Readonly<Record<string, MemberSpec>>) => ({
      NavItem: {
        children: { valueObject: 'NavItem', many: true },
        label: { valueObject: 'Label' },
      },
      Label: label,
    });
    const statement = rename('Label', 'text', 'caption');
    expect(
      conflictsOf(
        plan(
          placeContract(nav({ text: 'scalar' }), [items], 'from'),
          placeContract(nav({ caption: 'scalar' }), [items], 'to'),
          [statement],
        ),
      ),
    ).toMatchObject([{ kind: 'statementRefused', refusedStatement: statement }]);
  });

  it('refuses a rename in a column that holds a union of value objects', () => {
    const union = { ...location, union: true };
    expect(
      conflictsOf(
        plan(
          placeContract({ GeoPoint: GEO }, [union], 'from'),
          placeContract({ GeoPoint: GEO_RENAMED }, [union], 'to'),
          [rename('GeoPoint', 'lat', 'latitude')],
        ),
      ),
    ).toMatchObject([
      {
        summary: expect.stringContaining(
          'column "location" of "place" holds a union of value objects',
        ),
      },
    ]);
  });
});
