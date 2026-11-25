import { readFile, rm, writeFile } from 'node:fs/promises';
import { executeContractEmit } from '@internal/cli/control-api';
import type { PrismaConfig } from '@internal/config/config-types';
import { postgresCapabilitiesByVersion } from '@internal/target-postgres/server-version';
import { join, resolve } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { prisma7Schema } from '../../src/config/prisma7-schema';
import { scratchDir } from '../support/scratch';
import { connectionList } from './fixtures/connection-list';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function emitted(
  configFor: (dir: string) => Promise<PrismaConfig<'sql', 'postgres'>>,
): Promise<unknown> {
  const dir = await scratchDir('postgres-capabilities-routes-');
  tempDirs.push(dir);
  const config = await configFor(dir);
  await executeContractEmit({ config, cwd: dir, outputPath: dir });
  return JSON.parse(await readFile(join(dir, 'contract.json'), 'utf-8')).capabilities;
}

describe('the same version and capabilities list, through every authoring route', () => {
  it('emits the same capabilities, with false turning a flag off and absent from contract.json', async () => {
    const { returning: _returning, ...sql } = postgresCapabilitiesByVersion[16].sql;
    const expected = {
      ...postgresCapabilitiesByVersion[16],
      sql: { ...sql, interactiveTransactions: true },
      http: { batch: true },
    };

    const routes = {
      typescript: await emitted(async () =>
        defineConfig({
          contract: `${resolve(import.meta.dirname, 'fixtures', 'connection-list-contract')}.ts`,
        }),
      ),
      prismaSchema: await emitted(async (dir) => {
        const path = join(dir, 'contract.prisma');
        await writeFile(path, '// use prisma-8\nmodel User {\n  id Int @id\n}\n', 'utf-8');
        return defineConfig({
          contract: { path, databaseVersion: 16, capabilities: connectionList },
        });
      }),
      prisma7Schema: await emitted(async (dir) => {
        const path = join(dir, 'schema.prisma');
        await writeFile(
          path,
          'datasource db {\n  provider = "postgresql"\n}\nmodel User {\n  id Int @id\n}\n',
          'utf-8',
        );
        return defineConfig({
          contract: prisma7Schema(path, { databaseVersion: 16, capabilities: connectionList }),
        });
      }),
    };

    expect(routes).toEqual({
      typescript: expected,
      prismaSchema: expected,
      prisma7Schema: expected,
    });
  });
});
