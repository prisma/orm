#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/81291ef0071d05ca539b065438b9c038f05fe05c7a29a2fa46b2c9d77740e758/contract';
import startContract from '../../snapshots/81291ef0071d05ca539b065438b9c038f05fe05c7a29a2fa46b2c9d77740e758/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/394928efe50bc178141cde5e5fc5b99188968f02ced07b4832a12eef0bf1007f/contract';
import endContract from '../../snapshots/394928efe50bc178141cde5e5fc5b99188968f02ced07b4832a12eef0bf1007f/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('avatar', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
