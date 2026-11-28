#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/740c5e6eb8f7b698e7bf642cf06993c6be509b9ad7105ec82a1ba1dd55b4632c/contract';
import startContract from '../../snapshots/740c5e6eb8f7b698e7bf642cf06993c6be509b9ad7105ec82a1ba1dd55b4632c/contract.json' with {
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
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'phone' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
