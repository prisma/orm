import mysqlAdapter from '@internal/adapter-mysql/control';
import mysqlDriver from '@internal/driver-mysql/control';
import mysqlRuntimeDriver from '@internal/driver-mysql/runtime';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import mysql from '@internal/mysql/runtime';
import { contractFromJson } from '@internal/mysql/static';
import mysqlTarget from '@internal/target-mysql/control';
import type { Contract } from '../fixtures/mysql/generated/contract.d';
import contractJson from '../fixtures/mysql/generated/contract.json' with { type: 'json' };
import type { LiveServer } from '../live-server';

const contract = contractFromJson<Contract>(contractJson);

export const mysqlLiveServer: LiveServer = {
  displayName: 'MySQL',
  urlVariable: 'MYSQL_URL',
  contract,
  client: (options) => mysql({ ...options, contract }),
  controlAdapter: () =>
    mysqlAdapter.create(
      createControlStack({
        family: sql,
        target: mysqlTarget,
        adapter: mysqlAdapter,
        driver: mysqlDriver,
      }),
    ),
  controlDriver: mysqlDriver,
  runtimeDriver: mysqlRuntimeDriver,
  expected: {
    upsertStatement:
      'INSERT INTO `User` (`email`, `role`) VALUES (?1, ?2) AS `new` ON DUPLICATE KEY UPDATE `role` = ?3',
    oversizedOrderedInclude: 'fails',
    havingAboveExactMean: 'drops the group',
    writeReadingWrittenTable: 'refused',
    includedSumPastWidestDecimal: 'exact',
  },
};
