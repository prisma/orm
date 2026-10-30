import { describe, expect, it } from 'vitest';
import {
  RemoveStoredKeyCall,
  RenameStoredKeyCall,
} from '../../src/core/migrations/op-factory-call';

const REFUSED_PATHS = [
  '$..lat',
  '$.*',
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
    const holdsKey = `(json_type("history") = 'array' AND EXISTS (SELECT 1 FROM json_each("history") AS e0 WHERE (json_type(("history" -> e0.key)) = 'object' AND json_type(("history" -> e0.key), '$."lat"') IS NOT NULL)))`;

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
            'ensure no object at path "$[*]" in column "history" of "place" has both key "lat" and key "latitude"',
          sql: `SELECT NOT EXISTS (SELECT 1 FROM "place" WHERE (json_type("history") = 'array' AND EXISTS (SELECT 1 FROM json_each("history") AS e0 WHERE ((json_type(("history" -> e0.key)) = 'object' AND json_type(("history" -> e0.key), '$."lat"') IS NOT NULL) AND (json_type(("history" -> e0.key)) = 'object' AND json_type(("history" -> e0.key), '$."latitude"') IS NOT NULL))))) AS result`,
        },
      ],
      execute: [
        {
          description:
            'rename key "lat" to "latitude" at path "$[*]" in column "history" of "place"',
          sql: `UPDATE "place" SET "history" = CASE WHEN json_type("history") = 'array' THEN (SELECT json_group_array(json(CASE WHEN (json_type(("history" -> e0.key)) = 'object' AND json_type(("history" -> e0.key), '$."lat"') IS NOT NULL) THEN json_set(json_remove(("history" -> e0.key), '$."lat"'), '$."latitude"', json(("history" -> e0.key) -> '$."lat"')) ELSE ("history" -> e0.key) END) ORDER BY e0.key) FROM json_each("history") AS e0) ELSE "history" END WHERE ${holdsKey}`,
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
        message: `renameStoredKey({ table: "place", column: "point" }): path ${JSON.stringify(path)} is not a JSONPath of member names (.name or ['name']) and list wildcards ([*]) from $`,
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
