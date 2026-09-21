import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ContractSourceContext } from '@internal/config/config-types';
import type { AuthoringEntityContext } from '@internal/framework-components/authoring';
import { buildSymbolTable, createPslDiagnosticCollector } from '@internal/psl-parser';
import { hasPslInterpreter, type PslInterpretInput } from '@internal/psl-parser/interpret';
import { PslSources, parse } from '@internal/psl-parser/syntax';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { prismaContract } from '../src/exports/provider';
import { lowerDefaultForField } from '../src/psl-column-resolution';
import { createPostgresTestContext, postgresTarget, testEnumPslBlockDescriptor } from './fixtures';

const baseOptions = {
  target: postgresTarget,
  createNamespace: createTestSqlNamespace,
} as const;

const SOURCE_ID = './schema.prisma';

function buildInterpretInput(
  schema: string,
  context: ContractSourceContext,
  filename = SOURCE_ID,
): PslInterpretInput {
  const { document, sources } = parse(schema, filename);
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: context.authoringContributions.pslBlockDescriptors,
  });
  return { document, sources, symbolTable };
}

function interpretCapableSource(schemaPath: string) {
  const contract = prismaContract(schemaPath, baseOptions);
  if (!hasPslInterpreter(contract.source)) {
    throw new Error('expected prismaContract source to carry the interpret capability');
  }
  return contract.source;
}

