import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { TargetPackRef } from '@internal/framework-components/components';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { typescriptContractFromPath } from '../src/config-types';
import { stubContext } from './contract-source-context';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const forPostgres = {
  target: postgresTargetPack,
  contractBuilderModule: '@prisma/orm-postgres/contract-builder',
};

describe('typescriptContractFromPath with the target the config is for', () => {
  const loadModule = async (source: string) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'sql-contract-ts-target-'));
    const contractPath = join(tempDir, 'contract.ts');
    try {
      await writeFile(contractPath, source, 'utf-8');
      return await typescriptContractFromPath('./contract.ts', undefined, forPostgres)
        .source.load({ ...stubContext, resolvedInputs: [contractPath] })
        .then(
          (result) => ({ loaded: result.ok ? result.value : result.failure }),
          (error) => ({
            refused: {
              code: Object(error).code,
              message: Object(error).message,
              fix: Object(error).fix,
              meta: Object(error).meta,
            },
          }),
        );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  };

  it(
    'refuses a contract built for another target, naming both targets and the module to import defineContract from',
    async () => {
      expect(
        await loadModule(
          `export default { targetFamily: 'sql', target: 'mysql', storage: { namespaces: {} } };\n`,
        ),
      ).toEqual({
        refused: {
          code: 'CONTRACT.TARGET_MISMATCH',
          message:
            'The TypeScript contract "./contract.ts" was built for target "mysql", but this defineConfig is for target "postgres".',
          fix: 'Import defineContract from @prisma/orm-postgres/contract-builder.',
          meta: { contract: './contract.ts', expected: 'postgres', actual: 'mysql' },
        },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'loads a contract built for the target, and refuses an export that is not a SQL contract, naming the file',
    async () => {
      expect({
        same: await loadModule(
          `export default { targetFamily: 'sql', target: 'postgres', storage: { namespaces: {} } };\n`,
        ),
        notContract: await loadModule('export const contract = { models: {} };\n'),
      }).toEqual({
        same: {
          loaded: { targetFamily: 'sql', target: 'postgres', storage: { namespaces: {} } },
        },
        notContract: {
          refused: {
            code: 'CONTRACT.EXPORT_INVALID',
            message:
              'The TypeScript contract "./contract.ts" exports a value that is not a SQL contract.',
            fix: "Export the result of the target package's defineContract as the module's default or contract export.",
            meta: { path: expect.stringMatching(/contract\.ts$/), reason: 'not-a-contract' },
          },
        },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'refuses as not a SQL contract an export with a target but no SQL contract shape, null or list namespaces, or a null default export',
    async () => {
      const notContract = { refused: { code: 'CONTRACT.EXPORT_INVALID' } };
      expect({
        targetOnly: await loadModule(`export default { target: 'mysql', models: {} };\n`),
        nullNamespaces: await loadModule(
          `export default { targetFamily: 'sql', target: 'postgres', storage: { namespaces: null } };\n`,
        ),
        listNamespaces: await loadModule(
          `export default { targetFamily: 'sql', target: 'postgres', storage: { namespaces: [] } };\n`,
        ),
        nullDefault: await loadModule('export default null;\n'),
      }).toMatchObject({
        targetOnly: notContract,
        nullNamespaces: notContract,
        listNamespaces: notContract,
        nullDefault: notContract,
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'loads the contract export when the default export is null',
    async () => {
      expect(
        await loadModule(
          `export default null;\nexport const contract = { targetFamily: 'sql', target: 'postgres', storage: { namespaces: {} } };\n`,
        ),
      ).toEqual({
        loaded: { targetFamily: 'sql', target: 'postgres', storage: { namespaces: {} } },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'refuses a contract of another family as built for another target',
    async () => {
      expect(
        await loadModule(
          `export default { targetFamily: 'mongo', target: 'mongo', storage: { collections: {} } };\n`,
        ),
      ).toEqual({
        refused: {
          code: 'CONTRACT.TARGET_MISMATCH',
          message:
            'The TypeScript contract "./contract.ts" was built for target "mongo", but this defineConfig is for target "postgres".',
          fix: 'Import defineContract from @prisma/orm-postgres/contract-builder.',
          meta: { contract: './contract.ts', expected: 'postgres', actual: 'mongo' },
        },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'still reports a module with no contract export as such',
    async () => {
      expect(await loadModule('export const notContract = {};\n')).toMatchObject({
        refused: { code: 'CONTRACT.MODULE_EXPORT_MISSING' },
      });
    },
    timeouts.typeScriptCompilation,
  );
});
