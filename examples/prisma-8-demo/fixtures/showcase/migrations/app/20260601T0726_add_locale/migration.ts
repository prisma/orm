#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/0ad62eb8f8ec2138d5d3a1be39a3e6f4221b4652b3fad9ef35d2e2a35404714f/contract';
import endContract from '../../snapshots/0ad62eb8f8ec2138d5d3a1be39a3e6f4221b4652b3fad9ef35d2e2a35404714f/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/0d01a7e1c00acc052445624ecfc1542bbee85bdbd8d531c69b826b0a6698e14e/contract';
import startContract from '../../snapshots/0d01a7e1c00acc052445624ecfc1542bbee85bdbd8d531c69b826b0a6698e14e/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('locale', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
