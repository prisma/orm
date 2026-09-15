import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ContractSourceContext } from '@internal/config/config-types';
import type { JsonValue } from '@internal/contract/types';
import { enumType, member } from '@internal/contract-authoring';
import type { PslExtensionBlock } from '@internal/framework-components/authoring';
import { type Codec, emptyCodecLookup } from '@internal/framework-components/codec';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { mongoContract } from '../src/exports/provider';

const originalCwd = process.cwd();
const tempDirs: string[] = [];

const mongoScalarAuthoringTypes = {
  String: { kind: 'typeConstructor', output: { codecId: 'mongo/string@1', nativeType: 'string' } },
  ObjectId: {
    kind: 'typeConstructor',
    output: { codecId: 'mongo/objectId@1', nativeType: 'objectId' },
  },
} as const;

const stringCodec: Codec = {
  id: 'mongo/string@1',
  encode: async (value: unknown) => value,
  decode: async (wire: unknown) => wire,
  encodeJson: (value) => value as JsonValue,
  decodeJson: (json) => json,
};

const enumEntityType = {
  kind: 'entity',
  discriminator: 'enum',
  output: {
    factory: (block: PslExtensionBlock) =>
      enumType(
        block.name,
        { codecId: stringCodec.id, nativeType: 'string' },
        ...Object.keys(block.parameters).map((name) => member(name)),
      ),
  },
} as const;

const enumBlockDescriptor = {
  kind: 'pslBlock',
  keyword: 'enum',
  discriminator: 'enum',
  name: { required: true },
  parameters: {},
  variadicParameters: true,
} as const;

function createMongoTestContext(overrides?: Partial<ContractSourceContext>): ContractSourceContext {
  return {
    composedExtensions: [],
    composedExtensionContracts: new Map(),
    authoringContributions: {
      field: {},
      type: mongoScalarAuthoringTypes,
      entityTypes: {},
      pslBlockDescriptors: {},
      modelAttributes: {},
      attributeSpecs: { model: {}, field: {} },
    },
    codecLookup: emptyCodecLookup,
    controlMutationDefaults: {
      defaultFunctionRegistry: new Map(),
      generatorDescriptors: [],
    },
    resolvedInputs: [],
    capabilities: {},
    ...overrides,
  };
}

describe('mongoContract provider helper', () => {
  afterEach(async () => {
    process.chdir(originalCwd);
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('exposes watch inputs from schema path', () => {
    const config = mongoContract('./schema.prisma', {
      output: 'output/contract.json',
    });

    expect(config.output).toBe('output/contract.json');
    expect(config.source.inputs).toEqual(['./schema.prisma']);
  });

  it('tags the source as PSL', () => {
    const config = mongoContract('./schema.prisma');
    expect(config.source.format).toBe('psl');
  });

  it('throws InternalError when resolvedInputs is empty', async () => {
    const contract = mongoContract('./schema.prisma');

    await expect(contract.source.load(createMongoTestContext())).rejects.toMatchObject({
      isPrismaInternalError: true,
    });
  });

  it('resolves relative schema paths from configDir when cwd differs', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'mongo-psl-provider-config-'));
    const cwdDir = await mkdtemp(join(tmpdir(), 'mongo-psl-provider-cwd-'));
    tempDirs.push(configDir, cwdDir);
    const schemaPath = join(configDir, 'schema.prisma');
    await writeFile(
      schemaPath,
      `model User {
  id ObjectId @id @map("_id")
  email String
}
`,
      'utf-8',
    );

    process.chdir(cwdDir);
    const contract = mongoContract('./schema.prisma');
    const result = await contract.source.load(
      createMongoTestContext({ resolvedInputs: [schemaPath] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toMatchObject({
      targetFamily: 'mongo',
      target: 'mongo',
      domain: {
        namespaces: {
          __unbound__: {
            models: {
              User: expect.any(Object),
            },
          },
        },
      },
    });
  });

  it('returns read failure diagnostics with the resolved absolute schema path', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'mongo-psl-provider-'));
    tempDirs.push(tempDir);
    const contract = mongoContract('./missing.prisma');
    const result = await contract.source.load(
      createMongoTestContext({ resolvedInputs: [join(tempDir, 'missing.prisma')] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure).toMatchObject({
      summary: 'Failed to read Prisma schema at "./missing.prisma"',
      diagnostics: [
        expect.objectContaining({
          code: 'PSL_SCHEMA_READ_FAILED',
          sourceId: './missing.prisma',
        }),
      ],
      meta: {
        schemaPath: './missing.prisma',
        absoluteSchemaPath: expect.stringMatching(/missing\.prisma$/),
        cause: expect.any(String),
      },
    });
  });

  it('fails with an invalid block entry diagnostic at an enum member attribute and produces no contract', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'mongo-psl-provider-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(
      schemaPath,
      `enum Role {
  USER  @map("user")
  ADMIN
}

model User {
  id   ObjectId @id @map("_id")
  role Role
}
`,
      'utf-8',
    );

    const baseContributions = createMongoTestContext().authoringContributions;
    const contract = mongoContract('./schema.prisma');
    const result = await contract.source.load(
      createMongoTestContext({
        resolvedInputs: [schemaPath],
        codecLookup: {
          ...emptyCodecLookup,
          get: (id) => (id === stringCodec.id ? stringCodec : undefined),
        },
        authoringContributions: {
          ...baseContributions,
          entityTypes: { enum: enumEntityType },
          pslBlockDescriptors: { enum: enumBlockDescriptor },
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({
      summary: 'Schema has 1 error',
      diagnostics: [
        {
          code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
          message: 'Invalid block entry',
          sourceId: './schema.prisma',
          span: {
            start: { offset: 20, line: 2, column: 9 },
            end: { offset: 21, line: 2, column: 10 },
          },
        },
      ],
    });
  });
});
