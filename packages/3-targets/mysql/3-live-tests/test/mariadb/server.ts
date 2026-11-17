import mariadbAdapter from '@internal/adapter-mariadb/control';
import mariadbDriver from '@internal/driver-mariadb/control';
import mariadbRuntimeDriver from '@internal/driver-mariadb/runtime';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import mariadb from '@internal/mariadb/runtime';
import { contractFromJson } from '@internal/mariadb/static';
import mariadbTarget from '@internal/target-mariadb/control';
import type { Contract } from '../fixtures/mariadb/generated/contract.d';
import contractJson from '../fixtures/mariadb/generated/contract.json' with { type: 'json' };
import type { LiveServer } from '../live-server';

const contract = contractFromJson<Contract>(contractJson);

export const mariadbLiveServer: LiveServer = {
  displayName: 'MariaDB',
  urlVariable: 'MARIADB_URL',
  contract,
  client: (options) => mariadb({ ...options, contract }),
  controlAdapter: () =>
    mariadbAdapter.create(
      createControlStack({
        family: sql,
        target: mariadbTarget,
        adapter: mariadbAdapter,
        driver: mariadbDriver,
      }),
    ),
  controlDriver: mariadbDriver,
  runtimeDriver: mariadbRuntimeDriver,
  expected: {
    upsertStatement:
      'INSERT INTO `User` (`email`, `role`) VALUES (?1, ?2) ON DUPLICATE KEY UPDATE `role` = ?3',
    oversizedOrderedInclude: 'returns every row',
  },
};
