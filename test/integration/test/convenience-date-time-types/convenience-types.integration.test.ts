import { describe, expect, it } from 'vitest';
import { readPsl } from '../psl-print/print-and-read-back';

const model = (...fields: readonly string[]) =>
  [
    '// use prisma-8',
    '',
    'model Order {',
    '  id Int @id',
    ...fields.map((f) => `  ${f}`),
    '}',
    '',
  ].join('\n');

const rows: readonly (readonly [convenience: string, explicit: string])[] = [
  ['DateTime', 'TimestamptzJsDate(3)'],
  ['DateTime(as: temporal)', 'TimestamptzTemporal'],
  ['DateTime(as: string)', 'TimestamptzString'],
  ['DateTime(storage: timestamp)', 'TimestampJsDate(3)'],
  ['DateTime(as: temporal, storage: timestamp)', 'TimestampInstant'],
  ['DateTime(as: string, storage: timestamp)', 'TimestampString'],
  ['DateTime(as: string, precision: 6)', 'TimestamptzString(6)'],
  ['DateTime(precision: 6)', 'TimestamptzJsDate(6)'],
  ['DateTime(temporal, timestamptz, 3)', 'TimestamptzTemporal(3)'],
  ['Date', 'DateString'],
  ['Date(as: temporal)', 'DateTemporal'],
  ['Time', 'TimeString'],
  ['Time(precision: 0)', 'TimeString(0)'],
  ['Time(as: temporal)', 'TimeTemporal'],
  ['Time(storage: timetz)', 'Timetz'],
  ['Duration', 'IntervalString'],
  ['Duration(precision: 3)', 'IntervalString(3)'],
  ['Duration(as: parts)', 'IntervalParts'],
  ['DateTime[]', 'TimestamptzJsDate(3)[]'],
  ['DateTime?', 'TimestamptzJsDate(3)?'],
];

describe('a convenience date and time type', () => {
  it.each(rows)('%s emits the contract %s emits', async (convenience, explicit) => {
    expect(await readPsl(model(`at ${convenience}`))).toEqual(
      await readPsl(model(`at ${explicit}`)),
    );
  });

  it('chooses the generator now() writes for the type it becomes', async () => {
    expect(
      await readPsl(
        model(
          'createdAt DateTime @onCreate(now())',
          'updatedAt DateTime @onCreate(now()) @onUpdate(now())',
          'day       Date @onCreate(now())',
          'clock     Time(precision: 0) @onCreate(now())',
          'instant   DateTime(as: temporal) @onCreate(now())',
        ),
      ),
    ).toEqual(
      await readPsl(
        model(
          'createdAt TimestamptzJsDate(3) @onCreate(now())',
          'updatedAt TimestamptzJsDate(3) @onCreate(now()) @onUpdate(now())',
          'day       DateString @onCreate(now())',
          'clock     TimeString(0) @onCreate(now())',
          'instant   TimestamptzTemporal @onCreate(now())',
        ),
      ),
    );
  });

  it('reads a @default as the type it becomes, through a types {} alias too', async () => {
    const convenience = `// use prisma-8

types {
  Stamp = DateTime(storage: timestamp) @default(timestamp\`2024-01-01 00:00:00\`)
}

model Order {
  id     Int   @id
  placed Stamp
  day    Date  @default(date\`2024-02-29\`)
}
`;
    expect(await readPsl(convenience)).toEqual(
      await readPsl(
        model(
          'placed TimestampJsDate(3) @default(timestamp`2024-01-01 00:00:00`)',
          'day    DateString @default(date`2024-02-29`)',
        ),
      ),
    );
  });

  it('refuses a default of another date and time type, naming the column’s', async () => {
    await expect(
      readPsl(model('at DateTime(storage: timestamp) @default(timestamptz`2024-01-01T00:00:00Z`)')),
    ).rejects.toThrow(/PSL_VALUE_TYPE_INCOMPATIBLE.*Expected timestamp`\.\.\.`/);
  });

  it.each([
    [
      'Time(as: temporal, storage: timetz)',
      'Argument \\"storage\\" of Time cannot be timetz with as: temporal; write one of: time.',
    ],
    ['Date(as: jsDate)', 'Argument \\"as\\" of Date is jsDate; write one of: string, temporal.'],
    [
      'Duration(as: parts, storage: date)',
      'Argument \\"storage\\" of Duration is date; write one of: interval.',
    ],
  ])('refuses %s at the argument, naming the accepted choices', async (written, message) => {
    await expect(readPsl(model(`at ${written}`))).rejects.toThrow(message);
  });

  it('refuses a precision written in the place of the value option, saying to write it by name', async () => {
    await expect(readPsl(model('at Time(3)'))).rejects.toThrow(
      'Field \\"Order.at\\" type \\"Time\\" argument #1 is 3, but argument \\"as\\" takes one of these names, written without quotes: string, temporal. Write precision by name, as in precision: 3.',
    );
  });

  it('refuses a precision the type it becomes does not take, naming the arguments it takes', async () => {
    await expect(readPsl(model('at Date(precision: 3)'))).rejects.toThrow(
      'Field \\"Order.at\\" type \\"Date\\" has no argument \\"precision\\"; its arguments are as and storage.',
    );
  });
});
