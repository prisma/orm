#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/7999fa221ce9c00f04321344eb006a39bd4485ba5a913c8964ae6c1fb7a8049d/contract';
import startContract from '../../snapshots/7999fa221ce9c00f04321344eb006a39bd4485ba5a913c8964ae6c1fb7a8049d/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/f2501f92fe261b6e89bfcf335d7647ea5bdec8492e0587ed17dcbd63bfe81ef9/contract';
import endContract from '../../snapshots/f2501f92fe261b6e89bfcf335d7647ea5bdec8492e0587ed17dcbd63bfe81ef9/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropColumn({ schema: '__unbound__', table: 'widget', column: 'count' })];
  }
}

MigrationCLI.run(import.meta.url, M);
