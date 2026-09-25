import pgvector from '@internal/extension-pgvector/control';
import { describe, expect, it } from 'vitest';
import {
  composePostgresStack,
  printContract,
  readPsl,
  serializedWithoutCapabilities,
} from '../../../../packages/3-targets/6-adapters/postgres/test/helpers/psl-print';

const stack = composePostgresStack([pgvector]);

describe('a printed contract with an extension-contributed column type', () => {
  it('writes the extension type and reads back as the same contract', async () => {
    const authored = await readPsl(
      `// use prisma-8
types {
  Embedding = pgvector.Vector(3)
}

model Document {
  id        Int              @id
  embedding pgvector.Vector(3)
  named     Embedding
}
`,
      { stack },
    );
    const { text, sourceSettings } = printContract(authored, stack);

    expect(text).toContain('embedding pgvector.Vector(3)');
    const printed = await readPsl(text, { stack, sourceSettings });
    expect(serializedWithoutCapabilities(printed)).toEqual(serializedWithoutCapabilities(authored));
    expect(printed.storage.storageHash).toBe(authored.storage.storageHash);
  });

  it('refuses an extension type on a value-object field, whose type parameters the PSL source drops', async () => {
    const authored = await readPsl(
      `// use prisma-8
type Point {
  at pgvector.Vector(3)
}

model Place {
  id    Int   @id
  point Point
}
`,
      { stack },
    );

    expect(() => printContract(authored, stack)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        meta: { coordinate: '"public".Point.at', codecId: 'pg/vector@1' },
      }),
    );
  });

  it('writes a literal default on an extension-typed column and reads back as the same contract', async () => {
    const authored = await readPsl(
      `// use prisma-8
model Document {
  id        Int                @id
  embedding pgvector.Vector(3) @default([1, 2, 3])
}
`,
      { stack },
    );
    const { text, sourceSettings } = printContract(authored, stack);

    expect(text).toContain('@default([1, 2, 3])');
    const printed = await readPsl(text, { stack, sourceSettings });
    expect(serializedWithoutCapabilities(printed)).toEqual(serializedWithoutCapabilities(authored));
    expect(printed.storage.storageHash).toBe(authored.storage.storageHash);
  });
});
