import { describe, expect, it } from 'vitest';
import sqlFamilyPack from '../src/exports/pack';

describe('sql family pack authoring contributions', () => {
  it('exposes a family-owned sql.String type constructor', () => {
    expect(sqlFamilyPack.authoring?.type).toMatchObject({
      sql: {
        String: {
          kind: 'typeConstructor',
          documentation: 'Variable-length text with a required maximum character length.',
          args: [{ kind: 'number', name: 'length', integer: true }],
          output: {
            codecId: 'sql/varchar@1',
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

  it('leaves the bounds of sql.String length to the data type', () => {
    const descriptor = sqlFamilyPack.authoring?.type.sql.String.args[0];
    expect(descriptor).toEqual({ kind: 'number', name: 'length', integer: true });
  });
});
