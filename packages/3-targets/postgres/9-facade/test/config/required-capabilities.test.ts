import { readFile, rm, writeFile } from 'node:fs/promises';
import { executeContractEmit } from '@internal/cli/control-api';
import type { PrismaConfig } from '@internal/config/config-types';
import { postgresCapabilitiesByVersion } from '@internal/target-postgres/server-version';
import { join, resolve } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { postgres17, postgres18, postgresDriver } from '../../src/contract/contract-capabilities';
import { createPostgresControlClient } from '../../src/exports/control';
import { scratchDir } from '../support/scratch';

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
  const dir = await scratchDir('postgres-required-capabilities-');
  tempDirs.push(dir);
  const schemaPath = join(dir, 'contract.prisma');
  await writeFile(schemaPath, '// use prisma-8\nmodel User {\n  id Int @id\n}\n', 'utf-8');
  return { dir, schemaPath };
}

async function emitted(
  config: PrismaConfig<'sql', 'postgres'>,
  outputPath: string,
): Promise<{
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly warnings: readonly unknown[];
}> {
  const result = await executeContractEmit({ config, cwd: outputPath, outputPath });
  const contract = JSON.parse(await readFile(join(outputPath, 'contract.json'), 'utf-8'));
  return { capabilities: contract.capabilities, warnings: result.sourceWarnings ?? [] };
}

async function emittedCapabilities(
  config: PrismaConfig<'sql', 'postgres'>,
  outputPath: string,
): Promise<Record<string, Record<string, boolean>>> {
  return (await emitted(config, outputPath)).capabilities;
}

function expectNoRemovedFlags(capabilities: Record<string, Record<string, boolean>>) {
  for (const [namespace, flags] of Object.entries(removedFlags)) {
    for (const flag of flags) {
      expect(capabilities[namespace] ?? {}).not.toHaveProperty(flag);
    }
  }
}

const withTheDriver = {
  ...postgresCapabilitiesByVersion[18],
  sql: { ...postgresCapabilitiesByVersion[18].sql, interactiveTransactions: true },
};

describe('the contract entry of the config', () => {
  const stateTheList =
    "State the capabilities your contract requires in requiredCapabilities beside the contract path './prisma/contract.prisma' in the config.";

  it('takes a Prisma schema path that lists no required capabilities, as a release candidate wrote it', () => {
    expect(() => defineConfig({ contract: './prisma/contract.prisma' })).not.toThrow();
    expect(() => defineConfig({ contract: { path: './prisma/contract.prisma' } })).not.toThrow();
  });

  it('refuses an empty list', () => {
    expect(() =>
      defineConfig({ contract: { path: './prisma/contract.prisma', requiredCapabilities: [] } }),
    ).toThrow(expect.objectContaining({ message: `${stateTheList} The list is empty.` }));
  });

  it('refuses a capability set, as the removed capabilities option took, as not a list', () => {
    expect(() =>
      defineConfig({
        contract: {
          path: './prisma/contract.prisma',
          requiredCapabilities: { sql: { returning: true } } as unknown as ['sql.returning'],
        },
      }),
    ).toThrow(
      expect.objectContaining({
        message:
          "requiredCapabilities beside the contract path './prisma/contract.prisma' in the config is not a list. State the capabilities your contract requires as a list of capability keys.",
      }),
    );
  });

  it('refuses a list for a TypeScript contract, which lists its own in defineContract', () => {
    expect(() =>
      defineConfig({
        contract: { path: './prisma/contract.ts', requiredCapabilities: postgres18 } as never,
      }),
    ).toThrow(
      expect.objectContaining({
        message:
          'The TypeScript contract "./prisma/contract.ts" lists the capabilities it requires in defineContract. Remove requiredCapabilities from its contract entry in the config.',
      }),
    );
  });

  it('gives the target, the control adapter and the control driver no capabilities, so emit adds nothing to what the source writes', () => {
    const config = defineConfig({
      contract: { path: './prisma/contract.prisma', requiredCapabilities: postgres17 },
    });
    expect([
      config.target.capabilities,
      config.adapter?.capabilities,
      config.driver?.capabilities,
    ]).toEqual([{}, {}, {}]);
  });
});

