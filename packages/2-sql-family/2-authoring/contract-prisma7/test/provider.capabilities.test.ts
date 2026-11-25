import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma7Contract } from '../src/provider';
import { postgresSourceContext } from './support';

function schemaFile(): string {
  const dir = join(tmpdir(), `prisma7-provider-capabilities-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
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
  it('adds the capabilities it is given to the contract', async () => {
    const without = await capabilitiesWith();
    expect(
      await capabilitiesWith({ sql: { interactiveTransactions: true }, http: { batch: true } }),
    ).toEqual({
      ...without,
      sql: { ...without['sql'], interactiveTransactions: true },
      http: { batch: true },
    });
  });
});
