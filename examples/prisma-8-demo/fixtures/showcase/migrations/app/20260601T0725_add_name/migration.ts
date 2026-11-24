#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/4d66211adc67c38f8778b75bc992d740f194190a2366fd4deb494503895521cd/contract';
import endContract from '../../snapshots/4d66211adc67c38f8778b75bc992d740f194190a2366fd4deb494503895521cd/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/dfe9c3c7016ae2b495e0728d4599c0f5bf9833951a99ab2c3c94074e53093de3/contract';
import startContract from '../../snapshots/dfe9c3c7016ae2b495e0728d4599c0f5bf9833951a99ab2c3c94074e53093de3/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('name', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
