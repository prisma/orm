#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/b14ebedaafc98e737ca69b4b61f4dc44b7ba85c117b412b933d78bb6dd557971/contract';
import startContract from '../../snapshots/b14ebedaafc98e737ca69b4b61f4dc44b7ba85c117b412b933d78bb6dd557971/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/6d1e5a8e37d7667130ed150b90b1811d9359b729b156c5f0808ffea1f8c4a886/contract';
import endContract from '../../snapshots/6d1e5a8e37d7667130ed150b90b1811d9359b729b156c5f0808ffea1f8c4a886/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('feature', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
