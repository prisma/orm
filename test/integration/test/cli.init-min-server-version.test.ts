import { MONGO_MIN_SERVER_VERSION } from '@internal/target-mongo/server-version';
import { POSTGRES_MIN_SERVER_VERSION } from '@internal/target-postgres/server-version';
import { describe, expect, it } from 'vitest';
import { MIN_SERVER_VERSION } from '../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/env';

describe('the CLI init templates state each target minimum server version', () => {
  it('matches every target package', () => {
    expect(MIN_SERVER_VERSION).toEqual({
      postgres: POSTGRES_MIN_SERVER_VERSION,
      mongo: MONGO_MIN_SERVER_VERSION,
    });
  });
});
