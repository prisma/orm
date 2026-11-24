#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/4d66211adc67c38f8778b75bc992d740f194190a2366fd4deb494503895521cd/contract';
import endContract from '../../snapshots/4d66211adc67c38f8778b75bc992d740f194190a2366fd4deb494503895521cd/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/b5fa4568c24ca857e46f994ffacea5566404312b58aef1ce3cd1496108665ead/contract';
import startContract from '../../snapshots/b5fa4568c24ca857e46f994ffacea5566404312b58aef1ce3cd1496108665ead/contract.json' with {
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
