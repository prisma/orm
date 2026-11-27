#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/7ee51c0ee5ce319dce63f7ef354eec674fe7e00d5db417e39f80649e15e5e96f/contract';
import startContract from '../../snapshots/7ee51c0ee5ce319dce63f7ef354eec674fe7e00d5db417e39f80649e15e5e96f/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/f5b8482c8ca961a609b6d8f7d2570b919dad610f2b5299da77aecea246bff2e1/contract';
import endContract from '../../snapshots/f5b8482c8ca961a609b6d8f7d2570b919dad610f2b5299da77aecea246bff2e1/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'avatar' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'bio' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'locale' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'phone' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'verified' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
