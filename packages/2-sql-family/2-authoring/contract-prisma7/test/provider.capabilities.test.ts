import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma7Contract } from '../src/provider';
import { postgresSourceContext } from './support';

const scratchRoot = join(import.meta.dirname, '..', '.vitest', 'scratch');
const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function schemaFile(): string {
  mkdirSync(scratchRoot, { recursive: true });
  const dir = mkdtempSync(join(scratchRoot, 'provider-capabilities-'));
  scratchDirs.push(dir);
  const schemaPath = join(dir, 'schema.prisma');
  writeFileSync(
    schemaPath,
    'datasource db {\n  provider = "postgresql"\n}\nmodel User {\n  id Int @id\n}\n',
  );
  return schemaPath;
}

async function capabilitiesWith(capabilities?: Record<string, Record<string, boolean>>) {
  const schemaPath = schemaFile();
  const result = await prisma7Contract(schemaPath, {
    binding: prisma7PostgresBinding,
    ...(capabilities === undefined ? {} : { capabilities }),
  }).source.load(postgresSourceContext([schemaPath]));
  if (!result.ok) throw new Error(result.failure.summary);
  return result.value.capabilities;
}

describe('prisma7Contract capabilities', () => {
  it('builds the contract with the capabilities it is given, keeping only the flags that are on', async () => {
    const without = await capabilitiesWith();
    expect(
      await capabilitiesWith({
        sql: { interactiveTransactions: true, pipelining: false },
        http: { batch: true },
      }),
    ).toEqual({
      ...without,
      sql: { ...without['sql'], interactiveTransactions: true },
      http: { batch: true },
    });
  });
});
