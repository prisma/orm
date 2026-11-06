#!/usr/bin/env -S node
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract as End } from '../../snapshots/95e9bd41/contract';
import endContract from '../../snapshots/95e9bd41/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';
import postgres from '@prisma/orm-postgres/runtime';

const contract = contractFromJson<End>(endContract);

const { sql: db } = postgres({ contract });

export default class M extends Migration<End, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'ask',
        column: col('stateEnteredAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.dataTransform(contract, 'fill ask.stateEnteredAt from createdAt', {
        check: () =>
          db.public.ask
            .select('id')
            .where((row, fns) => fns.eq(row.stateEnteredAt, null))
            .limit(1),
        run: () =>
          db.public.ask
            .update((row) => ({ stateEnteredAt: row.createdAt }))
            .where((row, fns) => fns.eq(row.stateEnteredAt, null)),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
