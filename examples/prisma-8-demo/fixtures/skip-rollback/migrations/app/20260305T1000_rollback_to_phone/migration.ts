#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/2791aba4b2c442542963802d3a01aa9b5c9be65d2a7462336c660aa030f0432b/contract';
import startContract from '../../snapshots/2791aba4b2c442542963802d3a01aa9b5c9be65d2a7462336c660aa030f0432b/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/345059ad82748235deff6cf12d40690f582d2420e63dccaf41c1c3fe654777b4/contract';
import endContract from '../../snapshots/345059ad82748235deff6cf12d40690f582d2420e63dccaf41c1c3fe654777b4/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: '__unbound__', table: 'user', column: 'bio' }),
      this.dropColumn({ schema: '__unbound__', table: 'user', column: 'posts' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
