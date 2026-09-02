import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/14271
// (postgres matrix entry; optOut excludes all except postgresql).
//
// Subject: nested createMany (via hub.create with batteryLevels.createMany) followed by
// ordered findMany across relations returns the expected shape; deleting a Hub sets
// hubId to null on orphaned BatteryLevel rows (onDelete: SetNull).
//
// Upstream uses `createMany` nested inside `hub.create`. Prisma-next supports nested
// `create([...])` on 1:N relations. The subject (nested bulk insert + shape + cascade)
// is fully expressible.

function withIssue14271(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-14271', () => {
  it(
    'nested create + ordered findMany returns expected shape and SetNull cascade on delete',
    () =>
      withIssue14271(async ({ db }) => {
        // Seed hub-1 with 2 battery levels via nested create
        const hub1 = await db.public.Hub.create({
          name: 'hub-1',
          batteryLevels: (b) =>
            b.create([{ name: 'battery-1-hub-1' }, { name: 'battery-2-hub-1' }]),
        });

        // Seed hub-2 with 2 battery levels via nested create
        const hub2 = await db.public.Hub.create({
          name: 'hub-2',
          batteryLevels: (b) =>
            b.create([{ name: 'battery-1-hub-2' }, { name: 'battery-2-hub-2' }]),
        });

        // Verify hubs ordered by id (autoincrement Int)
        const hubs = await db.public.Hub.orderBy((h) => h.id.asc()).all();
        expect(hubs).toEqual([
          { id: hub1.id, name: 'hub-1' },
          { id: hub2.id, name: 'hub-2' },
        ]);

        // Verify all battery levels ordered by id
        const batteryLevels = await db.public.BatteryLevel.orderBy((b) => b.id.asc()).all();
        expect(batteryLevels).toEqual([
          { id: batteryLevels[0]!.id, name: 'battery-1-hub-1', hubId: hub1.id },
          { id: batteryLevels[1]!.id, name: 'battery-2-hub-1', hubId: hub1.id },
          { id: batteryLevels[2]!.id, name: 'battery-1-hub-2', hubId: hub2.id },
          { id: batteryLevels[3]!.id, name: 'battery-2-hub-2', hubId: hub2.id },
        ]);

        // Delete hub-1 — onDelete: SetNull nulls hubId on orphaned battery levels
        await db.public.Hub.where({ name: 'hub-1' }).delete();

        // Verify only hub-2 remains
        const remainingHubs = await db.public.Hub.all();
        expect(remainingHubs).toEqual([{ id: hub2.id, name: 'hub-2' }]);

        // Verify battery levels after delete — hub-1's levels have hubId = null
        const batteryLevelsAfterDelete = await db.public.BatteryLevel.orderBy((b) =>
          b.id.asc(),
        ).all();
        expect(batteryLevelsAfterDelete).toEqual([
          { id: batteryLevels[0]!.id, name: 'battery-1-hub-1', hubId: null },
          { id: batteryLevels[1]!.id, name: 'battery-2-hub-1', hubId: null },
          { id: batteryLevels[2]!.id, name: 'battery-1-hub-2', hubId: hub2.id },
          { id: batteryLevels[3]!.id, name: 'battery-2-hub-2', hubId: hub2.id },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
