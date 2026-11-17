import { mongoCodecLookup } from '@internal/mongo-contract/test';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';
import { mongoDataTypeSupport } from './mongo-type-lookups';

function interpret(schema: string) {
  return interpretMongoContract(schema, {
    scalarTypes: new Map([
      ['String', 'mongo/string@1'],
      ['ObjectId', 'mongo/objectId@1'],
    ]),
    dataTypes: mongoDataTypeSupport,
    defaultFunctionRegistry: new Map(),
    codecLookup: mongoCodecLookup,
  });
}

const userModel = 'model User {\n  id ObjectId @id @map("_id")\n}\n';

describe('interpretPslDocumentToMongoContract given a block no composed descriptor claims', () => {
  it.each([
    ['plain fields', 'view ActiveUsers {\n  id String\n}\n'],
    ['field attributes', 'view ActiveUsers {\n  id String @unique\n\n  @@map("active")\n}\n'],
  ])(
    'reports a view block with %s as an unsupported top-level block, whatever the parser reported',
    (_, view) => {
      const result = interpret(`${view}${userModel}`);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toContainEqual({
        code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
        message: 'Unsupported top-level block "view"',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 4, line: 1, column: 5 },
        },
      });
    },
  );
});
