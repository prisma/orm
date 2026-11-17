import { mysqlAdapterCapabilities } from '@internal/adapter-mysql/adapter';
import mysqlAdapter from '@internal/adapter-mysql/control';
import mariadbDriver from '@internal/driver-mariadb/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import mariadbTarget from '@internal/target-mariadb/control';
import { describe, expect, it } from 'vitest';
import mariadbAdapter from '../src/exports/control';

const stack = createControlStack({
  family: sql,
  target: mariadbTarget,
  adapter: mariadbAdapter,
  driver: mariadbDriver,
});

describe('the MariaDB control adapter descriptor', () => {
  it('names MariaDB, its own codec types module, and MySQL capabilities with returning off', () => {
    expect({
      targetId: mariadbAdapter.targetId,
      id: mariadbAdapter.id,
      capabilities: mariadbAdapter.capabilities,
      codecTypesImport: mariadbAdapter.types?.codecTypes?.import,
      adapterTargetId: mariadbAdapter.create(stack).targetId,
    }).toEqual({
      targetId: 'mariadb',
      id: 'mariadb',
      capabilities: { sql: { ...mysqlAdapterCapabilities.sql, returning: false } },
      codecTypesImport: {
        package: '@internal/adapter-mariadb/codec-types',
        named: 'CodecTypes',
        alias: 'MariadbTypes',
      },
      adapterTargetId: 'mariadb',
    });
  });

  it("shares MySQL's codecs", () => {
    expect(mariadbAdapter.types?.codecTypes?.codecDescriptors).toEqual(
      mysqlAdapter.types?.codecTypes?.codecDescriptors,
    );
  });
});
