#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/241635fcf8563b1a928d8bc2a6edc8935acf07bca77432a0ff41cd23a48b3ad4/contract';
import startContract from '../../snapshots/241635fcf8563b1a928d8bc2a6edc8935acf07bca77432a0ff41cd23a48b3ad4/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/dfe9c3c7016ae2b495e0728d4599c0f5bf9833951a99ab2c3c94074e53093de3/contract';
import endContract from '../../snapshots/dfe9c3c7016ae2b495e0728d4599c0f5bf9833951a99ab2c3c94074e53093de3/contract.json' with {
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
