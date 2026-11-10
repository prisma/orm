import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import mysqlAdapter from '@internal/adapter-mysql/control';
import type { ContractSourceContext } from '@internal/config/config-types';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import mysql from '@internal/target-mysql/control';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig } from '../src/config/define-config';
import { defineContract } from '../src/exports/contract-builder';

const stack = createControlStack({
  family: sql,
  target: mysql,
  adapter: mysqlAdapter,
  driver: mysqlDriver,
});

function contextFor(file: string): ContractSourceContext {
  return {
    composedExtensions: [...stack.extensionIds],
    defaultNamespaceId: stack.target.defaultNamespaceId,
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    pslDiagnostics: stack.family.pslDiagnostics,
    codecLookup: stack.codecLookup,
    dataTypes: stack.dataTypes,
    controlMutationDefaults: stack.controlMutationDefaults,
    generatorFunctions: stack.generatorFunctions,
    resolvedInputs: [file],
    capabilities: stack.capabilities,
  };
}

describe('namespace blocks on the MySQL target', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it('refuses a PSL namespace block', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mysql-namespace-refusal-'));
    tempDirs.push(dir);
    const file = join(dir, 'contract.prisma');
    await writeFile(
      file,
      '// use prisma-8\nnamespace auth {\n  model User {\n    id Int @id\n  }\n}\n',
      'utf-8',
    );

    const result = await defineConfig({ contract: file }).contract?.source.load(contextFor(file));

    expect(
      result?.ok === false
        ? result.failure.diagnostics.map(({ code, message }) => ({ code, message }))
        : result,
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
        message:
          'MySQL does not support `namespace auth { … }` blocks (declare models at the document top level instead).',
      },
    ]);
  });

  it('refuses a namespaces list in defineContract', () => {
    expect(() => defineContract({ namespaces: ['auth'] } as never)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAMESPACE_UNSUPPORTED',
        message:
          'defineContract: MySQL contracts cannot declare namespaces. Received namespaces: ["auth"].',
      }),
    );
  });
});
