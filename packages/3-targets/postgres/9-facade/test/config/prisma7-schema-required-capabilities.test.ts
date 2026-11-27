import { readFile, rm, writeFile } from 'node:fs/promises';
import { executeContractEmit } from '@internal/cli/control-api';
import { postgresCapabilitiesByVersion } from '@internal/target-postgres/server-version';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { prisma7Schema } from '../../src/config/prisma7-schema';
import { postgres17, postgresDriver } from '../../src/contract/contract-capabilities';
import { scratchDir } from '../support/scratch';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('prisma7Schema', () => {
  it('writes the newest version’s list and the driver’s for a call with no list, and emit warns', async () => {
    const dir = await scratchDir('postgres-prisma7-required-capabilities-');
    tempDirs.push(dir);
    const schemaPath = join(dir, 'schema.prisma');
    await writeFile(
      schemaPath,
      'datasource db {\n  provider = "postgresql"\n}\nmodel User {\n  id Int @id\n}\n',
      'utf-8',
    );

    const result = await executeContractEmit({
      config: defineConfig({ contract: prisma7Schema(schemaPath) }),
      cwd: dir,
      outputPath: dir,
    });
    const contract = JSON.parse(await readFile(join(dir, 'contract.json'), 'utf-8'));

    expect(contract.capabilities).toEqual({
      ...postgresCapabilitiesByVersion[18],
      sql: { ...postgresCapabilitiesByVersion[18].sql, interactiveTransactions: true },
    });
    const line = `contract: prisma7Schema(\n  ${JSON.stringify(schemaPath)},\n  { requiredCapabilities: [...postgres18, ...postgresDriver] },\n)`;
    const imports =
      "import { postgres18, postgresDriver, prisma7Schema } from '@internal/postgres/config';";
    expect(result.sourceWarnings).toEqual([
      {
        code: 'CONTRACT.REQUIRED_CAPABILITIES_NOT_LISTED',
        message: `Your contract does not list the capabilities it requires, so it requires those of the newest PostgreSQL version and of the driver. Prisma 8.0 removes this default and requires the list. Write this as the contract entry in the config, with its import:\n\n${line}\n\n${imports}`,
        sourceId: schemaPath,
        severity: 'warning',
        data: { line, imports },
      },
    ]);
  });

  it("emits the list it states, which the config's target does not carry", async () => {
    const dir = await scratchDir('postgres-prisma7-required-capabilities-');
    tempDirs.push(dir);
    const schemaPath = join(dir, 'schema.prisma');
    await writeFile(
      schemaPath,
      'datasource db {\n  provider = "postgresql"\n}\nmodel User {\n  id Int @id\n}\n',
      'utf-8',
    );
    const config = defineConfig({
      contract: prisma7Schema(schemaPath, {
        requiredCapabilities: [...postgres17, ...postgresDriver],
      }),
    });

    await executeContractEmit({ config, cwd: dir, outputPath: dir });
    const contract = JSON.parse(await readFile(join(dir, 'contract.json'), 'utf-8'));

    expect({ target: config.target.capabilities, contract: contract.capabilities }).toEqual({
      target: {},
      contract: {
        ...postgresCapabilitiesByVersion[17],
        sql: { ...postgresCapabilitiesByVersion[17].sql, interactiveTransactions: true },
      },
    });
  });
});
