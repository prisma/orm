import { asNamespaceId } from '@internal/contract/types';
import type {
  ResolvedNamespaceRenameStatement,
  ResolvedValueObjectFieldRenameStatement,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { planValueObjectFieldRewrites } from '../src/core/migrations/value-object-field-planning';
import {
  allTables,
  contractWith,
  field,
  tablesOf,
  type ValueObjectFieldSpec,
} from './value-object-contract-fixtures';

function renameField(
  valueObject: string,
  from: string,
  to: string,
  namespace = 'app',
): ResolvedValueObjectFieldRenameStatement {
  const namespaceId = asNamespaceId(namespace);
  return {
    kind: 'rename',
    entity: 'valueObjectField',
    from: { namespaceId, valueObject, field: from },
    to: { namespaceId, valueObject, field: to },
  };
}

function rewrites(result: ReturnType<typeof planValueObjectFieldRewrites>) {
  if (!result.ok) throw new Error(`expected rewrites, got: ${result.failure.summary}`);
  return result.value;
}

function refusal(result: ReturnType<typeof planValueObjectFieldRewrites>) {
  if (result.ok) throw new Error('expected a refusal');
  return result.failure;
}

const place = { model: 'Place', table: 'place', field: 'location', valueObject: 'GeoPoint' };
const GEO = { lat: 'scalar', lng: 'scalar' } as const;
const GEO_RENAMED = { latitude: 'scalar', lng: 'scalar' } as const;

describe('planValueObjectFieldRewrites', () => {
  it('renames the key in a column that holds the value object, at the column value', () => {
    const statement = renameField('GeoPoint', 'lat', 'latitude');
    expect(
      rewrites(
        planValueObjectFieldRewrites({
          statements: [statement],
          fromContract: contractWith({ valueObjects: { GeoPoint: GEO }, columns: [place] }),
          contract: contractWith({ valueObjects: { GeoPoint: GEO_RENAMED }, columns: [place] }),
          tables: allTables(),
        }),
      ),
    ).toEqual([
      {
        valueObjectField: field('GeoPoint', 'lat'),
        namespaceId: 'app',
        table: 'place',
        column: 'location',
        path: '$.lat',
        to: 'latitude',
        statement,
      },
    ]);
  });

  it('renames the key in every element of a list of the value object, and in every column', () => {
    const stops = {
      model: 'Trip',
      table: 'trip',
      field: 'stops',
      valueObject: 'GeoPoint',
      many: true,
    };
    const columns = [place, stops];
    const result = rewrites(
      planValueObjectFieldRewrites({
        statements: [renameField('GeoPoint', 'lat', 'latitude')],
        fromContract: contractWith({ valueObjects: { GeoPoint: GEO }, columns }),
        contract: contractWith({ valueObjects: { GeoPoint: GEO_RENAMED }, columns }),
        tables: allTables(),
      }),
    );
    expect(result.map(({ table, column, path }) => ({ table, column, path }))).toEqual([
      { table: 'place', column: 'location', path: '$.lat' },
      { table: 'trip', column: 'stops', path: '$[*].lat' },
    ]);
  });

  it('reaches the value object through nested value objects and lists of them', () => {
    const history = { model: 'Place', table: 'place', field: 'history', valueObject: 'Visit' };
    const valueObjects = (geo: Readonly<Record<string, ValueObjectFieldSpec>>) => ({
      GeoPoint: geo,
      Visit: { stops: { valueObject: 'Stop', many: true }, point: { valueObject: 'GeoPoint' } },
      Stop: { point: { valueObject: 'GeoPoint' } },
    });
    const result = rewrites(
      planValueObjectFieldRewrites({
        statements: [],
        fromContract: contractWith({ valueObjects: valueObjects(GEO), columns: [history] }),
        contract: contractWith({
          valueObjects: valueObjects({ lng: 'scalar' }),
          columns: [history],
        }),
        tables: allTables(),
      }),
    );
    expect(result.map(({ path, to, statement }) => ({ path, to, statement }))).toEqual([
      { path: '$.point.lat', to: undefined, statement: undefined },
      { path: '$.stops[*].point.lat', to: undefined, statement: undefined },
    ]);
  });

  it('runs an outer rename before an inner one, and writes the inner path with the outer new name', () => {
    const address = { model: 'Shop', table: 'shop', field: 'address', valueObject: 'Address' };
    const outer = renameField('Address', 'point', 'location');
    const inner = renameField('GeoPoint', 'lat', 'latitude');
    const result = rewrites(
      planValueObjectFieldRewrites({
        statements: [inner, outer],
        fromContract: contractWith({
          valueObjects: { GeoPoint: GEO, Address: { point: { valueObject: 'GeoPoint' } } },
          columns: [address],
        }),
        contract: contractWith({
          valueObjects: {
            GeoPoint: GEO_RENAMED,
            Address: { location: { valueObject: 'GeoPoint' } },
          },
          columns: [address],
        }),
        tables: allTables(),
      }),
    );
    expect(result.map(({ path, to, statement }) => ({ path, to, statement }))).toEqual([
      { path: '$.point', to: 'location', statement: outer },
      { path: '$.location.lat', to: 'latitude', statement: inner },
    ]);
  });

  it('writes a column renamed in the same plan under its new name, and skips a column the plan adds', () => {
    const renamed = { ...place, column: 'where' };
    const added = { model: 'Trip', table: 'trip', field: 'start', valueObject: 'GeoPoint' };
    const result = rewrites(
      planValueObjectFieldRewrites({
        statements: [],
        fromContract: contractWith({ valueObjects: { GeoPoint: GEO }, columns: [place] }),
        contract: contractWith({
          valueObjects: { GeoPoint: { lng: 'scalar' } },
          columns: [renamed, added],
        }),
        tables: tablesOf(['app.place.where']),
      }),
    );
    expect(result.map(({ table, column, path }) => ({ table, column, path }))).toEqual([
      { table: 'place', column: 'where', path: '$.lat' },
    ]);
  });

  it('removes a field the destination value object lacks and no statement renames', () => {
    expect(
      rewrites(
        planValueObjectFieldRewrites({
          statements: [],
          fromContract: contractWith({ valueObjects: { GeoPoint: GEO }, columns: [place] }),
          contract: contractWith({
            valueObjects: { GeoPoint: { lat: 'scalar' } },
            columns: [place],
          }),
          tables: allTables(),
        }),
      ),
    ).toEqual([
      {
        valueObjectField: field('GeoPoint', 'lng'),
        namespaceId: 'app',
        table: 'place',
        column: 'location',
        path: '$.lng',
        to: undefined,
        statement: undefined,
      },
    ]);
  });

  it('plans nothing for a new field, a value object no column holds, or a table it does not manage', () => {
    const external = { ...place, control: 'external' as const };
    expect(
      rewrites(
        planValueObjectFieldRewrites({
          statements: [],
          fromContract: contractWith({
            valueObjects: { GeoPoint: GEO, Unused: { a: 'scalar' } },
            columns: [external],
          }),
          contract: contractWith({
            valueObjects: { GeoPoint: { lat: 'scalar' }, Unused: { b: 'scalar' } },
            columns: [external],
          }),
          tables: allTables(),
        }),
      ),
    ).toEqual([]);
    expect(
      rewrites(
        planValueObjectFieldRewrites({
          statements: [],
          fromContract: contractWith({ valueObjects: { GeoPoint: GEO }, columns: [place] }),
          contract: contractWith({
            valueObjects: { GeoPoint: { ...GEO, alt: 'scalar' } },
            columns: [place],
          }),
          tables: allTables(),
        }),
      ),
    ).toEqual([]);
  });

  it('plans nothing without an origin contract, or for a value object the destination lacks', () => {
    const contract = contractWith({ valueObjects: { GeoPoint: GEO }, columns: [place] });
    expect(
      rewrites(
        planValueObjectFieldRewrites({
          statements: [],
          fromContract: null,
          contract,
          tables: allTables(),
        }),
      ),
    ).toEqual([]);
    expect(
      rewrites(
        planValueObjectFieldRewrites({
          statements: [],
          fromContract: contract,
          contract: contractWith({ valueObjects: {}, columns: [] }),
          tables: allTables(),
        }),
      ),
    ).toEqual([]);
  });

  it('follows a namespace rename to the value object in its new namespace', () => {
    const namespaceRename: ResolvedNamespaceRenameStatement = {
      kind: 'rename',
      entity: 'namespace',
      from: asNamespaceId('app'),
      to: asNamespaceId('geo'),
    };
    const result = rewrites(
      planValueObjectFieldRewrites({
        statements: [namespaceRename],
        fromContract: contractWith({ valueObjects: { GeoPoint: GEO }, columns: [place] }),
        contract: contractWith({
          valueObjects: { GeoPoint: { lat: 'scalar' } },
          columns: [place],
          namespace: 'geo',
        }),
        tables: allTables(),
      }),
    );
    expect(
      result.map(({ valueObjectField, namespaceId, path }) => ({
        valueObjectField,
        namespaceId,
        path,
      })),
    ).toEqual([{ valueObjectField: field('GeoPoint', 'lng'), namespaceId: 'geo', path: '$.lng' }]);
  });

  describe('refuses', () => {
    const nav = {
      model: 'Menu',
      table: 'menu',
      field: 'items',
      valueObject: 'NavItem',
      many: true,
    };
    const navObjects = (label: Readonly<Record<string, ValueObjectFieldSpec>>) => ({
      NavItem: {
        children: { valueObject: 'NavItem', many: true },
        label: { valueObject: 'Label' },
      },
      Label: label,
    });

    it('a rename whose path passes through a value object that contains itself, as the statement', () => {
      const statement = renameField('Label', 'text', 'caption');
      const conflict = refusal(
        planValueObjectFieldRewrites({
          statements: [statement],
          fromContract: contractWith({
            valueObjects: navObjects({ text: 'scalar' }),
            columns: [nav],
          }),
          contract: contractWith({
            valueObjects: navObjects({ caption: 'scalar' }),
            columns: [nav],
          }),
          tables: allTables(),
        }),
      );
      expect(conflict).toEqual({
        kind: 'statementRefused',
        summary:
          'Cannot rename value object field "Label.text" to "Label.caption": column "items" of "menu" holds it inside value object "NavItem", which contains itself, so the JSON can hold it at any depth',
        why: 'The plan rewrites a key at every path from a column to its value object, and a value object that contains itself has no last path. Leave out this statement, and rewrite the JSON of column "items" of "menu" yourself in the migration.ts a plan without it writes.',
        refusedStatement: statement,
      });
    });

    it('a removal whose path passes through a value object that contains itself, as a plain conflict', () => {
      const conflict = refusal(
        planValueObjectFieldRewrites({
          statements: [],
          fromContract: contractWith({
            valueObjects: navObjects({ text: 'scalar', icon: 'scalar' }),
            columns: [nav],
          }),
          contract: contractWith({ valueObjects: navObjects({ text: 'scalar' }), columns: [nav] }),
          tables: allTables(),
        }),
      );
      expect(conflict).toMatchObject({
        kind: 'unsupportedOperation',
        summary:
          'Cannot remove value object field "Label.icon": column "items" of "menu" holds it inside value object "NavItem", which contains itself, so the JSON can hold it at any depth',
      });
      expect(conflict).not.toHaveProperty('refusedStatement');
    });

    it('a change to the value object that contains itself', () => {
      const conflict = refusal(
        planValueObjectFieldRewrites({
          statements: [],
          fromContract: contractWith({
            valueObjects: {
              NavItem: { children: { valueObject: 'NavItem', many: true }, title: 'scalar' },
            },
            columns: [nav],
          }),
          contract: contractWith({
            valueObjects: { NavItem: { children: { valueObject: 'NavItem', many: true } } },
            columns: [nav],
          }),
          tables: allTables(),
        }),
      );
      expect(conflict.summary).toContain('inside value object "NavItem", which contains itself');
    });

    it('a column that holds a union or a dictionary of the value object, naming the column', () => {
      for (const shape of ['union', 'dictionary'] as const) {
        const statement = renameField('GeoPoint', 'lat', 'latitude');
        const column = { ...place, shape };
        const conflict = refusal(
          planValueObjectFieldRewrites({
            statements: [statement],
            fromContract: contractWith({ valueObjects: { GeoPoint: GEO }, columns: [column] }),
            contract: contractWith({ valueObjects: { GeoPoint: GEO_RENAMED }, columns: [column] }),
            tables: allTables(),
          }),
        );
        expect(conflict).toMatchObject({
          kind: 'statementRefused',
          summary: `Cannot rename value object field "GeoPoint.lat" to "GeoPoint.latitude": column "location" of "place" holds a ${shape} of value objects`,
          refusedStatement: statement,
        });
      }
    });

    it('nothing for a value object that contains itself when the change does not reach it', () => {
      expect(
        rewrites(
          planValueObjectFieldRewrites({
            statements: [],
            fromContract: contractWith({
              valueObjects: { ...navObjects({ text: 'scalar' }), GeoPoint: GEO },
              columns: [nav, place],
            }),
            contract: contractWith({
              valueObjects: { ...navObjects({ text: 'scalar' }), GeoPoint: { lat: 'scalar' } },
              columns: [nav, place],
            }),
            tables: allTables(),
          }),
        ).map(({ path }) => path),
      ).toEqual(['$.lng']);
    });
  });
});
