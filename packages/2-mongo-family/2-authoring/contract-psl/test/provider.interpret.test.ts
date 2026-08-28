import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ContractSourceContext } from '@internal/config/config-types';
import { emptyCodecLookup } from '@internal/framework-components/codec';
import { buildSymbolTable } from '@internal/psl-parser';
import { hasPslInterpreter, type PslInterpretInput } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { mongoContract } from '../src/exports/provider';

const SOURCE_ID = './schema.prisma';

const mongoScalarAuthoringTypes = {
  String: { kind: 'typeConstructor', output: { codecId: 'mongo/string@1', nativeType: 'string' } },
  ObjectId: {
    kind: 'typeConstructor',
    output: { codecId: 'mongo/objectId@1', nativeType: 'objectId' },
  },
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

function buildInterpretInput(schema: string, context: ContractSourceContext): PslInterpretInput {
  const { document, sourceFile } = parse(schema);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: context.authoringContributions.pslBlockDescriptors,
  });
  return { document, sourceFile, symbolTable, sourceId: SOURCE_ID };
}

function interpretCapableSource(schemaPath: string) {
  const contract = mongoContract(schemaPath);
  if (!hasPslInterpreter(contract.source)) {
    throw new Error('expected mongoContract source to carry the interpret capability');
  }
  return contract.source;
}

describe('mongoContract interpret capability', () => {
  const originalCwd = process.cwd();
  const tempDirs: string[] = [];

  afterEach(async () => {
    process.chdir(originalCwd);
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('narrows a real mongoContract source via hasPslInterpreter', () => {
    const contract = mongoContract(SOURCE_ID);

    expect(hasPslInterpreter(contract.source)).toBe(true);
    if (!hasPslInterpreter(contract.source)) return;
    expect(typeof contract.source.interpret).toBe('function');
  });

  it('returns the same failure diagnostics as load when parse and symbol table are clean', async () => {
    const schema = `model User {
  id ObjectId @id @map("_id")
  bad Mystery
}
`;
    const tempDir = await mkdtemp(join(tmpdir(), 'mongo-interpret-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(schemaPath, schema, 'utf-8');

    process.chdir(tempDir);
    const source = interpretCapableSource(SOURCE_ID);
    const loadResult = await source.load(createMongoTestContext({ resolvedInputs: [schemaPath] }));
    expect(loadResult.ok).toBe(false);
    if (loadResult.ok) return;

    const context = createMongoTestContext();
    const interpretResult = source.interpret(buildInterpretInput(schema, context), context);

    expect(interpretResult.ok).toBe(false);
    if (interpretResult.ok) return;
    expect(interpretResult.failure.diagnostics).toEqual(loadResult.failure.diagnostics);
    expect(interpretResult.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          sourceId: SOURCE_ID,
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 3 }),
          }),
        }),
      ]),
    );
  });

  it('returns the same contract load returns for a clean schema', async () => {
    const schema = `model User {
  id ObjectId @id @map("_id")
  email String
}
`;
    const tempDir = await mkdtemp(join(tmpdir(), 'mongo-interpret-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(schemaPath, schema, 'utf-8');

    process.chdir(tempDir);
    const source = interpretCapableSource(SOURCE_ID);
    const loadResult = await source.load(createMongoTestContext({ resolvedInputs: [schemaPath] }));
    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) return;

    const context = createMongoTestContext();
    const interpretResult = source.interpret(buildInterpretInput(schema, context), context);

    expect(interpretResult.ok).toBe(true);
    if (!interpretResult.ok) return;
    // mongo load applies no post-processing, so the contracts are structurally identical.
    expect(interpretResult.value).toEqual(loadResult.value);
  });

  it('does not throw on malformed-but-parseable input and still reports interpreter diagnostics', () => {
    const schema = `model Dup {
  id ObjectId @id @map("_id")
}
model Dup {
  id ObjectId @id @map("_id")
}
model Other {
  id ObjectId @id @map("_id")
  bad Mystery
}
`;
    const source = interpretCapableSource(SOURCE_ID);
    const context = createMongoTestContext();
    const input = buildInterpretInput(schema, context);

    let result: ReturnType<typeof source.interpret> | undefined;
    expect(() => {
      result = source.interpret(input, context);
    }).not.toThrow();

    expect(result).toBeDefined();
    if (result === undefined || result.ok) {
      throw new Error('expected interpret to report diagnostics');
    }
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_UNSUPPORTED_FIELD_TYPE', sourceId: SOURCE_ID }),
      ]),
    );
  });

  it('does not throw on a recovered CST from a syntax-broken schema', () => {
    const schema = `model User {
  id ObjectId @id @map("_id")
`;
    const source = interpretCapableSource(SOURCE_ID);
    const context = createMongoTestContext();
    const input = buildInterpretInput(schema, context);

    let result: ReturnType<typeof source.interpret> | undefined;
    expect(() => {
      result = source.interpret(input, context);
    }).not.toThrow();

    expect(result).toBeDefined();
    expect(typeof result?.ok).toBe('boolean');
  });

  it('load merges parse and symbol-table seeds ahead of interpreter findings', async () => {
    const schema = `model Dup {
  id ObjectId @id @map("_id")
}
model Dup {
  id ObjectId @id @map("_id")
}
model Other {
  id ObjectId @id @map("_id")
  bad Mystery
}
`;
    const tempDir = await mkdtemp(join(tmpdir(), 'mongo-interpret-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(schemaPath, schema, 'utf-8');

    process.chdir(tempDir);
    const source = interpretCapableSource(SOURCE_ID);
    const loadResult = await source.load(createMongoTestContext({ resolvedInputs: [schemaPath] }));
    expect(loadResult.ok).toBe(false);
    if (loadResult.ok) return;

    const context = createMongoTestContext();
    const interpretResult = source.interpret(buildInterpretInput(schema, context), context);
    expect(interpretResult.ok).toBe(false);
    if (interpretResult.ok) return;

    const merged = loadResult.failure.diagnostics;
    const interpreterFindings = interpretResult.failure.diagnostics;
    expect(merged[0]).toMatchObject({ code: 'PSL_DUPLICATE_DECLARATION' });
    expect(merged.length).toBeGreaterThan(interpreterFindings.length);
    expect(merged.slice(merged.length - interpreterFindings.length)).toEqual(interpreterFindings);
    expect(loadResult.failure.summary).toBe(`Schema has ${merged.length} errors`);
  });
});
