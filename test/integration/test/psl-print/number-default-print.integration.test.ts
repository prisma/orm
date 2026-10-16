import { describe, expect, it } from 'vitest';
import { printAndReadBack, printContract, readPsl } from './print-and-read-back';

const SCHEMA = `// use prisma-8

types {
  Money = Numeric(10, 2)
}

model Order {
  id      Int            @id
  total   Money          @default(1.50)
  scaled  Numeric(10, 2) @default(1.50)
  precise Numeric(65, 30) @default(-0.5)
  count   Int            @default(10)
}
`;

function defaults(printed: string): Record<string, string> {
  return Object.fromEntries(
    printed.split('\n').flatMap((line) => {
      const match = /^\s+(\w+)\s+\S+\s+.*@default\(([^)]*)\)/.exec(line);
      return match?.[1] === undefined || match[2] === undefined ? [] : [[match[1], match[2]]];
    }),
  );
}

describe('contract print writes a number default', () => {
  it('as the shortest text that reads back under the column parameters, also through a named type', async () => {
    const contract = await readPsl(SCHEMA);

    expect(defaults(printContract(contract).text)).toEqual({
      total: '1.5',
      scaled: '1.5',
      precise: '-0.5',
      count: '10',
    });
    expect(await printAndReadBack(contract)).toEqual(contract);
  });
});
