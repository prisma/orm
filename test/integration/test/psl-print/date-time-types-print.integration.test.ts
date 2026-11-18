import { describe, expect, it } from 'vitest';
import { printAndReadBack, printContract, readPsl } from './print-and-read-back';

const SCHEMA = `// use prisma-8

model Event {
  id        Int                   @id
  instant   DateTime
  zoned     TimestamptzTemporal
  zoned3    TimestamptzTemporal(3)
  local     TimestampTemporal
  local3    TimestampTemporal(3)
  utcDate   TimestampJsDate(3)
  utcAt     TimestampInstant(6)
  dayT      DateTemporal
  clockT    TimeTemporal(0)
  period    IntervalParts
  span      IntervalString(3)
  day       Date
  clock     Time
  clock3    Time(precision: 3)
  zonedText TimestamptzString(3)
  localText TimestampString(3)
  dayText   DateString
  clockText TimeString(3)
  offset    Timetz
  lasts     Duration
}
`;

function fieldTypes(printed: string): Record<string, string> {
  return Object.fromEntries(
    printed.split('\n').flatMap((line) => {
      const match = /^\s+(\w+)\s+([^@]+?)\s*(?:@|$)/.exec(line);
      return match?.[1] === undefined || match[2] === undefined || match[1] === 'model'
        ? []
        : [[match[1], match[2]]];
    }),
  );
}

describe('contract print spells each date and time column', () => {
  it('as the convenience type it becomes, with the arguments that differ from the defaults, or else as its explicit type', async () => {
    const contract = await readPsl(SCHEMA);

    expect(fieldTypes(printContract(contract).text)).toEqual({
      id: 'Int',
      instant: 'DateTime',
      zoned: 'DateTime(as: temporal)',
      zoned3: 'DateTime(as: temporal, precision: 3)',
      local: 'TimestampTemporal',
      local3: 'TimestampTemporal(3)',
      utcDate: 'DateTime(storage: timestamp)',
      utcAt: 'DateTime(as: temporal, storage: timestamp, precision: 6)',
      dayT: 'Date(as: temporal)',
      clockT: 'Time(as: temporal, precision: 0)',
      period: 'Duration(as: parts)',
      span: 'Duration(precision: 3)',
      day: 'Date',
      clock: 'Time',
      clock3: 'Time(precision: 3)',
      zonedText: 'DateTime(as: string, precision: 3)',
      localText: 'DateTime(as: string, storage: timestamp, precision: 3)',
      dayText: 'Date',
      clockText: 'Time(precision: 3)',
      offset: 'Time(storage: timetz)',
      lasts: 'Duration',
    });
    expect(await printAndReadBack(contract)).toEqual(contract);
  });
});
