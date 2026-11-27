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
  it('refuses a call that lists no required capabilities, with no example', () => {
    expect(() =>
      prisma7Schema('./prisma/schema.prisma', {} as { requiredCapabilities: [] }),
    ).toThrow(
      "State the capabilities your contract requires in requiredCapabilities in the options of prisma7Schema('./prisma/schema.prisma'). The list is missing or empty.",
    );
  });

  it('refuses a call with no options', () => {
    expect(() =>
      prisma7Schema('./prisma/schema.prisma', undefined as unknown as { requiredCapabilities: [] }),
    ).toThrow('The list is missing or empty.');
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
