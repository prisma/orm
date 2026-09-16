import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
} from '@internal/config/config-types';
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
      defaultLiteralTagRegistry: new Map(),
      defaultFunctionRegistry: new Map(),
      generatorDescriptors: [],
    },
    resolvedInputs: [],
    capabilities: {},
    ...overrides,
  };
}

function buildInterpretInput(
  schema: string,
  context: ContractSourceContext,
  filename = SOURCE_ID,
): PslInterpretInput {
  const { document, sources } = parse(schema, filename);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sources,
    pslBlockDescriptors: context.authoringContributions.pslBlockDescriptors,
  });
  return { document, sources, symbolTable };
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

  it('derives cached field, default, and relation diagnostic source IDs from the parsed source name', () => {
    const source = interpretCapableSource('./external-context.prisma');
    const context = createMongoTestContext();
    const cases = [
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        line: 3,
        schema: `model User {
  id ObjectId @id @map("_id")
  bad Mystery
}
`,
      },
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        line: 3,
        schema: `model User {
  id ObjectId @id @map("_id")
  createdAt String @default("now")
}
`,
      },
      {
        code: 'PSL_ORPHANED_BACKRELATION',
        line: 3,
        schema: `model User {
  id ObjectId @id @map("_id")
  posts Post[]
}

model Post {
  id ObjectId @id @map("_id")
}
`,
      },
    ];

    for (const testCase of cases) {
      const result = source.interpret(
        buildInterpretInput(testCase.schema, context, 'memory-schema.prisma'),
        context,
      );

      expect(result.ok, testCase.code).toBe(false);
      if (result.ok) continue;
      const matching = result.failure.diagnostics.filter(
        (diagnostic): diagnostic is ContractSourceDiagnostic => diagnostic.code === testCase.code,
      );
      expect(matching, testCase.code).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceId: 'memory-schema.prisma',
            span: expect.objectContaining({
              start: expect.objectContaining({ line: testCase.line }),
            }),
          }),
        ]),
      );
      expect(matching, testCase.code).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceId: './external-context.prisma' }),
        ]),
      );
    }
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
