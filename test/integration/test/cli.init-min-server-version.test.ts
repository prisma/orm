import mongoContribution from '@internal/mongo/init';
import postgresContribution from '@internal/postgres/init';
import { MONGO_MIN_SERVER_VERSION } from '@internal/target-mongo/server-version';
import { POSTGRES_MIN_SERVER_VERSION } from '@internal/target-postgres/server-version';
import { describe, expect, it } from 'vitest';

describe('the init contributions state each target minimum server version', () => {
  it('matches every target package', () => {
    expect({
      postgres: postgresContribution.serverRequirement?.minVersion,
      mongo: mongoContribution.serverRequirement?.minVersion,
    }).toEqual({
      postgres: POSTGRES_MIN_SERVER_VERSION,
      mongo: MONGO_MIN_SERVER_VERSION,
    });
  });
});
