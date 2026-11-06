import mariadbAdapter from '@internal/adapter-mariadb/control';
import mariadbDriver from '@internal/driver-mariadb/control';
import sql from '@internal/family-sql/control';
import mariadb from '@internal/target-mariadb/control';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/config/define-config';
import { emitFixture } from './emit';

describe('defineConfig for MariaDB', () => {
  it('wires the MariaDB target, adapter and driver', () => {
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
      migrations: config.migrations,
    }).toEqual({
      family: sql,
      target: mariadb,
      adapter: mariadbAdapter,
      driver: mariadbDriver,
      extensions: [],
      output: './prisma/contract.json',
      inputs: ['./prisma/contract.prisma'],
      db: { connection: 'mysql://root@localhost:3306/app' },
      migrations: { dir: './migrations' },
    });
  });

  it('refuses a TypeScript contract, since TypeScript contracts are built for MySQL', () => {
    expect(() => defineConfig({ contract: './prisma/contract.ts' })).toThrow(
      expect.objectContaining({
        code: 'CONFIG.VALIDATION_FAILED',
        meta: { contract: './prisma/contract.ts' },
      }),
    );
  });

  it("emits a PSL contract for target mariadb, with no returning capability and typed by MariaDB's codec types module", async () => {
    const { contract, contractDts } = await emitFixture('example');
    expect({
      target: contract.target,
      capabilities: contract.capabilities,
      codecTypes: contractDts.includes(
        "import type { CodecTypes as MariadbTypes } from '@internal/adapter-mariadb/codec-types';",
      ),
    }).toEqual({
      target: 'mariadb',
      capabilities: {
        sql: {
          defaultInInsert: true,
          enums: true,
          foreignKeys: true,
          limit: true,
          orderBy: true,
        },
      },
      codecTypes: true,
    });
  });
});