describe('prismaContract interpret capability', () => {
  const originalCwd = process.cwd();
  const tempDirs: string[] = [];

  afterEach(async () => {
    process.chdir(originalCwd);
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('narrows a real prismaContract source via hasPslInterpreter', () => {
    const contract = prismaContract(SOURCE_ID, baseOptions);

    expect(hasPslInterpreter(contract.source)).toBe(true);
    if (!hasPslInterpreter(contract.source)) return;
    expect(typeof contract.source.interpret).toBe('function');
  });

  it('returns the same failure diagnostics as load when parse and symbol table are clean', async () => {
    const schema = `model User {
  id Int @id
  things Unknown[]
}
`;
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-interpret-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(schemaPath, schema, 'utf-8');

    process.chdir(tempDir);
    const source = interpretCapableSource(SOURCE_ID);
    const loadResult = await source.load(
      createPostgresTestContext({ resolvedInputs: [schemaPath] }),
    );
    expect(loadResult.ok).toBe(false);
    if (loadResult.ok) return;

    const context = createPostgresTestContext();
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
  id Int @id
  email String
}
`;
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-interpret-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(schemaPath, schema, 'utf-8');

    process.chdir(tempDir);
    const source = interpretCapableSource(SOURCE_ID);
    const loadResult = await source.load(
      createPostgresTestContext({ resolvedInputs: [schemaPath] }),
    );
    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) return;

    const context = createPostgresTestContext();
    const interpretResult = source.interpret(buildInterpretInput(schema, context), context);

    expect(interpretResult.ok).toBe(true);
    if (!interpretResult.ok) return;
    // baseOptions carries no defaultControlPolicy, so load's policy application
    // is an identity pass: interpret's pre-policy contract must be structurally
    // identical to the contract load returns.
    expect(interpretResult.value).toEqual(loadResult.value);
  });

  it('does not throw on malformed-but-parseable input and still reports interpreter diagnostics', () => {
    const schema = `model Dup {
  id Int @id
}
model Dup {
  id Int @id
}
model Other {
  id Int @id
  bad Mystery
}
`;
    const source = interpretCapableSource(SOURCE_ID);
    const context = createPostgresTestContext();
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
  id Int @id
`;
    const source = interpretCapableSource(SOURCE_ID);
    const context = createPostgresTestContext();
    const input = buildInterpretInput(schema, context);

    let result: ReturnType<typeof source.interpret> | undefined;
    expect(() => {
      result = source.interpret(input, context);
    }).not.toThrow();

    expect(result).toBeDefined();
    expect(typeof result?.ok).toBe('boolean');
  });

  it('derives direct default helper diagnostic source IDs from the parsed field node', () => {
    const context = createPostgresTestContext();
    const input = buildInterpretInput(
      `model User {
  id String @id @default(cuid(2))
}
`,
      context,
      'memory-schema.prisma',
    );
    const model = input.symbolTable.topLevel.models['User'];
    const field = model?.fields['id'];
    expect(model).toBeDefined();
    expect(field).toBeDefined();
    if (model === undefined || field === undefined) return;
    const diagnostics = createPslDiagnosticCollector(input.sources);

    lowerDefaultForField({
      modelName: model.name,
      fieldName: field.name,
      field,
      model,
      symbolTable: input.symbolTable,
      sources: input.sources,
      columnDescriptor: { codecId: 'pg/text@1', nativeType: 'text' },
      generatorDescriptorById: new Map(),
      defaultFunctionRegistry: new Map(),
      defaultLiteralTagRegistry: new Map(),
      codecLookup: context.codecLookup,
      diagnostics,
    });

    expect(diagnostics.toExternal()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          sourceId: 'memory-schema.prisma',
        }),
      ]),
    );
    expect(diagnostics.toExternal()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: './external-context.prisma' })]),
    );
  });

  it('derives cached field, default, and relation diagnostic source IDs from the parsed source name', () => {
    const source = interpretCapableSource('./external-context.prisma');
    const context = createPostgresTestContext();
    const cases = [
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        schema: `model User {
  id Int @id
  things Unknown[]
}
`,
      },
      {
        code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
        schema: `types {
  UuidNativeId = Uuid
}

model User {
  id UuidNativeId @id @default(nanoid())
}
`,
      },
      {
        code: 'PSL_ORPHANED_BACKRELATION',
        schema: `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
}
`,
      },
      {
        code: 'PSL_AMBIGUOUS_BACKRELATION',
        schema: `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  author User @relation(fields: [authorId], references: [id])
  authorId Int
  editor User @relation(fields: [editorId], references: [id])
  editorId Int
}
`,
      },
      {
        code: 'PSL_NON_UNIQUE_BACKRELATION',
        schema: `model User {
  id Int @id
  profile Profile
}

model Profile {
  id Int @id
  user User @relation(fields: [userId], references: [id])
  userId Int
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
      expect(result.failure.diagnostics, testCase.code).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: testCase.code,
            sourceId: 'memory-schema.prisma',
          }),
        ]),
      );
      expect(result.failure.diagnostics, testCase.code).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: testCase.code,
            sourceId: './external-context.prisma',
          }),
        ]),
      );
    }
  });

  it('load merges parse and symbol-table seeds ahead of interpreter findings', async () => {
    const schema = `model Dup {
  id Int @id
}
model Dup {
  id Int @id
}
model Other {
  id Int @id
  bad Mystery
}
`;
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-interpret-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(schemaPath, schema, 'utf-8');

    process.chdir(tempDir);
    const source = interpretCapableSource(SOURCE_ID);
    const loadResult = await source.load(
      createPostgresTestContext({ resolvedInputs: [schemaPath] }),
    );
    expect(loadResult.ok).toBe(false);
    if (loadResult.ok) return;

    const context = createPostgresTestContext();
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

it('attributes multi-document semantic failures to the owning file, not the entry or provider path', () => {
  const context = createPostgresTestContext();
  const entry = parse('', 'entry.prisma');
  const owned = parse('model User { id Int @id }\nmodel Broken { id Int @id(1) }', 'owned.prisma');
  const sources = new PslSources([
    [entry.document.syntax, entry.sources.sourceFileFor(entry.document.syntax)],
    [owned.document.syntax, owned.sources.sourceFileFor(owned.document.syntax)],
  ]);
  const { symbolTable } = buildSymbolTable({
    documents: [entry.document, owned.document],
    sources,
    pslBlockDescriptors: context.authoringContributions.pslBlockDescriptors,
  });
  const result = interpretCapableSource('provider.prisma').interpret(
    { document: entry.document, sources, symbolTable },
    context,
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failure.diagnostics.length).toBeGreaterThan(0);
  expect(
    result.failure.diagnostics.every((diagnostic) => diagnostic.sourceId === 'owned.prisma'),
  ).toBe(true);
  expect(result.failure.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_SYNTAX', span: expect.any(Object) }),
    ]),
  );
});

it('preserves unlocated and foreign-file contribution diagnostics at the public boundary', () => {
  const context = createPostgresTestContext();
  const unlocated = {
    code: 'EXTERNAL_UNLOCATED',
    message: 'Unlocated callback error',
    sourceId: 'foreign.prisma',
  };
  const located = {
    code: 'EXTERNAL_LOCATED',
    message: 'Located callback error',
    sourceId: 'foreign.prisma',
    span: { start: { offset: 9, line: 3, column: 2 }, end: { offset: 10, line: 3, column: 3 } },
  };
  const customContext = {
    ...context,
    authoringContributions: {
      ...context.authoringContributions,
      pslBlockDescriptors: {
        ...context.authoringContributions.pslBlockDescriptors,
        enum: testEnumPslBlockDescriptor,
      },
      entityTypes: {
        ...context.authoringContributions.entityTypes,
        enum: {
          kind: 'entity' as const,
          discriminator: 'enum',
          output: {
            factory: (_value: unknown, factoryContext: AuthoringEntityContext) => {
              expect(factoryContext.sourceId).toBe('owned.prisma');
              factoryContext.diagnostics?.push(unlocated);
              factoryContext.diagnostics?.push(located);
              return undefined;
            },
          },
        },
      },
    },
  };
  const input = buildInterpretInput(
    'enum Role { User }\nmodel User { id Int @id }',
    customContext,
    'owned.prisma',
  );
  const entry = parse('', 'entry.prisma');
  const sources = new PslSources([
    [entry.document.syntax, entry.sources.sourceFileFor(entry.document.syntax)],
    [input.document.syntax, input.sources.sourceFileFor(input.document.syntax)],
  ]);
  const result = interpretCapableSource('provider.prisma').interpret(
    { ...input, document: entry.document, sources },
    customContext,
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failure.diagnostics).toEqual([unlocated, located]);
});
