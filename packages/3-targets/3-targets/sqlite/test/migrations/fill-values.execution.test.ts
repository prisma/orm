import { DatabaseSync } from 'node:sqlite';
import { SqlColumnIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../../src/core/codecs';
import { sqliteDatetime, sqliteJson } from '../../src/core/data-types';
import { sqliteFillValue } from '../../src/core/migrations/planner-fill-values';
import { sqliteCodecRegistry } from '../../src/core/registry';
import { sqliteTestTypes } from '../sqlite-test-types';

function readBack(fill: string): unknown {
  const db = new DatabaseSync(':memory:');
  try {
    return db.prepare(`SELECT ${fill} AS v`).get()?.['v'];
  } finally {
    db.close();
  }
}

describe('the temporary value a new required SQLite column takes', () => {
  it('reads back through each codec as a value of its type', async () => {
    const read = await Promise.all(
      codecDescriptors.map(async (descriptor) => {
        const column = new SqlColumnIR({
          name: 'v',
          nativeType: 'TEXT',
          nullable: false,
          codecRef: { codecId: descriptor.codecId },
        });
        const fill = sqliteFillValue(column, new Map(), sqliteTestTypes);
        const codec = sqliteCodecRegistry.descriptorFor(descriptor.codecId)?.factory(undefined)({
          name: 'v',
        });
        return [
          descriptor.codecId,
          fill === undefined ? undefined : await codec?.fromWire(readBack(fill), {}),
        ];
      }),
    );
    expect(Object.fromEntries(read)).toEqual({
      'sql/char@1': '',
      'sql/varchar@1': '',
      'sql/int@1': 0,
      'sql/float@1': 0,
      'sqlite/text@1': '',
      'sqlite/integer@1': 0,
      'sqlite/real@1': 0,
      'sqlite/blob@1': new Uint8Array(),
      'sqlite/datetime@1': new Date(0),
      'sqlite/json@1': {},
      'sqlite/bigint@1': 0n,
      'sqlite/bigintnumber@1': 0,
    });
  });
});

describe('the temporary value of a column whose codec comes from an extension', () => {
  const extensionTypes = {
    ...sqliteTestTypes,
    codecLookup: {
      ...sqliteTestTypes.codecLookup,
      descriptorFor: (codecId: string) =>
        ({
          'ext/datetime-text@1': { codecId, dataType: sqliteDatetime.id },
          'ext/document@1': { codecId, dataType: sqliteJson.id },
        })[codecId] as never,
    },
  };

  it.each([
    ['ext/datetime-text@1', "'1970-01-01T00:00:00.000Z'"],
    ['ext/document@1', "'{}'"],
  ])('is the value of the data type %s represents', (codecId, fill) => {
    const column = new SqlColumnIR({
      name: 'v',
      nativeType: 'TEXT',
      nullable: false,
      codecRef: { codecId },
    });
    expect(sqliteFillValue(column, new Map(), extensionTypes)).toBe(fill);
  });
});
