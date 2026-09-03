import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/issues/15044 (postgres matrix entry; allProviders).
//
// Subject: `connect` inside an interactive transaction does not throw — creating a
// row that references two rows created earlier in the same transaction, then reading
// back the related rows, must work correctly.
//
// API translation:
//   - `$transaction(async (tx) => { ... })` → `transaction(async (tx) => { ... })`
//   - `tx.walletLink.create({ data: { wallet: { connect: { id } }, user: { connect: { id } } } })`
//     → `tx.orm.public.WalletLink.include('wallet').include('user').create({ ..., wallet: (w) => w.connect({ id }), user: (u) => u.connect({ id }) })`
//   - `select: { id, name, wallet, user }` → `.include('wallet').include('user')` on the create.
//
// The test is skipped for D1 (no iTx) and js_libsql in upstream; those drivers
// are not present in the prisma-next integration harness, so the skip is a no-op.
//
// Dispositions:
//   'should not throw error when using connect inside transaction' → PORTED (passing)

describe('ports/prisma/functional/issues-15044', () => {
  it(
    'should not throw error when using connect inside transaction',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ transaction }) => {
        const userName = randomUUID().slice(0, 8);
        const walletName = randomUUID().slice(0, 8);

        const result = await transaction(async (tx) => {
          const user = await tx.orm.public.User.create({ name: userName });
          const wallet = await tx.orm.public.Wallet.create({ name: walletName });

          return tx.orm.public.WalletLink.include('wallet')
            .include('user')
            .create({
              name: `${userName}-${walletName}`,
              wallet: (w) => w.connect({ id: wallet.id }),
              user: (u) => u.connect({ id: user.id }),
            });
        });

        expect(result.wallet['name']).toEqual(walletName);
        expect(result.user['name']).toEqual(userName);
      }),
    timeouts.spinUpPpgDev,
  );
});
