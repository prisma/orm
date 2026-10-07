import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('ports/engines/new/regressions/prisma_8265', () => {
  it(
    'nested updateMany changes the updated-at timestamp of the rows it updates (nested_update_many_timestamps)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const created = await db.public.Order.select('id')
          .include('order_lines', (lines) => lines.select('updated_at'))
          .create({
            id: 'order_1',
            order_lines: (lines) => lines.create({ id: 'order_line_1', external_id: '1' }),
          });
        const updatedAt = created.order_lines[0]?.updated_at;

        await new Promise((resolve) => setTimeout(resolve, 50));

        const updated = await db.public.Order.where({ id: 'order_1' })
          .select('id')
          .include('order_lines', (lines) => lines.select('updated_at'))
          .update({
            order_lines: (lines) =>
              lines
                .where((line) => line.external_id.neq('something'))
                .updateAll({ external_id: 'changed' }),
          });
        const changedUpdatedAt = updated?.order_lines[0]?.updated_at;

        expect(updatedAt).toBeDefined();
        expect(changedUpdatedAt).toBeDefined();
        expect(String(changedUpdatedAt)).not.toBe(String(updatedAt));
      }),
    timeouts.spinUpPpgDev,
  );
});
