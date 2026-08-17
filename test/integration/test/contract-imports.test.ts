import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { EmitStackInput } from '@internal/emitter';
import { createTestContract, emit } from '@internal/emitter/test/utils';
import {
  extractCodecTypeImports,
  extractComponentIds,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlEmission } from '@internal/sql-contract-emitter';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSqlDescriptorBundle } from '../utils/framework-components';

const execFileAsync = promisify(execFile);

/**
 * Runs TypeScript compiler on a tsconfig and asserts success.
 * On failure, includes the generated contract.d.ts content in the error for debugging.
 */
async function runTscAndAssertSuccess(
  tsconfigPath: string,
  workspaceRoot: string,
  contractDtsContent: string,
): Promise<void> {
  try {
    const { stderr } = await execFileAsync(
      'pnpm',
      ['exec', 'tsc', '--noEmit', '--project', tsconfigPath],
      {
        cwd: workspaceRoot,
      },
    );

    if (stderr?.trim() && !stderr.includes('Found 0 errors')) {
      throw new Error(`TypeScript compilation failed:\n${stderr}`);
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object') {
      const errorObj = error as { stderr?: string; stdout?: string; message?: string };
      const stderr = errorObj.stderr || '';
      const stdout = errorObj.stdout || '';
      const message = errorObj.message || '';
      const fullError = stderr || stdout || message;

      throw new Error(
        `TypeScript compilation failed:\n${fullError}\n\nGenerated contract.d.ts:\n${contractDtsContent}`,
      );
    }
    throw error;
  }
}

