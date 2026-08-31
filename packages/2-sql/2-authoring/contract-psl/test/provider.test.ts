import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { applySpecifierDefaultControlPolicy } from '@internal/contract/apply-specifier-default-control-policy';
import type { Contract } from '@internal/contract/types';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { prismaContract } from '../src/exports/provider';
import {
  createPostgresTestContext,
  modelsOf,
  pgvectorAuthoringContributions,
  pgvectorExtensionPack,
  postgresTarget,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

describe('prismaContract provider helper', () => {
  const originalCwd = process.cwd();
  const tempDirs: string[] = [];
  const baseOptions = {
    target: postgresTarget,
    createNamespace: createTestSqlNamespace,
  } as const;

  afterEach(async () => {
    process.chdir(originalCwd);
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  describe('source format discriminator', () => {
    it('tags the source as PSL', () => {
      const contract = prismaContract('./src/contract/schema.prisma', baseOptions);
      expect(contract.source.format).toBe('psl');
    });
  });

  describe('output derivation (TML-2461)', () => {
    it('derives output colocated with schema path when output is not provided', () => {
      const contract = prismaContract('./src/contract/schema.prisma', baseOptions);
      expect(contract.output).toBe('./src/contract/contract.json');
    });

    it('honours an explicit output over the derived default', () => {
      const contract = prismaContract('./src/contract/schema.prisma', {
        ...baseOptions,
        output: 'src/generated/contract.json',
      });
      expect(contract.output).toBe('src/generated/contract.json');
    });

    it('derives output for a non-"schema" filename by replacing the extension', () => {
      const contract = prismaContract('./prisma/main.prisma', baseOptions);
      expect(contract.output).toBe('./prisma/main.json');
    });

    it('does not rewrite filenames that merely end in "schema"', () => {
      const contract = prismaContract('./prisma/my-schema.prisma', baseOptions);
      expect(contract.output).toBe('./prisma/my-schema.json');
    });
  });

  describe('defaultControlPolicy specifier precedence', () => {
    it('applies the specifier default when the interpreted contract omits one', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-policy-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const config = prismaContract('./schema.prisma', {
        ...baseOptions,
        defaultControlPolicy: 'external',
      });
      const result = await config.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.defaultControlPolicy).toBe('external');
    });

    it('leaves defaultControlPolicy unset when the specifier omits it', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-policy-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const config = prismaContract('./schema.prisma', baseOptions);
      const result = await config.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toHaveProperty('defaultControlPolicy');
    });

    it('keeps an existing defaultControlPolicy on the loaded contract', () => {
      const loaded = {
        targetFamily: 'sql',
        target: 'postgres',
        defaultControlPolicy: 'managed',
      } as Contract;
      const applied = applySpecifierDefaultControlPolicy(loaded, 'external');
      expect(applied.defaultControlPolicy).toBe('managed');
    });
  });

  describe('given a valid schema', () => {
    it('returns contract config and emits SQL Contract from schema path', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  email String
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', {
        ...baseOptions,
        output: 'output/contract.json',
      });

      expect(contract.output).toBe('output/contract.json');
      expect(contract.source.inputs).toEqual(['./schema.prisma']);
      const result = await contract.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toMatchObject({
        targetFamily: 'sql',
        target: 'postgres',
        storage: {
          namespaces: {
            public: {
              entries: {
                table: {
                  user: expect.any(Object),
                },
              },
            },
          },
        },
      });
    });

    it('resolves relative schema paths from configDir when cwd differs', async () => {
      const configDir = await mkdtemp(join(tmpdir(), 'psl-provider-config-'));
      const cwdDir = await mkdtemp(join(tmpdir(), 'psl-provider-cwd-'));
      tempDirs.push(configDir, cwdDir);
      const schemaPath = join(configDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  email String
}
`,
        'utf-8',
      );

      process.chdir(cwdDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toMatchObject({
        storage: {
          namespaces: {
            public: {
              entries: {
                table: {
                  user: expect.any(Object),
                },
              },
            },
          },
        },
      });
    });

    it('interprets relation backrelation lists and emits relation metadata', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const models = modelsOf(result.value) as Record<
        string,
        { relations?: Record<string, unknown> }
      >;
      expect(models['User']?.relations).toMatchObject({
        posts: {
          cardinality: '1:N',
          on: {
            localFields: ['id'],
            targetFields: ['userId'],
          },
        },
      });
      expect(models['Post']?.relations).toMatchObject({
        user: {
          cardinality: 'N:1',
          on: {
            localFields: ['userId'],
            targetFields: ['id'],
          },
        },
      });
    });
  });

  describe('given unsupported constructs in schema', () => {
    it('returns unsupported construct diagnostics with source span context', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  things Unknown[]
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            sourceId: './schema.prisma',
            message: expect.stringContaining('Unknown'),
            span: expect.objectContaining({
              start: expect.objectContaining({ line: 3 }),
            }),
          }),
        ]),
      );
    });

    it('returns diagnostics when navigation list fields declare unsupported attributes', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  posts Post[] @unique
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
            sourceId: './schema.prisma',
            message: expect.stringContaining('User.posts'),
            span: expect.objectContaining({
              start: expect.objectContaining({ line: 3 }),
            }),
          }),
        ]),
      );
    });
  });

  describe('given a syntactically invalid schema', () => {
    it('surfaces parse() diagnostics via the combined interpret path in one run', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNTERMINATED_BLOCK',
            sourceId: './schema.prisma',
            span: expect.objectContaining({
              start: expect.objectContaining({ line: expect.any(Number) }),
            }),
          }),
        ]),
      );
    });

    it('surfaces buildSymbolTable duplicate-declaration diagnostics via the combined path', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
}
model User {
  id Int @id
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_DUPLICATE_DECLARATION',
            sourceId: './schema.prisma',
          }),
        ]),
      );
    });

    it('surfaces BOTH a symbol-table error and an interpreter error in one combined run', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model Dup {
  id Int @id
}
model Dup {
  id Int @id
}
model Other {
  id Int @id
  bad Mystery
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const codes = result.failure.diagnostics.map((d) => d.code);
      expect(codes).toContain('PSL_DUPLICATE_DECLARATION');
      expect(codes).toContain('PSL_UNSUPPORTED_FIELD_TYPE');
    });
  });

  describe('given namespaced extension constructors in schema', () => {
    it('returns diagnostics when extension namespace is unrecognized', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model Document {
  id Int @id
  embedding pgvector.Vector(length: 1536)
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
            sourceId: './schema.prisma',
            span: expect.objectContaining({
              start: expect.objectContaining({ line: 3 }),
            }),
          }),
        ]),
      );
    });

    it('interprets namespaced extension constructors when extension is composed', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model Document {
  id Int @id
  embedding pgvector.Vector(length: 1536)
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', {
        ...baseOptions,
        composedExtensionPackRefs: [pgvectorExtensionPack],
      });
      const result = await contract.source.load(
        createPostgresTestContext({
          composedExtensions: ['pgvector'],
          authoringContributions: pgvectorAuthoringContributions,
          resolvedInputs: [schemaPath],
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)).toMatchObject({
        document: {
          columns: {
            embedding: {
              codecId: 'pg/vector@1',
              nativeType: 'vector',
              typeParams: { length: 1536 },
            },
          },
        },
      });
      expect(result.value.extensions).toMatchObject({
        pgvector: {
          version: pgvectorExtensionPack.version,
        },
      });
    });
  });

  describe('given unsupported legacy extension attributes in schema', () => {
    it('returns unsupported attribute diagnostics even when the extension is composed', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `types {
  Embedding1536 = Bytes @pgvector.column(length: 1536)
}

model Document {
  id Int @id
  embedding Embedding1536
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', {
        ...baseOptions,
        composedExtensionPackRefs: [pgvectorExtensionPack],
      });
      const result = await contract.source.load(
        createPostgresTestContext({
          composedExtensions: ['pgvector'],
          authoringContributions: pgvectorAuthoringContributions,
          resolvedInputs: [schemaPath],
        }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
            sourceId: './schema.prisma',
            message: expect.stringContaining('pgvector.column'),
          }),
        ]),
      );
    });
  });

  describe('given supported default functions in schema', () => {
    it('maps function defaults to execution or storage defaults', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  cuid2 String @default(cuid(2))
  uuidV7 String @default(uuid(7))
  nanoid16 String @default(nanoid(16))
  dbExpr String @default(dbgenerated("gen_random_uuid()"))
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.execution).toMatchObject({
        mutations: {
          defaults: [
            {
              ref: { namespace: 'public', table: 'user', column: 'cuid2' },
              onCreate: { kind: 'generator', id: 'cuid2' },
            },
            {
              ref: { namespace: 'public', table: 'user', column: 'nanoid16' },
              onCreate: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
            },
            {
              ref: { namespace: 'public', table: 'user', column: 'uuidV7' },
              onCreate: { kind: 'generator', id: 'uuidv7' },
            },
          ],
        },
      });
      expect(result.value.storage).toMatchObject({
        namespaces: {
          public: {
            entries: {
              table: {
                user: {
                  columns: {
                    dbExpr: {
                      default: {
                        kind: 'function',
                        expression: 'gen_random_uuid()',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
    });
  });

  describe('given unsupported default functions', () => {
    it('returns actionable default function diagnostics with spans', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  cuidValue String @default(cuid())
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({ resolvedInputs: [schemaPath] }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
            sourceId: './schema.prisma',
            span: expect.objectContaining({
              start: expect.objectContaining({ line: 3 }),
            }),
          }),
        ]),
      );
    });
  });

  describe('given provider inputs without assembled mutation defaults', () => {
    it('rejects a default function call as invalid syntax when the registry is empty', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  externalId String @default(uuid())
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({
          controlMutationDefaults: {
            defaultFunctionRegistry: new Map(),
            generatorDescriptors: [],
          },
          resolvedInputs: [schemaPath],
        }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
            message: expect.stringContaining('Expected one of'),
          }),
        ]),
      );
    });
  });

  describe('given a broken codec configuration', () => {
    it('returns diagnostics when a field uses a type with no registered constructor', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(schemaPath, 'model User {\n  id Int @id\n  data Bytes\n}\n', 'utf-8');

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);

      const result = await contract.source.load(
        createPostgresTestContext({
          authoringContributions: {
            field: {},
            type: {
              Int: {
                kind: 'typeConstructor',
                output: { codecId: 'pg/int4@1', nativeType: 'int4' },
              },
            },
            entityTypes: {},
            pslBlockDescriptors: {},
            modelAttributes: {},
            attributeSpecs: { model: {}, field: {} },
          },
          resolvedInputs: [schemaPath],
        }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          }),
        ]),
      );
    });
  });

  describe('scalar derivation from the unified namespace', () => {
    it('resolves base scalars from top-level zero-arg constructors', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(schemaPath, 'model User {\n  id Int @id\n  name String\n}\n', 'utf-8');

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({
          resolvedInputs: [schemaPath],
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)).toMatchObject({
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4' },
            name: { codecId: 'pg/text@1', nativeType: 'text' },
          },
        },
      });
    });
  });

  describe('given a missing schema file', () => {
    it('returns PSL_SCHEMA_READ_FAILED diagnostics when schema file is missing', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);

      process.chdir(tempDir);
      const contract = prismaContract('./missing.prisma', baseOptions);
      const result = await contract.source.load(
        createPostgresTestContext({ resolvedInputs: [join(tempDir, 'missing.prisma')] }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.failure.summary).toBe('Failed to read Prisma schema at "./missing.prisma"');
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_SCHEMA_READ_FAILED',
            sourceId: './missing.prisma',
          }),
        ]),
      );
      expect(result.failure.meta).toMatchObject({
        schemaPath: './missing.prisma',
        absoluteSchemaPath: expect.stringMatching(/missing\.prisma$/),
      });
    });
  });
});
