import { describe, expect, it } from 'vitest';
import sqlFamilyPack from '../src/exports/pack';

describe('sql family pack authoring contributions', () => {
  it('exposes a family-owned sql.String type constructor', () => {
    expect(sqlFamilyPack.authoring?.type).toMatchObject({
      sql: {
        String: {
          kind: 'typeConstructor',
          documentation: 'Variable-length text with a required maximum character length.',
          args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 10485760 }],
          output: {
            codecId: 'sql/varchar@1',
            nativeType: 'character varying',
            typeParams: {
              length: {
                kind: 'arg',
                index: 0,
              },
            },
          },
        },
      },
    });
  });

  it('bounds sql.String length to the Postgres varchar maximum', () => {
    const descriptor = sqlFamilyPack.authoring?.type.sql.String.args[0];
    expect(descriptor).toMatchObject({
      kind: 'number',
      integer: true,
      minimum: 1,
      maximum: 10485760,
    });
  });
});
