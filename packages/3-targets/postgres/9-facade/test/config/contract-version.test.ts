import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { executeContractEmit } from '@internal/cli/control-api';
import { postgresServerVersions } from '@internal/target-postgres/server-version';
import { join, resolve } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';

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

async function emittedCapabilities(
  config: ReturnType<typeof defineConfig>,
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
    expect(() => defineConfig({ contract: './prisma/contract.prisma' })).toThrow(
      "State the PostgreSQL version your database runs beside the contract path, for example contract: { path: './prisma/contract.prisma', version: 18 }. The supported versions are 15, 16, 17, 18.",
    );
  });

  it('refuses a version for a TypeScript contract, which states its own in defineContract', () => {
    expect(() => defineConfig({ contract: { path: './prisma/contract.ts', version: 17 } })).toThrow(
      'The TypeScript contract "./prisma/contract.ts" states its PostgreSQL version and capabilities in defineContract. Remove version and capabilities from its contract entry in the config.',
    );
  });

  it('refuses a version the table does not list', () => {
    expect(() =>
      defineConfig({ contract: { path: './prisma/contract.prisma', version: 14 as 15 } }),
    ).toThrow('PostgreSQL version 14 is not supported');
  });

  it("binds the target for the version, and gives the control adapter and driver no capabilities, since the application's adapter and driver reach the contract through its list", () => {
    const config = defineConfig({ contract: { path: './prisma/contract.prisma', version: 17 } });
    expect([
      config.target.capabilities,
      config.adapter?.capabilities,
      config.driver?.capabilities,
    ]).toEqual([postgresServerVersions[17], {}, {}]);
  });

  it('keeps a bare TypeScript path, whose target declares no capabilities', () => {
    expect(defineConfig({ contract: './prisma/contract.ts' }).target.capabilities).toEqual({});
  });
});

describe('contract emit', () => {
  it('writes the version row and the capabilities list of a Prisma schema contract', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'postgres-contract-version-'));
    tempDirs.push(dir);
    const schemaPath = join(dir, 'contract.prisma');
    await writeFile(schemaPath, '// use prisma-8\nmodel User {\n  id Int @id\n}\n', 'utf-8');

    const capabilities = await emittedCapabilities(
      defineConfig({
        contract: {
          path: schemaPath,
          version: 16,
          capabilities: [{ sql: { interactiveTransactions: true } }, { http: { batch: true } }],
        },
      }),
      dir,
    );

    expect(capabilities).toEqual({
      ...postgresServerVersions[16],
      sql: { ...postgresServerVersions[16].sql, interactiveTransactions: true },
      http: { batch: true },
    });
    expectNoRemovedFlags(capabilities);
  });

  it('writes the version row and the capabilities list of a TypeScript contract', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'postgres-contract-version-'));
    tempDirs.push(dir);

    const capabilities = await emittedCapabilities(
      defineConfig({
        contract: resolve(import.meta.dirname, 'fixtures', 'version-16-contract.ts'),
      }),
      dir,
    );

    expect(capabilities).toEqual({
      ...postgresServerVersions[16],
      sql: { ...postgresServerVersions[16].sql, interactiveTransactions: true },
    });
    expectNoRemovedFlags(capabilities);
  });
});
