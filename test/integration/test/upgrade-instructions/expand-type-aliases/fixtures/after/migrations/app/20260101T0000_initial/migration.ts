#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/postgres/migration';
import type { Contract as End } from '../../snapshots/f9fe553123fbfef2c6915c522258b03161a755a2ce41757ef560bc17cf4196fe/contract';
import endContract from '../../snapshots/f9fe553123fbfef2c6915c522258b03161a755a2ce41757ef560bc17cf4196fe/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
