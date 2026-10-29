import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPslFromFlat } from '../fixtures';

async function printedStampField(typeText: string, rawDefault: string): Promise<string> {
  const output = await printPslFromFlat(
    new SqlSchemaIR({
      tables: {
        account: {
          name: 'account',
          columns: {
            id: { name: 'id', typeText: 'int4', nullable: false },
            stamp: { name: 'stamp', typeText, nullable: false, default: rawDefault },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    }),
  );
  const line = output.split('\n').find((candidate) => /^\s+stamp\s/.test(candidate));
  return (line ?? '').trim().replace(/\s+/g, ' ');
}

describe('contract infer picks a type whose codec reads the column default as a row', () => {
  it.each([
    [
      'timestamp(3)',
      "'infinity'::timestamp without time zone",
      'stamp DateTime(as: string, storage: timestamp, precision: 3) @default(timestamp`infinity`)',
    ],
    [
      'timestamp(3)',
      "'-infinity'::timestamp without time zone",
      'stamp DateTime(as: string, storage: timestamp, precision: 3) @default(timestamp`-infinity`)',
    ],
    [
      'timestamptz',
      "'-infinity'::timestamp with time zone",
      'stamp DateTime(as: string) @default(timestamptz`-infinity`)',
    ],
  ])('writes a %s column with default %s as a string', async (typeText, rawDefault, expected) => {
    expect(await printedStampField(typeText, rawDefault)).toBe(expected);
  });

  it('keeps a Date for a default with digits below a millisecond, which a Date reads, and writes the default as SQL', async () => {
    const rawDefault = "'2024-01-01 01:00:00.123456+00'::timestamp(6) with time zone";
    expect(await printedStampField('timestamptz(6)', rawDefault)).toBe(
      `stamp DateTime(precision: 6) @default(sql\`${rawDefault}\`)`,
    );
  });

  it('keeps the string date type for an infinite date default, which it reads', async () => {
    expect(await printedStampField('date', "'infinity'::date")).toBe(
      'stamp Date @default(date`infinity`)',
    );
  });
});
