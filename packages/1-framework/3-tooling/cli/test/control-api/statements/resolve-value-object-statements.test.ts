import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { resolveStatements } from '../../../src/control-api/statements/resolve-statements';
import type { StatementText } from '../../../src/control-api/statements/statement-text';
import { contractOf, expectFailure, expectValue } from './statement-fixtures';

const UNRESOLVED = 'MIGRATION.STATEMENT_UNRESOLVED';
const INVALID = 'MIGRATION.STATEMENT_INVALID';

const app = asNamespaceId('app');
const rename = (text: string): StatementText => ({ verb: 'rename', text });
const backfill = (text: string): StatementText => ({ verb: 'backfill', text });
const convert = (text: string): StatementText => ({ verb: 'convert', text });

const place = { fields: ['id', 'location'], fieldTypes: { location: { valueObject: 'GeoPoint' } } };
const origin = contractOf({
  app: { models: { Place: place }, valueObjects: { GeoPoint: ['lat', 'lng', 'label?'] } },
});
const destination = contractOf({
  app: {
    models: { Place: place },
    valueObjects: { GeoPoint: ['latitude', 'lng', 'label', 'country'] },
  },
});

function resolve(
  statements: readonly StatementText[],
  from: ReturnType<typeof contractOf> = origin,
  to: ReturnType<typeof contractOf> = destination,
) {
  return resolveStatements({
    statements,
    origin: { kind: 'contract', contract: from },
    destination: to,
  });
}

const geoPoint = (field: string) => ({ namespaceId: app, valueObject: 'GeoPoint', field });

describe('resolveStatements, value object field renames', () => {
  it('reads ValueObject.field and namespace.ValueObject.field as a field of the value object', () => {
    const expected = [
      {
        kind: 'rename',
        entity: 'valueObjectField',
        from: geoPoint('lat'),
        to: geoPoint('latitude'),
      },
    ];
    expect([
      expectValue(resolve([rename('GeoPoint.lat:GeoPoint.latitude')])),
      expectValue(resolve([rename('app.GeoPoint.lat:app.GeoPoint.latitude')])),
    ]).toEqual([expected, expected]);
  });

  it('refuses a field the destination value object still has', () => {
    expectFailure(
      resolve([rename('GeoPoint.lng:GeoPoint.latitude')]),
      UNRESOLVED,
      'The field "lng" still exists in the destination value object "GeoPoint", so it was not renamed.',
    );
  });

  it('refuses a new name the origin value object already has', () => {
    expectFailure(
      resolve([rename('GeoPoint.lat:GeoPoint.lng')]),
      UNRESOLVED,
      'The field "lng" already exists in the origin value object "GeoPoint", so it cannot be the new name of a field.',
    );
  });

  it('refuses a field that moves to another value object', () => {
    const to = contractOf({
      app: {
        models: { Place: place },
        valueObjects: { GeoPoint: ['lng'], Coordinates: ['latitude'] },
      },
    });
    expectFailure(
      resolve([rename('GeoPoint.lat:Coordinates.latitude')], origin, to),
      INVALID,
      'The old name is a field of value object "GeoPoint" and the new name a field of value object "Coordinates"; a field cannot move between value objects.',
    );
  });

  it('refuses a field the value object does not have, listing its fields', () => {
    expectFailure(
      resolve([rename('GeoPoint.altitude:GeoPoint.latitude')]),
      UNRESOLVED,
      'The origin value object "GeoPoint" has no field "altitude" (fields: label, lat, lng)',
    );
  });

  it('refuses renaming one field twice', () => {
    expectFailure(
      resolve([rename('GeoPoint.lat:GeoPoint.latitude'), rename('GeoPoint.lat:GeoPoint.country')]),
      INVALID,
      'An earlier statement already renames "app.GeoPoint.lat".',
    );
  });

  it('refuses a name that reads both as a value object field and as an enum value, naming each', () => {
    const from = contractOf({
      app: { enums: { Status: ['OPEN', 'ARCHIVED'] } },
      billing: { valueObjects: { Status: ['ARCHIVED'] } },
    });
    const to = contractOf({
      app: { enums: { Status: ['OPEN', 'RETIRED'] } },
      billing: { valueObjects: { Status: ['RETIRED'] } },
    });
    expectFailure(
      resolve([rename('Status.ARCHIVED:Status.RETIRED')], from, to),
      UNRESOLVED,
      '"Status.ARCHIVED" resolves both as enum "Status" value "ARCHIVED" and as value object "Status" field "ARCHIVED"',
      'Name it with its namespace: app.Status.ARCHIVED for the enum value, billing.Status.ARCHIVED for the value object field.',
    );
  });
});

describe('resolveStatements, value object field backfills', () => {
  it('resolves a field required in the destination value object and absent from the origin one', () => {
    expect(expectValue(resolve([backfill('GeoPoint.country')]))).toEqual([
      { kind: 'backfill', entity: 'valueObjectField', field: geoPoint('country') },
    ]);
  });

  it('resolves a field optional in the origin value object, and one renamed by a statement', () => {
    const to = contractOf({
      app: { models: { Place: place }, valueObjects: { GeoPoint: ['lat', 'lng', 'title'] } },
    });
    expect([
      expectValue(resolve([backfill('app.GeoPoint.label')])),
      expectValue(
        resolve([rename('GeoPoint.label:GeoPoint.title'), backfill('GeoPoint.title')], origin, to),
      ).at(1),
    ]).toEqual([
      [{ kind: 'backfill', entity: 'valueObjectField', field: geoPoint('label') }],
      { kind: 'backfill', entity: 'valueObjectField', field: geoPoint('title') },
    ]);
  });

  it('refuses a field already required in the origin value object', () => {
    expectFailure(
      resolve([backfill('GeoPoint.lng')]),
      UNRESOLVED,
      'The field "GeoPoint.lng" is already required in the origin contract, so every existing value has it',
      'Leave out --backfill GeoPoint.lng.',
    );
  });

  it('refuses a field optional in the destination value object', () => {
    const to = contractOf({
      app: { models: { Place: place }, valueObjects: { GeoPoint: ['lat', 'lng', 'country?'] } },
    });
    expectFailure(
      resolve([backfill('GeoPoint.country')], origin, to),
      UNRESOLVED,
      'The field "GeoPoint.country" is optional in the destination contract',
    );
  });

  it('refuses a value object the origin does not have', () => {
    const to = contractOf({
      app: { models: { Place: place }, valueObjects: { GeoPoint: ['lat'], Address: ['city'] } },
    });
    expectFailure(
      resolve([backfill('Address.city')], origin, to),
      UNRESOLVED,
      'The origin contract has no value object "Address", so no existing value lacks the field',
    );
  });

  it('refuses a convert of a value object field', () => {
    expectFailure(
      resolve([convert('GeoPoint.lng')]),
      UNRESOLVED,
      '"GeoPoint" is a value object; a --convert statement names a field of a model or a variant',
    );
  });
});