describe('contract emit', () => {
  it('writes exactly the list a Prisma schema contract states', async () => {
    const { dir, schemaPath } = await schemaDir();

    const capabilities = await emittedCapabilities(
      defineConfig({
        contract: {
          path: schemaPath,
          requiredCapabilities: [...postgres18, ...postgresDriver, 'http.batch'],
        },
      }),
      dir,
    );

    expect(capabilities).toEqual({ ...withTheDriver, http: { batch: true } });
    expectNoRemovedFlags(capabilities);
  });

  it('writes exactly the list of a TypeScript contract, nothing added', async () => {
    const dir = await scratchDir('postgres-required-capabilities-');
    tempDirs.push(dir);

    const capabilities = await emittedCapabilities(
      defineConfig({
        contract: `${resolve(import.meta.dirname, 'fixtures', 'required-list-contract')}.ts`,
      }),
      dir,
    );

    const { returning: _returning, ...sql } = postgresCapabilitiesByVersion[16].sql;
    expect(capabilities).toEqual({
      ...postgresCapabilitiesByVersion[16],
      sql: { ...sql, interactiveTransactions: true },
      http: { batch: true },
    });
    expectNoRemovedFlags(capabilities);
  });
});

describe('contract emit for a contract that lists no required capabilities', () => {
  const notListed = (where: string, module: string) =>
    `Your contract does not list the capabilities it requires, so it requires those of the newest PostgreSQL version and of the driver. Add \`requiredCapabilities: [...postgres18, ...postgresDriver]\` ${where}, with \`import { postgres18, postgresDriver } from '${module}';\`. Prisma 8.0 removes this default and requires the list.`;

  it.each([
    ['a bare path', (schemaPath: string) => schemaPath],
    ['an entry without the list', (schemaPath: string) => ({ path: schemaPath })],
  ])(
    'writes the newest version’s list and the driver’s for a Prisma schema given as %s, and warns once with what to add',
    async (_, contractOf) => {
      const { dir, schemaPath } = await schemaDir();

      const result = await emitted(defineConfig({ contract: contractOf(schemaPath) }), dir);

      expect(result).toEqual({
        capabilities: withTheDriver,
        warnings: [
          {
            code: 'CONTRACT.REQUIRED_CAPABILITIES_NOT_LISTED',
            message: notListed(
              `beside the contract path '${schemaPath}' in the config, as \`contract: { path, requiredCapabilities }\``,
              '@internal/postgres/config',
            ),
            sourceId: schemaPath,
            severity: 'warning',
            data: {
              line: 'requiredCapabilities: [...postgres18, ...postgresDriver]',
              imports: "import { postgres18, postgresDriver } from '@internal/postgres/config';",
            },
          },
        ],
      });
    },
  );

  it('writes the same list for a TypeScript contract, and warns with the import of its contract builder', async () => {
    const dir = await scratchDir('postgres-required-capabilities-');
    tempDirs.push(dir);
    const contractPath = `${resolve(import.meta.dirname, 'fixtures', 'unlisted-contract')}.ts`;

    const result = await emitted(defineConfig({ contract: contractPath }), dir);

    expect(result.capabilities).toEqual(withTheDriver);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'CONTRACT.REQUIRED_CAPABILITIES_NOT_LISTED',
        message: notListed('in defineContract', '@internal/postgres/contract-builder'),
        sourceId: contractPath,
      }),
    ]);
  });

  it('warns nothing for a contract that lists them', async () => {
    const { dir, schemaPath } = await schemaDir();

    const result = await emitted(
      defineConfig({ contract: { path: schemaPath, requiredCapabilities: [...postgres18] } }),
      dir,
    );

    expect(result.warnings).toEqual([]);
  });
});

describe('the control client', () => {
  it('emits the list a Prisma schema contract states, which its source carries', async () => {
    const { dir, schemaPath } = await schemaDir();
    const { contract } = defineConfig({
      contract: { path: schemaPath, requiredCapabilities: [...postgres18, ...postgresDriver] },
    });
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
      expect(JSON.parse(emitted.value.contractJson).capabilities).toEqual(withTheDriver);
    } finally {
      await client.close();
    }
  });
});
