#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/db733e1df89f66886f7dd6a2ea54fc5be48e65d81aadd193d1e7f220ccf14f5e/contract';
import endContract from '../../snapshots/db733e1df89f66886f7dd6a2ea54fc5be48e65d81aadd193d1e7f220ccf14f5e/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/fc039db97d116c1f5e6e56af25521c69e05232b49dc6e0058c9e3d3fb93eb263/contract';
import startContract from '../../snapshots/fc039db97d116c1f5e6e56af25521c69e05232b49dc6e0058c9e3d3fb93eb263/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'post',
        column: col('impressionCount', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'post',
        column: col('reachScore', 'numeric', { codecRef: { codecId: 'pg/unboundedint@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'post',
        column: col('viewCount', 'int8', { codecRef: { codecId: 'pg/int8number@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
