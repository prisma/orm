import { describe, expect, it } from 'vitest';
import { printAndReadBack, printContract, readPsl } from './print-and-read-back';

const SCHEMA = `// use prisma-8

model Event {
  id        Int                   @id
  instant   DateTime
  zoned     Timestamptz
  zoned3    Timestamptz(3)
  local     Timestamp
  local3    Timestamp(3)
  day       Date
  clock     Time
  clock3    Time(3)
  zonedText TimestamptzString(3)
  localText TimestampString(3)
  dayText   DateString
  clockText TimeString(3)
  offset    Timetz
}
`;

function fieldTypes(printed: string): Record<string, string> {
  return Object.fromEntries(
    printed.split('\n').flatMap((line) => {
      const match = /^\s+(\w+)\s+(\S+)/.exec(line);
      return match?.[1] === undefined || match[2] === undefined || match[1] === 'model'
        ? []
        : [[match[1], match[2]]];
    }),
  );
}

describe('contract print spells each date and time column', () => {
  it('as the type contract infer writes, or the first constructor that reads the column back', async () => {
    const contract = await readPsl(SCHEMA);

    expect(fieldTypes(printContract(contract).text)).toEqual({
      id: 'Int',
      instant: 'DateTime',
      zoned: 'DateTime',
      zoned3: 'Timestamptz(3)',
      local: 'Timestamp',
      local3: 'Timestamp(3)',
      day: 'Date',
      clock: 'Time',
      clock3: 'Time(3)',
      zonedText: 'TimestamptzString(3)',
      localText: 'TimestampString(3)',
      dayText: 'DateString',
      clockText: 'TimeString(3)',
      offset: 'Timetz',
    });
    expect(await printAndReadBack(contract)).toEqual(contract);
  });
});
