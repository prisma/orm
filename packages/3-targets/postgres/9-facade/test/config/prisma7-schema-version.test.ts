import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { executeContractEmit } from '@internal/cli/control-api';
import { postgresServerVersions } from '@internal/target-postgres/server-version';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { prisma7Schema } from '../../src/config/prisma7-schema';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('prisma7Schema', () => {
  it('refuses a call that states no version', () => {
    expect(() => prisma7Schema('./prisma/schema.prisma', {} as { version: 18 })).toThrow(
      "State the PostgreSQL version your database runs beside the Prisma 7 schema path, for example prisma7Schema('./prisma/schema.prisma', { version: 18 }). The supported versions are 15, 16, 17, 18.",
    );
  });

  it('binds the config target for the version', () => {
    const config = defineConfig({
      contract: prisma7Schema('prisma/schema.prisma', { version: 17 }),
    });
    expect(config.target.capabilities).toEqual(postgresServerVersions[17]);
  });

  it('emits the version row and the capabilities list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'postgres-prisma7-version-'));
    tempDirs.push(dir);
    const schemaPath = join(dir, 'schema.prisma');
    await writeFile(
      schemaPath,
      'datasource db {\n  provider = "postgresql"\n}\nmodel User {\n  id Int @id\n}\n',
      'utf-8',
    );
    const config = defineConfig({
      contract: prisma7Schema(schemaPath, {
        version: 16,
        capabilities: [{ sql: { interactiveTransactions: true } }],
      }),
    });

    await executeContractEmit({ config, cwd: dir, outputPath: dir });
    const contract = JSON.parse(await readFile(join(dir, 'contract.json'), 'utf-8'));

    expect(contract.capabilities).toEqual({
      ...postgresServerVersions[16],
      sql: { ...postgresServerVersions[16].sql, interactiveTransactions: true },
    });
  });
});
