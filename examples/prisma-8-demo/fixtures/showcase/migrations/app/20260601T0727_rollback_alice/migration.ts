#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/6c01c7bf566e073fc66946ed1890f9825cbd37707435b19f0aab4b6e46c2604e/contract';
import endContract from '../../snapshots/6c01c7bf566e073fc66946ed1890f9825cbd37707435b19f0aab4b6e46c2604e/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/81291ef0071d05ca539b065438b9c038f05fe05c7a29a2fa46b2c9d77740e758/contract';
import startContract from '../../snapshots/81291ef0071d05ca539b065438b9c038f05fe05c7a29a2fa46b2c9d77740e758/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'name' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'phone' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
