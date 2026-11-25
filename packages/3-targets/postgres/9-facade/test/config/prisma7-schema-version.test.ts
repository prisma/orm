import { readFile, rm, writeFile } from 'node:fs/promises';
import { executeContractEmit } from '@internal/cli/control-api';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { prisma7Schema, prisma7SchemaFor } from '../../src/config/prisma7-schema';
import { scratchDir } from '../support/scratch';
import { versionsWithALaterFeature } from '../support/version-table';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('prisma7Schema', () => {
  it('refuses a call that states no version', () => {
    expect(() => prisma7Schema('./prisma/schema.prisma', {} as { databaseVersion: 18 })).toThrow(
      "State the PostgreSQL version your database runs beside the Prisma 7 schema path, for example prisma7Schema('./prisma/schema.prisma', { databaseVersion: 18 }). The supported versions are 15, 16, 17, 18.",
    );
  });

  it('refuses a call with no options', () => {
    expect(() =>
      prisma7Schema('./prisma/schema.prisma', undefined as unknown as { databaseVersion: 18 }),
    ).toThrow('State the PostgreSQL version your database runs beside the Prisma 7 schema path');
  });

  it.each([16, 17] as const)(
    "emits the row of version %i it states and its capabilities list, which the config's target does not carry",
    async (version) => {
      const dir = await scratchDir('postgres-prisma7-version-');
      tempDirs.push(dir);
      const schemaPath = join(dir, 'schema.prisma');
      await writeFile(
        schemaPath,
        'datasource db {\n  provider = "postgresql"\n}\nmodel User {\n  id Int @id\n}\n',
        'utf-8',
      );
      const config = defineConfig({
        contract: prisma7SchemaFor(versionsWithALaterFeature)(schemaPath, {
          databaseVersion: version,
          capabilities: [{ sql: { interactiveTransactions: true } }],
        }),
      });

      await executeContractEmit({ config, cwd: dir, outputPath: dir });
      const contract = JSON.parse(await readFile(join(dir, 'contract.json'), 'utf-8'));

      expect({ target: config.target.capabilities, contract: contract.capabilities }).toEqual({
        target: {},
        contract: {
          ...versionsWithALaterFeature[version],
          sql: { ...versionsWithALaterFeature[version].sql, interactiveTransactions: true },
        },
      });
    },
  );
});
