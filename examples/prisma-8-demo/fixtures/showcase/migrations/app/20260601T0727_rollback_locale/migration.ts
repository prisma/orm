#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/41a05d80e8c865fc1ae198a57a9433f989fa05c32bad91e4a329749b7555f3a7/contract';
import startContract from '../../snapshots/41a05d80e8c865fc1ae198a57a9433f989fa05c32bad91e4a329749b7555f3a7/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/740c5e6eb8f7b698e7bf642cf06993c6be509b9ad7105ec82a1ba1dd55b4632c/contract';
import endContract from '../../snapshots/740c5e6eb8f7b698e7bf642cf06993c6be509b9ad7105ec82a1ba1dd55b4632c/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropColumn({ schema: '__unbound__', table: 'account', column: 'locale' })];
  }
}

MigrationCLI.run(import.meta.url, M);
