import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { ContractSourceContext } from '@internal/config/config-types';
import { expandContractInputs } from '@internal/config-loader';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import postgres from '@internal/target-postgres/control';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';

const stack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
});

const DIRECTIVE = '// use prisma-8\n';

describe('defineConfig with a glob contract path', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits a multi-file contract at the glob-derived default output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'psl-defineconfig-glob-'));
    tempDirs.push(dir);
    await writeFile(
      join(dir, 'user.prisma'),
      `${DIRECTIVE}model User {\n  id Int @id\n}\n`,
      'utf-8',
    );
    await writeFile(
      join(dir, 'post.prisma'),
      `${DIRECTIVE}model Post {\n  id Int @id\n}\n`,
      'utf-8',
    );

    const config = defineConfig({ contract: join(dir, '**/*.prisma') });
    expect(config.contract?.output).toBe(join(dir, 'contract.json'));

    const resolvedInputs = await expandContractInputs(config.contract?.source.inputs);
    const context: ContractSourceContext = {
      composedExtensions: [...stack.extensionIds],
      composedExtensionContracts: stack.extensionContracts,
      authoringContributions: stack.authoringContributions,
      codecLookup: stack.codecLookup,
      dataTypeLookup: stack.dataTypeLookup,
      controlMutationDefaults: stack.controlMutationDefaults,
      resolvedInputs,
      capabilities: stack.capabilities,
    };

    const result = await config.contract?.source.load(context);
    expect(result?.ok).toBe(true);
    if (result === undefined || !result.ok) return;

    const publicModels = result.value.domain.namespaces['public']?.models ?? {};
    expect(Object.keys(publicModels).sort()).toEqual(['Post', 'User']);
  });
});
