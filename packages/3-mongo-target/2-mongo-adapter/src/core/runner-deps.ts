import type {
  MongoControlAdapter,
  MongoRunnerDependencies,
} from '@internal/family-mongo/control-adapter';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
} from '@internal/framework-components/control';
import type { MongoControlDriverInstance, MongoDriver } from '@internal/mongo-lowering';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import type { Db } from 'mongodb';
import { createMongoAdapter } from '../mongo-adapter';
import { describeReceivedValue, mongoAdapterError } from './errors';
import { MongoInspectionExecutor } from './inspection-executor';
import { MongoControlAdapterImpl } from './mongo-control-adapter';
import { isMongoControlDriver } from './mongo-control-driver';

export function requireMongoControlDriver(
  driver: ControlDriverInstance<'mongo', 'mongo'>,
): MongoControlDriverInstance {
  if (!isMongoControlDriver(driver)) {
    throw mongoAdapterError(
      'CONFIG.VALIDATION_FAILED',
      'Expected a Mongo control driver created by ' +
        'mongoControlDriver.create() from `@internal/driver-mongo/control`.',
      { meta: { received: describeReceivedValue(driver) } },
    );
  }
  return driver;
}

export function extractDb(driver: ControlDriverInstance<'mongo', 'mongo'>): Db {
  return requireMongoControlDriver(driver).db;
}

/**
 * Build the runner-dependencies envelope. `controlAdapter` is the
 * dispatch surface for wire-level Mongo CAS operations (marker reads,
 * marker advances, ledger appends, introspection); the envelope's
 * `markerOps` shim simply forwards each call through it. When the
 * caller already has a `MongoControlAdapter` on the control stack it
 * can pass it in; otherwise a default `MongoControlAdapterImpl` is
 * constructed locally.
 */
export function createMongoRunnerDeps(
  controlDriver: ControlDriverInstance<'mongo', 'mongo'>,
  driver: MongoDriver,
  // Vestigial after the family→adapter SPI refactor: the runner dependencies
  // now route every wire-level call through `controlAdapter`, so the `family`
  // instance is no longer consulted. Kept on the signature to avoid rippling
  // through ~14 call sites; a follow-up that already touches this factory
  // should drop the parameter outright.
  _family: ControlFamilyInstance<'mongo', MongoSchemaIR>,
  controlAdapter: MongoControlAdapter<'mongo'> = new MongoControlAdapterImpl(),
): MongoRunnerDependencies {
  return bindRunnerDeps(controlDriver, driver, controlAdapter);
}

export function bindRunnerDeps(
  controlDriver: ControlDriverInstance<'mongo', 'mongo'>,
  driver: MongoDriver,
  controlAdapter: MongoControlAdapter<'mongo'>,
): MongoRunnerDependencies {
  const adapter = createMongoAdapter();
  return {
    inspectionExecutor: new MongoInspectionExecutor(extractDb(controlDriver)),
    adapter,
    driver,
    executeDdl: (command) => adapter.lower({ command }, {}).then((wire) => driver.run(wire)),
    markerOps: {
      readMarker: (space) => controlAdapter.readMarker(controlDriver, space),
      initMarker: (space, dest) => controlAdapter.initMarker(controlDriver, space, dest),
      updateMarker: (space, expectedFrom, dest) =>
        controlAdapter.updateMarker(controlDriver, space, expectedFrom, dest),
      writeLedgerEntry: (space, entry) =>
        controlAdapter.writeLedgerEntry(controlDriver, space, entry),
    },
    introspectSchema: () => controlAdapter.introspectSchema(controlDriver),
  };
}
