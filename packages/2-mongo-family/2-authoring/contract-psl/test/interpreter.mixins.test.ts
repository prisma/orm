import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';

const scalarTypeCodecIds: ReadonlyMap<string, string> = new Map([
  ['String', 'mongo/string@1'],
  ['ObjectId', 'mongo/objectId@1'],
  ['Date', 'mongo/date@1'],
]);

function contractOf(schema: string) {
  const result = interpretMongoContract(schema, {
    scalarTypeCodecIds,
    defaultFunctionRegistry: new Map(),
  });
  if (!result.ok) {
    throw new Error(
      `The schema did not interpret: ${JSON.stringify(result.failure.diagnostics, null, 2)}`,
    );
  }
  return result.value;
}

describe('a schema that uses a model mixin', () => {
  it('gives the contract of the same schema with the members written at the inclusion', () => {
    const withMixin = [
      'model mixin Stamped {',
      '  createdAt Date',
      '  label String?',
      '  @@index([createdAt])',
      '}',
      'model User {',
      '  id ObjectId @id @map("_id")',
      '  +Stamped',
      '  email String @unique',
      '}',
      'model Post {',
      '  id ObjectId @id @map("_id")',
      '  +Stamped',
      '}',
    ].join('\n');
    const inline = [
      'model User {',
      '  id ObjectId @id @map("_id")',
      '  createdAt Date',
      '  label String?',
      '  @@index([createdAt])',
      '  email String @unique',
      '}',
      'model Post {',
      '  id ObjectId @id @map("_id")',
      '  createdAt Date',
      '  label String?',
      '  @@index([createdAt])',
      '}',
    ].join('\n');
    const contract = contractOf(withMixin);

    expect(contract).toEqual(contractOf(inline));
    expect(
      Object.keys(contract.domain.namespaces['__unbound__']?.models['User']?.fields ?? {}),
    ).toEqual(expect.arrayContaining(['createdAt', 'label']));
  });
});
