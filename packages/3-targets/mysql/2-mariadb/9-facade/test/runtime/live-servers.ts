import mariadbAdapter from '@internal/adapter-mariadb/control';
import mariadbDriver from '@internal/driver-mariadb/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import mariadbTarget from '@internal/target-mariadb/control';
import type { Contract } from '../../../../1-mysql/9-facade/test/fixtures/generated/contract.d';
import type {
  countersContract,
  eventsContract,
  notesContract,
  ticksContract,
} from '../../../../1-mysql/9-facade/test/runtime/live-contracts';
import type { LiveServer } from '../../../../1-mysql/9-facade/test/runtime/live-servers';
import mariadb from '../../src/runtime/mariadb';
import { contractFromJson } from '../../src/static/mariadb-static';
import { emitFixture } from '../emit';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };

/**
 * The contracts MySQL's live tests use, emitted for MariaDB from the same models. Each is typed as MySQL's, whose models and fields it shares, so MySQL's live test suites run against MariaDB unchanged.
 */
const contracts = {
  example: contractFromJson<Contract>(contractJson),
  counters: contractFromJson<typeof countersContract>((await emitFixture('counters')).contractJson),
  events: contractFromJson<typeof eventsContract>((await emitFixture('events')).contractJson),
  notes: contractFromJson<typeof notesContract>((await emitFixture('notes')).contractJson),
  ticks: contractFromJson<typeof ticksContract>((await emitFixture('ticks')).contractJson),
};

export const mariadbLiveServer: LiveServer<'mariadb'> = {
  name: 'MariaDB',
  urlVariable: 'MARIADB_URL',
  example: (options) => mariadb({ ...options, contract: contracts.example }),
  counters: (options) => mariadb({ ...options, contract: contracts.counters }),
  events: (options) => mariadb({ ...options, contract: contracts.events }),
  notes: (options) => mariadb({ ...options, contract: contracts.notes }),
  ticks: (options) => mariadb({ ...options, contract: contracts.ticks }),
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
};
