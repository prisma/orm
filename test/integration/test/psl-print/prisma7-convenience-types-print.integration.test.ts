import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7Contract } from '@internal/sql-contract-prisma7/provider';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { blindCast } from '@internal/utils/casts';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  composePostgresStack,
  printAndReadBack,
  printContract,
  serializedWithoutCapabilities,
  sourceContext,
} from './print-and-read-back';

const PRISMA7_SCHEMA = `datasource db {
  provider = "postgresql"
}

model Event {
  id      Int      @id
  at      DateTime
  zoned   DateTime @db.Timestamptz(3)
  zoned6  DateTime @db.Timestamptz(6)
  day     DateTime @db.Date
  clock   DateTime @db.Time(0)
  offset  DateTime @db.Timetz(3)
  touched DateTime @updatedAt
}
`;

const directory = mkdtempSync(join(tmpdir(), 'prisma7-convenience-'));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

async function readPrisma7(schema: string): Promise<Contract<SqlStorage>> {
  const schemaPath = join(directory, 'schema.prisma');
  writeFileSync(schemaPath, schema);
  const result = await prisma7Contract(schemaPath, { binding: prisma7PostgresBinding }).source.load(
    sourceContext(composePostgresStack(), [schemaPath]),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return blindCast<Contract<SqlStorage>, 'the Prisma 7 source yields a SQL contract'>(result.value);
}

function fieldLines(printed: string): Record<string, string> {
  return Object.fromEntries(
    printed.split('\n').flatMap((line) => {
      const match = /^\s+(\w+)\s+(.+?)\s*$/.exec(line.replace(/\s+/g, ' '));
      return match?.[1] === undefined || match[2] === undefined || match[1] === 'model'
        ? []
        : [[match[1], match[2]]];
    }),
  );
}

describe('a Prisma 7 schema printed after prisma7Schema reads it', () => {
  it('writes each DateTime field as the convenience type its column and value become', async () => {
    const contract = await readPrisma7(PRISMA7_SCHEMA);
    expect(fieldLines(printContract(contract).text)).toMatchObject({
      at: 'DateTime(storage: timestamp)',
      zoned: 'DateTime',
      zoned6: 'DateTime(precision: 6)',
      day: 'Date',
      clock: 'Time(precision: 0)',
      offset: 'Time(storage: timetz, precision: 3)',
      touched: 'DateTime(storage: timestamp) @onCreate(now()) @onUpdate(now())',
    });
    const printed = await printAndReadBack(contract);
    expect(serializedWithoutCapabilities(printed)).toEqual(serializedWithoutCapabilities(contract));
    expect(printed.storage.storageHash).toBe(contract.storage.storageHash);
  });
});
