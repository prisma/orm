import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { RenameStoredKeyCall } from '../../src/core/migrations/op-factory-call';

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
  it('writes the rename only into the rows whose objects hold the key, with a typed strict path', () => {
    const op = new RenameStoredKeyCall('app', 'place', 'history', '$[*].lat', 'latitude').toOp();

    expect(op).toEqual({
      id: 'renameStoredKey.place.history.$[*].lat',
      label: 'Rename key "lat" to "latitude" at path "$[*]" in column "history" of "place"',
      operationClass: 'widening',
      target: {
        id: 'postgres',
        details: { schema: 'app', objectType: 'column', name: 'history', table: 'place' },
      },
      precheck: [
        {
          description:
            'ensure no object at path "$[*]" in column "history" of "place" has both key "lat" and key "latitude"',
          sql: `SELECT NOT EXISTS (SELECT 1 FROM "app"."place" WHERE jsonb_path_exists("history", 'strict $ ? (@.type() == "array")[*] ? (@.type() == "object" && exists(@.keyvalue() ? (@.key == "lat")) && exists(@.keyvalue() ? (@.key == "latitude")))')) AS result`,
        },
      ],
      execute: [
        {
          description:
            'rename key "lat" to "latitude" at path "$[*]" in column "history" of "place"',
          sql: `UPDATE "app"."place" SET "history" = CASE WHEN jsonb_typeof("history") = 'array' THEN (SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(e0.v) = 'object' AND e0.v ? 'lat' THEN (e0.v - 'lat') || jsonb_build_object('latitude', e0.v -> 'lat') ELSE e0.v END ORDER BY e0.i), '[]'::jsonb) FROM jsonb_array_elements("history") WITH ORDINALITY AS e0(v, i)) ELSE "history" END WHERE jsonb_path_exists("history", 'strict $ ? (@.type() == "array")[*] ? (@.type() == "object" && exists(@.keyvalue() ? (@.key == "lat")))')`,
        },
      ],
      postcheck: [
        {
          description:
            'verify no object at path "$[*]" in column "history" of "place" has key "lat"',
          sql: `SELECT NOT EXISTS (SELECT 1 FROM "app"."place" WHERE jsonb_path_exists("history", 'strict $ ? (@.type() == "array")[*] ? (@.type() == "object" && exists(@.keyvalue() ? (@.key == "lat")))')) AS result`,
        },
      ],
    });
  });

  it('quotes a key with quotes in it in the SQL text and in the path', () => {
    const op = new RenameStoredKeyCall('app', 'place', 'point', `$["it's \\"x\\""]`, 'y').toOp();

    expect(op.execute[0]?.sql).toContain(`? 'it''s "x"'`);
    expect(op.postcheck[0]?.sql).toContain(`(@.key == "it''s \\"x\\"")`);
  });

  it.each(REFUSED_PATHS)('refuses the path %j when it is built', (path) => {
    expect(() => new RenameStoredKeyCall('app', 'place', 'point', path, 'b')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: `renameStoredKey({ schema: "app", table: "place", column: "point" }): path ${JSON.stringify(path)} is not a JSONPath of member names (.name or ['name']) and list wildcards ([*]) from $`,
      }),
    );
  });

  it.each(['$', '$[*]', '$.a[*]'])('refuses the path %j, which does not end at a key', (path) => {
    expect(
      () => new RenameStoredKeyCall(UNBOUND_NAMESPACE_ID, 'place', 'point', path, 'b'),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: `renameStoredKey({ table: "place", column: "point" }): path ${JSON.stringify(path)} does not end at a member name, the key the operation acts on`,
      }),
    );
  });

  it('refuses a new key that is the key it renames', () => {
    expect(() => new RenameStoredKeyCall('app', 'place', 'point', '$.lat', 'lat')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'renameStoredKey({ schema: "app", table: "place", column: "point" }): to must be a key other than "lat"; got "lat"',
      }),
    );
  });

  it('renders the facade call with the path as written, and needs no import', () => {
    const call = new RenameStoredKeyCall(
      UNBOUND_NAMESPACE_ID,
      'place',
      'trips',
      "$[*]['stops'][*].lat",
      'latitude',
    );

    expect([call.renderTypeScript(), call.importRequirements(), call.operationClass]).toEqual([
      `this.renameStoredKey({ table: "place", column: "trips", path: "$[*]['stops'][*].lat", to: "latitude" })`,
      [],
      'widening',
    ]);
  });
});
