import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/22098-column_does_not_exist
// (allProviders including postgres).
//
// Subject: a findFirst query against a model with a @map column (physical column name
// uses non-ASCII characters: "TESTE_NÚMERICO") does not throw "column does not exist".
// The model field name is `TESTE_N_MERICO` (the valid TS name), @map to the non-ASCII
// DB column name.

function withIssue22098(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-22098-column_does_not_exist', () => {
  it(
    'does not throw error when querying model with mapped non-ASCII column',
    () =>
      withIssue22098(async ({ db }) => {
        const result = await db.public.test.first();
        expect(result).toBeNull();
      }),
    timeouts.spinUpPpgDev,
  );
});
