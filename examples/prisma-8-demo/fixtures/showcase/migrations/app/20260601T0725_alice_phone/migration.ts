#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/4d66211adc67c38f8778b75bc992d740f194190a2366fd4deb494503895521cd/contract';
import startContract from '../../snapshots/4d66211adc67c38f8778b75bc992d740f194190a2366fd4deb494503895521cd/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/241635fcf8563b1a928d8bc2a6edc8935acf07bca77432a0ff41cd23a48b3ad4/contract';
import endContract from '../../snapshots/241635fcf8563b1a928d8bc2a6edc8935acf07bca77432a0ff41cd23a48b3ad4/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('phone', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
