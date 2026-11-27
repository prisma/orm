#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/740c5e6eb8f7b698e7bf642cf06993c6be509b9ad7105ec82a1ba1dd55b4632c/contract';
import endContract from '../../snapshots/740c5e6eb8f7b698e7bf642cf06993c6be509b9ad7105ec82a1ba1dd55b4632c/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/394928efe50bc178141cde5e5fc5b99188968f02ced07b4832a12eef0bf1007f/contract';
import startContract from '../../snapshots/394928efe50bc178141cde5e5fc5b99188968f02ced07b4832a12eef0bf1007f/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('bio', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
