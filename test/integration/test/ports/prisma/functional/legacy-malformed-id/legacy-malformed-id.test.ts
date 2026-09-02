import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/0-legacy-ports/malformed-id (mongodb matrix entry —
// MongoDB is the only provider that strictly validates id fields, so this is a mongo port).
//
// prisma-next's mongo `ObjectId` codec accepts a string input and encodes it to a BSON
// ObjectId at write time; a malformed hex string is rejected with `RUNTIME.ENCODE_FAILED`
// — the equivalent of upstream's "Malformed ObjectID" error.
//
// Dispositions:
//   - 'should throw Malformed ObjectID error for: _id' — the create supplies a malformed
//     `ids` element (no explicit id); ported here.
//   - 'should throw Malformed ObjectID error: in 2 different fields' and
//     '... for: ids String[] @db.ObjectId' — NON-PORTED: both supply an explicit malformed
//     `_id` on create, but prisma-next's mongo `_id` is server-assigned and not settable via
//     `create()` (there is no `id` field in the create input), so a malformed `_id` cannot be
//     supplied through the public API. See non-ported/functional/legacy-malformed-id/.

describe('ports/prisma/functional/0-legacy-ports/malformed-id', () => {
  it(
    'should throw Malformed ObjectID error for: _id',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const created = db.user.create({ ids: ['something invalid'], name: 'Jane Doe' });
        await expect(created).rejects.toMatchObject({ code: 'RUNTIME.ENCODE_FAILED' });
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
