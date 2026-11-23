import { mongoCodecLookup } from '@internal/mongo-contract/test';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';
import { mongoDataTypeSupport } from './mongo-type-lookups';

const lookups = {
  scalarTypes: new Map([
    ['String', 'mongo/string@1'],
    ['ObjectId', 'mongo/objectId@1'],
  ]),
  defaultFunctionRegistry: new Map(),
  codecLookup: mongoCodecLookup,
  dataTypes: mongoDataTypeSupport,
} as const;

function diagnosticsOf(schema: string) {
  const result = interpretMongoContract(schema, lookups);
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

const reason =
  'which JavaScript reads as the prototype of an object rather than as a key. Choose another name.';

describe('a Mongo schema naming something __proto__', () => {
  it('refuses a collection named __proto__', () => {
    expect(
      diagnosticsOf('model Item {\n  id ObjectId @id @map("_id")\n  @@map("__proto__")\n}'),
    ).toEqual([
      {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `Model "Item" is stored in collection "__proto__", ${reason}`,
      },
    ]);
  });

  it('refuses a model named __proto__', () => {
    expect(diagnosticsOf('model __proto__ {\n  id ObjectId @id @map("_id")\n}')).toEqual([
      { code: 'PSL_STORED_NAME_UNSUPPORTED', message: `A model is named "__proto__", ${reason}` },
      {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `Model "__proto__" is stored in collection "__proto__", ${reason}`,
      },
    ]);
  });

  it('refuses a field named __proto__ that is stored under another name', () => {
    expect(
      diagnosticsOf(
        'model Item {\n  id ObjectId @id @map("_id")\n  __proto__ String @map("proto")\n}',
      ),
    ).toEqual([
      {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `Field "Item.__proto__" is named "__proto__", ${reason}`,
      },
    ]);
  });

  it('refuses a composite type named __proto__', () => {
    expect(
      diagnosticsOf(
        'type __proto__ {\n  a String\n}\nmodel Item {\n  id ObjectId @id @map("_id")\n  k __proto__\n}',
      ),
    ).toEqual([
      {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `A composite type is named "__proto__", ${reason}`,
      },
    ]);
  });
});
