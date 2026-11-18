import postgres from '@internal/postgres/runtime';
import { contractFromJson as postgresContractFromJson } from '@internal/postgres/static';
import sqlite from '@internal/sqlite/runtime';
import { contractFromJson as sqliteContractFromJson } from '@internal/sqlite/static';
import { Client } from 'pg';
import { expect, it } from 'vitest';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };
import type { Contract as SqliteContract } from './_fixture/sqlite/generated/contract';
import sqliteContractJson from './_fixture/sqlite/generated/contract.json' with { type: 'json' };

it('@prisma/adapter-pg cannot be used with `provider = "mysql"`', () => {
  const mysqlContractJson = { ...contractJson, target: 'mysql' };

  expect(() =>
    postgres({
      contract: postgresContractFromJson<Contract>(mysqlContractJson),
      pg: new Client(),
      verifyMarker: false,
    }),
  ).toThrow(
    expect.objectContaining({
      name: 'RuntimeError',
      code: 'RUNTIME.CONTRACT_TARGET_MISMATCH',
      message: "Contract target 'mysql' does not match runtime target descriptor 'postgres'.",
      details: { actual: 'mysql', expected: 'postgres' },
    }),
  );
});

it('@prisma/adapter-d1 cannot be used with `provider = "postgresql"`', () => {
  const postgresContractJson = { ...sqliteContractJson, target: 'postgres' };

  expect(() =>
    sqlite({
      contract: sqliteContractFromJson<SqliteContract>(postgresContractJson),
      verifyMarker: false,
    }),
  ).toThrow(
    expect.objectContaining({
      name: 'RuntimeError',
      code: 'RUNTIME.CONTRACT_TARGET_MISMATCH',
      message: "Contract target 'postgres' does not match runtime target descriptor 'sqlite'.",
      details: { actual: 'postgres', expected: 'sqlite' },
    }),
  );
});
