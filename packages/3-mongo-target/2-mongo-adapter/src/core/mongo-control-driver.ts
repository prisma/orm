import type { ControlDriverInstance } from '@internal/framework-components/control';
import type { MongoControlDriverInstance } from '@internal/mongo-lowering';
import type { Db } from 'mongodb';
import { describeReceivedValue, mongoAdapterError } from './errors';

export function isMongoControlDriver(
  driver: ControlDriverInstance<'mongo', string>,
): driver is MongoControlDriverInstance {
  return (
    driver.familyId === 'mongo' &&
    driver.targetId === 'mongo' &&
    'execute' in driver &&
    typeof driver.execute === 'function'
  );
}

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
