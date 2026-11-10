import mysqlAdapter from '@internal/adapter-mysql/control';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import mysql from '@internal/target-mysql/control';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';

describe('defineConfig for MySQL', () => {
  it('wires the MySQL target, adapter and driver', () => {
    const config = defineConfig({
      contract: './prisma/contract.prisma',
      db: { connection: 'mysql://root@localhost:3306/app' },
      migrations: { dir: './migrations' },
    });
    expect({
      family: config.family,
      target: config.target,
      adapter: config.adapter,
      driver: config.driver,
      extensions: config.extensions,
      output: config.contract?.output,
      inputs: config.contract?.source.inputs,
      db: config.db,
    }).toEqual({
      family: sql,
      target: mysql,
      adapter: mysqlAdapter,
      driver: mysqlDriver,
      extensions: [],
      output: './prisma/contract.json',
      inputs: ['./prisma/contract.prisma'],
      db: { connection: 'mysql://root@localhost:3306/app' },
    });
  });

  it('reads a TypeScript contract with the TypeScript provider', () => {
    const config = defineConfig({ contract: './prisma/contract.ts', output: 'generated' });
    expect({ output: config.contract?.output, inputs: config.contract?.source.inputs }).toEqual({
      output: 'generated/contract.json',
      inputs: ['./prisma/contract.ts'],
    });
  });
});
