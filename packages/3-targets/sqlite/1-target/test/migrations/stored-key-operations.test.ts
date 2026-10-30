import type { JsonValue } from '@internal/contract/types';
import { UnfilledValue } from '@internal/family-sql/control';
import { describe, expect, it } from 'vitest';
import {
  FillStoredKeyCall,
  RemoveStoredKeyCall,
  RenameStoredKeyCall,
} from '../../src/core/migrations/op-factory-call';
import { sqliteTestTypes } from '../sqlite-test-types';
import { placeContract } from './value-object-planner-fixtures';

const REFUSED_PATHS = [
  '$..lat',
  '$.**',
  '$[0]',
  '$[-1]',
  '$[0:2]',
  '$[?@.lat]',
  "$['a','b']",
  'lat',
  '$.9lat',
] as const;

describe('renameStoredKey', () => {
  it('writes the rename only into the rows whose objects hold the key', () => {
    const op = new RenameStoredKeyCall('place', 'history', '$[*].lat', 'latitude').toOp();
    const holdsKey = `(json_type("history") IN ('array', 'object') AND EXISTS (SELECT 1 FROM json_each("history") AS e0 WHERE (json_type(("history" -> e0.fullkey)) = 'object' AND json_type(("history" -> e0.fullkey), '$."lat"') IS NOT NULL)))`;

    expect(op).toEqual({
      id: 'renameStoredKey.place.history.$[*].lat',
      label: 'Rename key "lat" to "latitude" at path "$[*]" in column "history" of "place"',
      operationClass: 'widening',
      target: {
        id: 'sqlite',
        details: { objectType: 'column', name: 'history', table: 'place' },
      },
      precheck: [
        {
          description:
            'ensure no object at path "$[*]" in column "history" of "place" has both key "lat" and key "latitude"; remove one of the two keys from those objects',
          sql: `SELECT NOT EXISTS (SELECT 1 FROM "place" WHERE (json_type("history") IN ('array', 'object') AND EXISTS (SELECT 1 FROM json_each("history") AS e0 WHERE ((json_type(("history" -> e0.fullkey)) = 'object' AND json_type(("history" -> e0.fullkey), '$."lat"') IS NOT NULL) AND (json_type(("history" -> e0.fullkey)) = 'object' AND json_type(("history" -> e0.fullkey), '$."latitude"') IS NOT NULL))))) AS result`,
        },
      ],
      execute: [
        {
          description:
            'rename key "lat" to "latitude" at path "$[*]" in column "history" of "place"',
          sql: `UPDATE "place" SET "history" = CASE json_type("history") WHEN 'array' THEN (SELECT json_group_array(json(CASE WHEN (json_type(("history" -> e0.fullkey)) = 'object' AND json_type(("history" -> e0.fullkey), '$."lat"') IS NOT NULL) THEN json_set(json_remove(("history" -> e0.fullkey), '$."lat"'), '$."latitude"', json(("history" -> e0.fullkey) -> '$."lat"')) ELSE ("history" -> e0.fullkey) END) ORDER BY e0.key) FROM json_each("history") AS e0) WHEN 'object' THEN (SELECT json_group_object(e0.key, json(CASE WHEN (json_type(("history" -> e0.fullkey)) = 'object' AND json_type(("history" -> e0.fullkey), '$."lat"') IS NOT NULL) THEN json_set(json_remove(("history" -> e0.fullkey), '$."lat"'), '$."latitude"', json(("history" -> e0.fullkey) -> '$."lat"')) ELSE ("history" -> e0.fullkey) END) ORDER BY e0.id) FROM json_each("history") AS e0) ELSE "history" END WHERE ${holdsKey}`,
        },
      ],
      postcheck: [
        {
          description:
            'verify no object at path "$[*]" in column "history" of "place" has key "lat"',
          sql: `SELECT NOT EXISTS (SELECT 1 FROM "place" WHERE ${holdsKey}) AS result`,
        },
      ],
    });
  });

  it('quotes a key with quotes in it in the SQL text and in the SQLite path', () => {
    const op = new RenameStoredKeyCall('place', 'point', `$["it's \\"x\\""]`, 'y').toOp();

    expect(op.postcheck[0]?.sql).toContain(`'$."it''s \\"x\\""'`);
  });

  it.each(REFUSED_PATHS)('refuses the path %j when it is built', (path) => {
    expect(() => new RenameStoredKeyCall('place', 'point', path, 'b')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: `renameStoredKey({ table: "place", column: "point" }): path ${JSON.stringify(path)} is not a JSONPath of member names (.name or ['name']) and wildcards ([*] or .*) from $`,
      }),
    );
  });

  it.each(['$', '$[*]', '$.a[*]'])('refuses the path %j, which does not end at a key', (path) => {
    expect(() => new RenameStoredKeyCall('place', 'point', path, 'b')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: `renameStoredKey({ table: "place", column: "point" }): path ${JSON.stringify(path)} does not end at a member name, the key the operation acts on`,
      }),
    );
  });

  it('refuses a new key that is the key it renames', () => {
    expect(() => new RenameStoredKeyCall('place', 'point', '$.lat', 'lat')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'renameStoredKey({ table: "place", column: "point" }): to must be a key other than "lat"; got "lat"',
      }),
    );
  });

  it('names the path in its label and checks as it was written', () => {
    const op = new RenameStoredKeyCall('place', 'byCountry', '$.*.lat', 'latitude').toOp();
    expect([op.label, op.precheck[0]?.description]).toEqual([
      'Rename key "lat" to "latitude" at path "$.*" in column "byCountry" of "place"',
      'ensure no object at path "$.*" in column "byCountry" of "place" has both key "lat" and key "latitude"; remove one of the two keys from those objects',
    ]);
  });

  it('renders the facade call with the path as written, and needs no import', () => {
    const call = new RenameStoredKeyCall('place', 'trips', "$[*]['stops'][*].lat", 'latitude');

    expect([call.renderTypeScript(), call.importRequirements(), call.operationClass]).toEqual([
      `this.renameStoredKey({ table: "place", column: "trips", path: "$[*]['stops'][*].lat", to: "latitude" })`,
      [],
      'widening',
    ]);
  });
});