describe('contract.d.ts imports resolution', () => {
  let testDir: string;
  const workspaceRoot = join(__dirname, '../../..');

  beforeEach(async () => {
    testDir = join(tmpdir(), `prisma-8-imports-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it(
    'generates contract.d.ts with all imports resolving correctly',
    async () => {
      const ir = createTestContract({
        extensions: {
          postgres: { version: '0.0.1' },
          pg: {},
        },
        models: {
          User: {
            storage: {
              table: 'user',
              fields: {
                id: { column: 'id' },
                email: { column: 'email' },
                createdAt: { column: 'createdAt' },
              },
            },
            fields: {
              id: { type: { kind: 'scalar' as const, codecId: 'pg/int4@1' }, nullable: false },
              email: { type: { kind: 'scalar' as const, codecId: 'pg/text@1' }, nullable: false },
              createdAt: {
                type: { kind: 'scalar' as const, codecId: 'pg/timestamptz-temporal@1' },
                nullable: false,
              },
            },
            relations: {},
          },
          Post: {
            storage: {
              table: 'post',
              fields: {
                id: { column: 'id' },
                title: { column: 'title' },
                userId: { column: 'userId' },
              },
            },
            fields: {
              id: { type: { kind: 'scalar' as const, codecId: 'pg/int4@1' }, nullable: false },
              title: { type: { kind: 'scalar' as const, codecId: 'pg/text@1' }, nullable: false },
              userId: { type: { kind: 'scalar' as const, codecId: 'pg/int4@1' }, nullable: false },
            },
            relations: {},
          },
        },
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              kind: 'schema' as const,
              entries: {
                table: {
                  user: {
                    columns: {
                      id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                      email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                      createdAt: {
                        codecId: 'pg/timestamptz-temporal@1',
                        nativeType: 'timestamptz',
                        nullable: false,
                      },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                  post: {
                    columns: {
                      id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                      title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                      userId: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                },
              },
            },
          },
        },
      });

      const { adapter, target, extensions } = getSqlDescriptorBundle();
      const allDescriptors = [target, adapter, ...extensions];
      const codecTypeImports = extractCodecTypeImports(allDescriptors);
      const extensionIds = extractComponentIds({ id: 'sql' }, target, adapter, extensions);
      const options: EmitStackInput = {
        codecTypeImports,
        extensionIds,
      };

      const result = await emit(ir, options, sqlEmission);

      const contractJsonPath = join(testDir, 'contract.json');
      const contractDtsPath = join(testDir, 'contract.d.ts');

      await writeFile(contractJsonPath, result.contractJson);
      await writeFile(contractDtsPath, result.contractDts);

      // Verify the generated contract.d.ts contains the correct import
      const contractDtsContent = await readFile(contractDtsPath, 'utf-8');
      expect(contractDtsContent).toContain("from '@internal/sql-contract/types'");
      expect(contractDtsContent).toContain('Contract');
      expect(contractDtsContent).toContain('ContractWithTypeMaps');
      expect(contractDtsContent).not.toContain("from './contract-types'");

      // Create a test TypeScript file that imports the generated contract.d.ts
      const testFileContent = `import type { Contract, CodecTypes } from './contract';
import type { SqlStorage } from '@internal/sql-contract/types';

// Verify we can use the Contract type
// biome-ignore lint/suspicious/noExplicitAny: test code with type assertions
const _contract: Contract = {} as any;
const _storage: Contract['storage'] = _contract.storage;
const _namespaces: Contract['storage']['namespaces'] = _storage.namespaces;
const _tables: Contract['storage']['namespaces']['__unbound__']['entries']['table'] =
  _namespaces['__unbound__'].entries.table;

// Verify we can access CodecTypes
const _codecTypes: CodecTypes = {} as any;

// Verify SqlStorage is importable from @internal/sql-contract/types
const _sqlStorage: SqlStorage = _contract.storage;

// Verify the contract type is correctly structured
type UserTable = Contract['storage']['namespaces']['__unbound__']['entries']['table']['user'];
type UserColumns = UserTable['columns'];
type UserIdColumn = UserColumns['id'];
`;

      const testFilePath = join(testDir, 'test-imports.ts');
      await writeFile(testFilePath, testFileContent, 'utf-8');

      // Create a tsconfig.json for the test directory
      // Use path mappings to resolve workspace packages from their dist directories
      const relativeToWorkspace = relative(testDir, workspaceRoot).replace(/\\/g, '/');
      const tsconfigContent = JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'esnext',
          moduleResolution: 'bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          types: [],
          baseUrl: '.',
          paths: {
            '@internal/sql-contract/types': [
              `${relativeToWorkspace}/packages/2-sql/1-core/contract/dist/types.d.mts`,
            ],
            '@internal/sql-contract/types/*': [
              `${relativeToWorkspace}/packages/2-sql/1-core/contract/dist/*`,
            ],
            '@internal/adapter-postgres/*': [
              `${relativeToWorkspace}/packages/3-targets/6-adapters/postgres/dist/*`,
            ],
          },
        },
        include: ['*.ts', '*.d.ts'],
      });

      // Create a package.json to mark the directory as ESM
      const packageJsonContent = JSON.stringify({ type: 'module' });
      const packageJsonPath = join(testDir, 'package.json');
      await writeFile(packageJsonPath, packageJsonContent, 'utf-8');

      const tsconfigPath = join(testDir, 'tsconfig.json');
      await writeFile(tsconfigPath, tsconfigContent, 'utf-8');

      // Use TypeScript compiler to verify all imports resolve
      // Use pnpm to run TypeScript from the workspace root so path mappings work
      await runTscAndAssertSuccess(tsconfigPath, workspaceRoot, contractDtsContent);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'generated contract.d.ts can be imported and used in TypeScript',
    async () => {
      const ir = createTestContract({
        extensions: {
          postgres: { version: '0.0.1' },
          pg: {},
        },
        models: {
          User: {
            storage: {
              table: 'user',
              fields: {
                id: { column: 'id' },
                email: { column: 'email' },
              },
            },
            fields: {
              id: { type: { kind: 'scalar' as const, codecId: 'pg/int4@1' }, nullable: false },
              email: { type: { kind: 'scalar' as const, codecId: 'pg/text@1' }, nullable: false },
            },
            relations: {},
          },
        },
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              kind: 'schema' as const,
              entries: {
                table: {
                  user: {
                    columns: {
                      id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                      email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                },
              },
            },
          },
        },
      });

      const { adapter, target, extensions } = getSqlDescriptorBundle();
      const allDescriptors = [target, adapter, ...extensions];
      const codecTypeImports = extractCodecTypeImports(allDescriptors);
      const extensionIds = extractComponentIds({ id: 'sql' }, target, adapter, extensions);
      const options: EmitStackInput = {
        codecTypeImports,
        extensionIds,
      };

      const result = await emit(ir, options, sqlEmission);

      const contractJsonPath = join(testDir, 'contract.json');
      const contractDtsPath = join(testDir, 'contract.d.ts');

      await writeFile(contractJsonPath, result.contractJson);
      await writeFile(contractDtsPath, result.contractDts);

      // Verify the contract.d.ts imports are correct
      const contractDtsContent = await readFile(contractDtsPath, 'utf-8');
      expect(contractDtsContent).toContain("from '@internal/sql-contract/types'");
      expect(contractDtsContent).toContain("from '@internal/target-postgres/codec-types'");

      // Create a comprehensive test file that uses all exported types
      const testFileContent = `import type { Contract, CodecTypes, Namespaces } from './contract';
import { PostgresContractSerializer as SqlContractSerializer } from '@internal/target-postgres/runtime';
import contractJson from './contract.json' with { type: 'json' };

// Verify we can validate the contract
const contract = new SqlContractSerializer().deserializeContract(contractJson) as Contract;

// Verify we can access all exported types
const _namespaces: Namespaces = contract.storage.namespaces;
const _tables = _namespaces['__unbound__'].entries.table;
// Models resolve per-namespace from the domain plane (no flat top-level Models export).
const _models = contract.domain.namespaces['__unbound__'].models;

// Verify we can access nested types
type UserTable = Namespaces['__unbound__']['entries']['table']['user'];
type UserColumns = UserTable['columns'];
type UserIdColumn = UserColumns['id'];
type UserIdCodecId = UserIdColumn['codecId'];

// Verify CodecTypes is available
// biome-ignore lint/suspicious/noExplicitAny: test code with type assertions
const _codecTypes: CodecTypes = {} as any;
type CodecTextType = CodecTypes['pg/text@1'];
type CodecIntType = CodecTypes['pg/int4@1'];
`;

      const testFilePath = join(testDir, 'test-usage.ts');
      await writeFile(testFilePath, testFileContent, 'utf-8');

      // Create a tsconfig.json that includes node_modules resolution
      // Use path mappings to resolve workspace packages from their dist directories
      const relativeToWorkspace = relative(testDir, workspaceRoot).replace(/\\/g, '/');
      const tsconfigContent = JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'esnext',
          moduleResolution: 'bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          types: [],
          baseUrl: '.',
          paths: {
            '@internal/sql-contract-ts/*': [
              `${relativeToWorkspace}/packages/2-sql/2-authoring/contract-ts/dist/*`,
            ],
            '@internal/sql-contract/types': [
              `${relativeToWorkspace}/packages/2-sql/1-core/contract/dist/types.d.mts`,
            ],
            '@internal/sql-contract/types/*': [
              `${relativeToWorkspace}/packages/2-sql/1-core/contract/dist/*`,
            ],
            '@internal/family-sql/ir': [
              `${relativeToWorkspace}/packages/2-sql/9-family/dist/ir.d.mts`,
            ],
            '@internal/family-sql/*': [`${relativeToWorkspace}/packages/2-sql/9-family/dist/*`],
            '@internal/adapter-postgres/*': [
              `${relativeToWorkspace}/packages/3-targets/6-adapters/postgres/dist/*`,
            ],
            '@internal/target-postgres/runtime': [
              `${relativeToWorkspace}/packages/3-targets/3-targets/postgres/dist/runtime.d.mts`,
            ],
            '@internal/target-postgres/*': [
              `${relativeToWorkspace}/packages/3-targets/3-targets/postgres/dist/*`,
            ],
            '@internal/framework-components/codec': [
              `${relativeToWorkspace}/packages/1-framework/1-core/framework-components/dist/codec.d.mts`,
            ],
            '@internal/framework-components/*': [
              `${relativeToWorkspace}/packages/1-framework/1-core/framework-components/dist/*`,
            ],
            '@internal/contract/types': [
              `${relativeToWorkspace}/packages/1-framework/0-foundation/contract/dist/types.d.mts`,
            ],
            '@internal/contract/*': [
              `${relativeToWorkspace}/packages/1-framework/0-foundation/contract/dist/*`,
            ],
            '@internal/sql-query/*': [
              `${relativeToWorkspace}/packages/sql-query/dist/exports/*.d.ts`,
            ],
          },
        },
        include: ['*.ts', '*.d.ts'],
      });

      // Create a package.json to mark the directory as ESM
      const packageJsonContent = JSON.stringify({ type: 'module' });
      const packageJsonPath = join(testDir, 'package.json');
      await writeFile(packageJsonPath, packageJsonContent, 'utf-8');

      const tsconfigPath = join(testDir, 'tsconfig.json');
      await writeFile(tsconfigPath, tsconfigContent, 'utf-8');

      // Use TypeScript compiler to verify all imports resolve
      // Use pnpm to run TypeScript from the workspace root so path mappings work
      await runTscAndAssertSuccess(tsconfigPath, workspaceRoot, contractDtsContent);
    },
    timeouts.spinUpPpgDev,
  );
});
