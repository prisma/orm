import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import arktypeJson from '@prisma/orm-extension-arktype-json/runtime';
import type { Vector } from '@prisma/orm-extension-pgvector/codec-types';
import pgvector from '@prisma/orm-extension-pgvector/runtime';
import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { runDbInit } from './utils';

// Round-trip coverage for the `Embedding.profile` arktype-json column.
// The fixture has carried this column since the original arktype-json
// landing, but no test wrote or read it — so the runtime correctness
// gaps (missing cast-lookup registration, hardcoded `JSON.parse(wire)`
// in decode) surfaced only in production. This file exercises the full
// pipeline:
//
//   create → encode (JSON.stringify) → SQL renderer
//   ($N::jsonb cast lookup) → driver write → driver read (pre-parsed
//   JSON for jsonb on `pg`) → decode (schema validate) → ORM result.

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

async function loadContractJson(): Promise<unknown> {
  const content = await readFile(contractJsonPath, 'utf-8');
  return JSON.parse(content);
}

async function withPostgresClient(
  callback: (db: ReturnType<typeof postgres<Contract>>) => Promise<void>,
): Promise<void> {
  const contractJson = await loadContractJson();
  await withDevDatabase(async ({ connectionString }) => {
    await runDbInit({ connectionString, contractJsonPath });
    const db = postgres({
      contract: contractFromJson<Contract>(contractJson),
      url: connectionString,
      extensions: [pgvector, arktypeJson],
    });
    let runtime: Runtime | undefined;
    try {
      runtime = await db.connect();
      await db.orm.public.User.first();
      await callback(db);
    } finally {
      await runtime?.close();
    }
  });
}

function buildEmbedding(seed: number): Vector<1536> {
  return Array.from({ length: 1536 }, (_, i) => (i + seed) / 1536) as Vector<1536>;
}

describe('arktype-json column round-trip', { timeout: timeouts.spinUpPpgDev }, () => {
  it('writes and reads back a typed JSON value through the ORM', async () => {
    await withPostgresClient(async (db) => {
      const created = await db.orm.public.Embedding.create({
        embedding: buildEmbedding(0),
        profile: { name: 'alice', age: 30 },
      });

      const found = await db.orm.public.Embedding.where({ id: created.id }).first();
      expect(found).not.toBeNull();
      expect(found!.profile).toEqual({ name: 'alice', age: 30 });
    });
  });
});

// Decode-side schema rejection is exercised at the unit level in
// `packages/3-extensions/arktype-json/test/arktype-json-codec.test.ts`
// (decode rejects pre-parsed payloads that violate the schema) and at
// the runtime level in
// `packages/2-sql/5-runtime/test/json-schema-validation.test.ts` (the
// runtime preserves `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` thrown from
// codec.decode without rewrapping). Reproducing it through the ORM is
// awkward because `create` returns a decoded row via `RETURNING`, so a
// schema-violating write surfaces the decode error from `create` itself
// rather than a subsequent read — there's no single ORM call that
// cleanly demonstrates the validate-on-read contract end-to-end without
// raw-SQL bypass infrastructure that this fixture doesn't expose. Unit
// coverage is sufficient.
