#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/1cb4699baa36101c9bb69a110c407a0e2c4bca0359d6003808f1bb2ac30a6c28/contract';
import endContract from '../snapshots/1cb4699baa36101c9bb69a110c407a0e2c4bca0359d6003808f1bb2ac30a6c28/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../snapshots/33d6969785263a3245e242a9b3557772ed8c33c43784af101875c3f0fd1dc8e2/contract';
import startContract from '../snapshots/33d6969785263a3245e242a9b3557772ed8c33c43784af101875c3f0fd1dc8e2/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
