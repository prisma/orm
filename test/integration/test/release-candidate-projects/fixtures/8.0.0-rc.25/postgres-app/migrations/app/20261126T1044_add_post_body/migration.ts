#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2086eab7650a25284216465448157b277b4996ca09fc9fddd3c1591fed4fb2aa/contract';
import endContract from '../../snapshots/2086eab7650a25284216465448157b277b4996ca09fc9fddd3c1591fed4fb2aa/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b2a214eb94165a0088bb177d54215ccdf70f183dc6056f0b7cdf06733ca6129e/contract';
import startContract from '../../snapshots/b2a214eb94165a0088bb177d54215ccdf70f183dc6056f0b7cdf06733ca6129e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Post',
        column: col('body', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