describe('removeStoredKey', () => {
  it('removes the key only from the rows whose objects hold it', () => {
    const op = new RemoveStoredKeyCall('place', 'point', '$.lat').toOp();
    const holdsKey = `(json_type("point") = 'object' AND json_type("point", '$."lat"') IS NOT NULL)`;

    expect(op).toMatchObject({
      id: 'removeStoredKey.place.point.$.lat',
      label: 'Remove key "lat" at path "$" in column "point" of "place"',
      operationClass: 'destructive',
      precheck: [],
      execute: [
        {
          sql: `UPDATE "place" SET "point" = CASE WHEN ${holdsKey} THEN json_remove("point", '$."lat"') ELSE "point" END WHERE ${holdsKey}`,
        },
      ],
      postcheck: [{ sql: `SELECT NOT EXISTS (SELECT 1 FROM "place" WHERE ${holdsKey}) AS result` }],
    });
  });

  it.each([...REFUSED_PATHS, '$', '$[*]'])('refuses the path %j when it is built', (path) => {
    expect(() => new RemoveStoredKeyCall('place', 'point', path)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: expect.stringContaining(
          'removeStoredKey({ table: "place", column: "point" }): path ',
        ),
      }),
    );
  });

  it('renders the facade call', () => {
    expect(new RemoveStoredKeyCall('place', 'point', '$.lat').renderTypeScript()).toBe(
      'this.removeStoredKey({ table: "place", column: "point", path: "$.lat" })',
    );
  });
});

