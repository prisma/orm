#!/usr/bin/env -S node
import { col, lit, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/0ad62eb8f8ec2138d5d3a1be39a3e6f4221b4652b3fad9ef35d2e2a35404714f/contract';
import startContract from '../../snapshots/0ad62eb8f8ec2138d5d3a1be39a3e6f4221b4652b3fad9ef35d2e2a35404714f/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/1fb95fa184d8fbead2f8147baf16641eaeabc51459616611882ee00d85addea3/contract';
import endContract from '../../snapshots/1fb95fa184d8fbead2f8147baf16641eaeabc51459616611882ee00d85addea3/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: '__unbound__',
        table: 'account',
        column: col('verified', 'bool', { notNull: true, default: lit(true) }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
