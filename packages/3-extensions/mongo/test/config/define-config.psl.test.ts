import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import mongoAdapter from '@internal/adapter-mongo/control';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { createControlStack } from '@internal/framework-components/control';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
});

const dir = mkdtempSync(join(tmpdir(), 'mongo-define-config-psl-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function load(schema: string) {
  const path = join(dir, 'schema.prisma');
  writeFileSync(path, schema);
  const source = defineConfig({ contract: path }).contract?.source;
  if (source === undefined) throw new Error('expected a contract source');
  return source.load({
    composedExtensions: [],
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    dataTypeLookup: stack.dataTypeLookup,
    resolvedInputs: [path],
    capabilities: stack.capabilities,
  });
}

describe('a Prisma 8 Mongo schema read through defineConfig', () => {
  it.each([
    ['BigInt', 'Int64', 'long'],
    ['Decimal', 'Decimal128', 'decimal'],
    ['Bytes', 'Binary', 'binData'],
  ])('refuses the Prisma 6 name %s and names %s', async (oldName, newName, bsonType) => {
    const result = await load(
      `// use prisma-8\nmodel Post {\n  id ObjectId @id @map("_id")\n  value ${oldName}\n}\n`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message: `Field "Post.value" has type "${oldName}", which is not a Mongo scalar type; use "${newName}" (stored as BSON ${bsonType}).`,
      }),
    ]);
  });

  it('lists the Mongo scalar types for a name that was never one', async () => {
    const result = await load(
      '// use prisma-8\nmodel Post {\n  id ObjectId @id @map("_id")\n  value Int23\n}\n',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        message:
          'Field "Post.value" has type "Int23", which is not a scalar type, an enum, a composite type or a model. The Mongo scalar types are String, Int32, Bool, Date, ObjectId, Double, Int64, Int64Number, Decimal128, Binary, Json and Bson.',
      }),
    ]);
  });
});
