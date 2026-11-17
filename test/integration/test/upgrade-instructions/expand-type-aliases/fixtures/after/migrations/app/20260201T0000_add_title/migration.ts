#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/postgres/migration';
import type { Contract as End } from '../../snapshots/b780ffea90053c47ccc4c522fb690a6f7742e5be20c396b2801e4e9604110369/contract';
import endContract from '../../snapshots/b780ffea90053c47ccc4c522fb690a6f7742e5be20c396b2801e4e9604110369/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/f9fe553123fbfef2c6915c522258b03161a755a2ce41757ef560bc17cf4196fe/contract';
import startContract from '../../snapshots/f9fe553123fbfef2c6915c522258b03161a755a2ce41757ef560bc17cf4196fe/contract.json' with {
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
