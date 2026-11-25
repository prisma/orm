import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { executeContractEmit } from '@internal/cli/control-api';
import type { PrismaConfig } from '@internal/config/config-types';
import { postgresCapabilitiesByVersion } from '@internal/target-postgres/server-version';
import { join, resolve } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig, defineConfigFor } from '../../src/config/define-config';
import { createPostgresControlClient } from '../../src/exports/control';
import { version16Capabilities, versionsWithALaterFeature } from '../support/version-table';

const removedFlags = {
  postgres: ['orderBy', 'limit', 'lateral', 'jsonAgg', 'returning'],
  sql: ['enums'],
};

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function schemaDir(): Promise<{ readonly dir: string; readonly schemaPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'postgres-contract-version-'));
  tempDirs.push(dir);
  const schemaPath = join(dir, 'contract.prisma');
  await writeFile(schemaPath, '// use prisma-8\nmodel User {\n  id Int @id\n}\n', 'utf-8');
  return { dir, schemaPath };
}

async function emittedCapabilities(
  config: PrismaConfig<'sql', 'postgres'>,
  outputPath: string,
): Promise<Record<string, Record<string, boolean>>> {
  await executeContractEmit({ config, cwd: outputPath, outputPath });
  const contract = JSON.parse(await readFile(join(outputPath, 'contract.json'), 'utf-8'));
  return contract.capabilities;
}

function expectNoRemovedFlags(capabilities: Record<string, Record<string, boolean>>) {
  for (const [namespace, flags] of Object.entries(removedFlags)) {
    for (const flag of flags) {
      expect(capabilities[namespace] ?? {}).not.toHaveProperty(flag);
    }
  }
}

describe('the contract entry of the config', () => {
  it('refuses a Prisma schema path that states no version', () => {
    expect(() => defineConfig({ contract: './prisma/contract.prisma' as `${string}.ts` })).toThrow(
      "State the PostgreSQL version your database runs beside the contract path, for example contract: { path: './prisma/contract.prisma', version: 18 }. The supported versions are 15, 16, 17, 18.",
    );
  });

  it('refuses a version for a TypeScript contract, which states its own in defineContract', () => {
    expect(() =>
      defineConfig({ contract: { path: './prisma/contract.ts', version: 17 } as never }),
    ).toThrow(
      'The TypeScript contract "./prisma/contract.ts" states its PostgreSQL version and capabilities in defineContract. Remove version and capabilities from its contract entry in the config.',
    );
  });

  it('refuses a version the table does not list', () => {
    expect(() =>
      defineConfig({ contract: { path: './prisma/contract.prisma', version: 14 as 15 } }),
    ).toThrow('PostgreSQL 14 is not supported');
  });

  it('gives the target, the control adapter and the control driver no capabilities, so emit adds nothing to what the source writes', () => {
    const config = defineConfig({ contract: { path: './prisma/contract.prisma', version: 17 } });
    expect([
      config.target.capabilities,
      config.adapter?.capabilities,
      config.driver?.capabilities,
    ]).toEqual([{}, {}, {}]);
  });
});

describe('contract emit', () => {
  it('writes the row of the version a Prisma schema contract states, and its capabilities list', async () => {
    const { dir, schemaPath } = await schemaDir();

    const capabilities = await emittedCapabilities(
      defineConfigFor(versionsWithALaterFeature)({
        contract: {
          path: schemaPath,
          version: 16,
          capabilities: [{ sql: { interactiveTransactions: true } }, { http: { batch: true } }],
        },
      }),
      dir,
    );

    expect(capabilities).toEqual({
      ...version16Capabilities,
      sql: { ...version16Capabilities.sql, interactiveTransactions: true },
      http: { batch: true },
    });
    expectNoRemovedFlags(capabilities);
  });

  it('writes exactly the capabilities of a TypeScript contract: its row and its list, nothing added', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'postgres-contract-version-'));
    tempDirs.push(dir);

    const capabilities = await emittedCapabilities(
      defineConfig({
        contract: `${resolve(import.meta.dirname, 'fixtures', 'version-16-contract')}.ts`,
      }),
      dir,
    );

    expect(capabilities).toEqual({
      ...postgresCapabilitiesByVersion[16],
      sql: { ...postgresCapabilitiesByVersion[16].sql, interactiveTransactions: true },
    });
    expectNoRemovedFlags(capabilities);
  });
});

describe('the control client', () => {
  it('emits the row a Prisma schema contract states, which its source carries', async () => {
    const { dir, schemaPath } = await schemaDir();
    const { contract } = defineConfig({ contract: { path: schemaPath, version: 17 } });
    if (contract?.typesModule === undefined) throw new Error('defineConfig set no contract');

    const client = createPostgresControlClient();
    try {
      const emitted = await client.emit({
        contractConfig: {
          source: contract.source,
          output: join(dir, 'contract.json'),
          typesModule: contract.typesModule,
        },
      });
      if (!emitted.ok) throw new Error(emitted.failure.summary);
      expect(JSON.parse(emitted.value.contractJson).capabilities).toEqual(
        postgresCapabilitiesByVersion[17],
      );
    } finally {
      await client.close();
    }
  });
});
