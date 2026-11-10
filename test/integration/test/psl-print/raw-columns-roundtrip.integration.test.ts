import { describe, expect, it } from 'vitest';
import {
  composePostgresStack,
  printContract,
  readPsl,
  serializedWithoutCapabilities,
} from './print-and-read-back';

const stack = composePostgresStack([]);

describe('a printed contract with raw columns', () => {
  it('writes each raw field, including one typed by an alias, as Raw(sql`...`) and reads back as the same contract', async () => {
    const authored = await readPsl(
      `// use prisma-8
types {
  Search = Raw(sql\`tsvector\`)
}

model Category {
  id     Int                              @id
  path   Raw(sql\`character varying(10)\`)
  area   Raw(sql\`circle\`)               @default(sql\`'<(0,0),1>'::circle\`)
  net    Raw(sql\`cidr\`)?
  nets   Raw(sql\`cidr\`)[]
  quoted Raw(sql\`"MyType"\`)
  named  Search
}
`,
      { stack },
    );
    const { text, sourceSettings } = printContract(authored, stack);

    expect(text).not.toContain('types {');
    expect(text).toContain('named  Raw(sql`tsvector`)');
    expect(text).toContain('Raw(sql`character varying(10)`)');
    expect(text).toContain('Raw(sql`cidr`)?');
    expect(text).toContain('Raw(sql`"MyType"`)');
    const printed = await readPsl(text, { stack, sourceSettings });
    expect(serializedWithoutCapabilities(printed)).toEqual(serializedWithoutCapabilities(authored));
    expect(printed.storage.storageHash).toBe(authored.storage.storageHash);
  });
});
