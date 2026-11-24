#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/2791aba4b2c442542963802d3a01aa9b5c9be65d2a7462336c660aa030f0432b/contract';
import startContract from '../../snapshots/2791aba4b2c442542963802d3a01aa9b5c9be65d2a7462336c660aa030f0432b/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/06685743c4efade6ebe23107ee1446856d8162256db929bc6cf1b489ac50cd9f/contract';
import endContract from '../../snapshots/06685743c4efade6ebe23107ee1446856d8162256db929bc6cf1b489ac50cd9f/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('avatar', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
