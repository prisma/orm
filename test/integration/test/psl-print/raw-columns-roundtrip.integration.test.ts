import { describe, expect, it } from 'vitest';
import {
  composePostgresStack,
  printContract,
  readPsl,
  serializedWithoutCapabilities,
} from './print-and-read-back';

const stack = composePostgresStack([]);

describe('a printed contract with raw columns', () => {
  it('writes each raw field as Raw("...") and reads back as the same contract', async () => {
    const authored = await readPsl(
      `// use prisma-8
types {
  Search = Raw("tsvector")
}

model Category {
  id    Int                       @id
  path  Raw("character varying(10)")
  area  Raw("circle")             @default(sql\`'<(0,0),1>'::circle\`)
  net   Raw("cidr")?
  nets  Raw("cidr")[]
  named Search
}
`,
      { stack },
    );
    const { text, sourceSettings } = printContract(authored, stack);

    expect(text).toContain('Search = Raw("tsvector")');
    expect(text).toContain('Raw("character varying(10)")');
    expect(text).toContain('Raw("cidr")?');
    const printed = await readPsl(text, { stack, sourceSettings });
    expect(serializedWithoutCapabilities(printed)).toEqual(serializedWithoutCapabilities(authored));
    expect(printed.storage.storageHash).toBe(authored.storage.storageHash);
  });
});