describe('fillStoredKey', () => {
  it('fills the key only in the rows with an object that lacks it or holds JSON null there, passing the value as JSON text', () => {
    const lacks = `(json_type("point") = 'object' AND coalesce(json_type("point", '$."country"'), 'null') = 'null')`;

    expect(
      new FillStoredKeyCall('place', 'point', '$.country', { code: 'NZ' }).toOp(),
    ).toMatchObject({
      id: 'fillStoredKey.place.point.$.country',
      label: 'Fill key "country" at path "$" in column "point" of "place"',
      operationClass: 'widening',
      precheck: [],
      execute: [
        {
          sql: `UPDATE "place" SET "point" = CASE WHEN ${lacks} THEN json_set("point", '$."country"', json(?1)) ELSE "point" END WHERE ${lacks}`,
          params: ['{"code":"NZ"}'],
        },
      ],
      postcheck: [{ sql: `SELECT NOT EXISTS (SELECT 1 FROM "place" WHERE ${lacks}) AS result` }],
    });
  });

  it('refuses a path that does not end at a key, and a value that is not JSON', () => {
    const missing: unknown = undefined;

    expect(() => new FillStoredKeyCall('place', 'point', '$[*]', 1)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID' }),
    );
    expect(
      () => new FillStoredKeyCall('place', 'point', '$.country', missing as JsonValue),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'fillStoredKey({ table: "place", column: "point" }): value must be a JSON value; got undefined',
      }),
    );
  });

  it('renders the facade call with the value as a literal', () => {
    expect(
      new FillStoredKeyCall('place', 'point', '$.country', {
        code: 'NZ',
        parts: [1, null],
      }).renderTypeScript(),
    ).toBe(
      'this.fillStoredKey({ table: "place", column: "point", path: "$.country", value: { code: "NZ", parts: [1, null] } })',
    );
  });

  describe('with the value object field it fills', () => {
    const field = {
      text: 'GeoPoint.country',
      check: {
        contract: placeContract(
          { GeoPoint: { lat: 'scalar', country: 'scalar' } },
          [{ field: 'point', valueObject: 'GeoPoint' }],
          'fill-check',
        ),
        types: { ...sqliteTestTypes, scalarTypeName: () => 'String' },
      },
    };

    it('refuses a value the field does not take, naming the field and its type', () => {
      expect(() => new FillStoredKeyCall('place', 'point', '$.country', 12, field)).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ARGUMENT_INVALID',
          message:
            'fillStoredKey({ table: "place", column: "point" }): value 12 for field "GeoPoint.country" is not a String',
        }),
      );
    });

    it('takes a value the field takes, or a placeholder, and renders the field', () => {
      expect([
        new FillStoredKeyCall('place', 'point', '$.country', 'NZ', field).renderTypeScript(),
        new FillStoredKeyCall(
          'place',
          'point',
          '$.country',
          new UnfilledValue('GeoPoint.country:value'),
          field,
        ).renderTypeScript(),
      ]).toEqual([
        'this.fillStoredKey({ table: "place", column: "point", path: "$.country", value: "NZ", field: "GeoPoint.country" })',
        'this.fillStoredKey({ table: "place", column: "point", path: "$.country", value: placeholder("GeoPoint.country:value"), field: "GeoPoint.country" })',
      ]);
    });
  });

  it('takes an unfilled value, which its migration.ts writes as a placeholder and its operation refuses', async () => {
    const call = new FillStoredKeyCall(
      'place',
      'point',
      '$.country',
      new UnfilledValue('GeoPoint.country:value'),
    );

    expect(call.renderTypeScript()).toBe(
      'this.fillStoredKey({ table: "place", column: "point", path: "$.country", value: placeholder("GeoPoint.country:value") })',
    );
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/sqlite/migration', symbol: 'placeholder' },
    ]);
    await expect(call.toOp()).rejects.toMatchObject({
      code: 'MIGRATION.UNFILLED_PLACEHOLDER',
      meta: {
        slot: 'GeoPoint.country:value',
        operation: {
          id: 'fillStoredKey.place.point.$.country',
          label: 'Fill key "country" at path "$" in column "point" of "place"',
          operationClass: 'widening',
        },
      },
    });
  });
});
